# CLAUDE.md

**Keep this file in sync.** If you rename/remove a function, IPC channel, DB table, or sync behavior named here, update this file in the same change. A stale CLAUDE.md is worse than none.

---

## What This App Is

EnIAC (formerly SDMo — see note below) is a clinical encounter coding desktop app for research studies. Coders watch videos (or review PDFs) and log timestamped observations while filling out structured forms. Multi-user projects sync via a shared local folder or OneDrive/Google Drive.

Core flow: Home → Project → Encounters → open media file → Review page (video + timestamp logger + form workspace) → Submit.

The app ships two built-in project templates, each with its own form and agreement configuration: **SDMo** and **UCAT**. Both live in `electron/services/defaultProjectTemplates/` (`sdmo.json`, `ucat.json`) and are consumed by `electron/services/defaultProjects.js`. Editing a template only affects **newly created** projects — an existing project's own copy of its form/media-type config must be updated separately (Setup → Forms) or the project recreated. **Template Projects is no longer just these two** — see Custom Templates below; `listDefaultProjects` merges the built-in pair with any user-made ones.

> **Naming note:** the product was renamed from SDMo to EnIAC. `app.setName('SDMo')` in `main.js` is intentionally unchanged (see Misc) — the internal app name and userData path stay "SDMo" for backward compatibility with existing installs, independent of the "EnIAC" display name and branding used everywhere else (window titles, exported filenames, file-picker filter labels, etc.). When adding new user-facing strings, use "EnIAC" — but never touch `app.setName`.

---

## Commands

```bash
npm run dev       # Vite + Electron together
npm run vite      # Vite only (browser preview, no IPC)
npm run electron  # Electron only (expects Vite at localhost:5173)
npm test          # Electron-as-Node test runner
npm run build     # Vite production build → dist/
npm run dist:mac  # Mac DMG (arm64 + x64) → release/
npm run dist:win  # Windows NSIS → release/
```

No linter. Tests live in `test/`, use `test/_harness.js` (zero-dep runner), and rely on `test/helpers.js` for in-memory DB setup.

Releases are migration-sensitive. Follow `RELEASE.md` for version bumps, migration/update tests, diagnostics checks, and GitHub Release publishing. A same-version asset swap (replacing a release's binaries without bumping the version) skips `npm version` entirely and re-uploads with `gh release upload <tag> ... --clobber` — existing installs on that version won't be prompted to update, since the auto-updater compares version strings.

> **A note on applying template/schema edits while testing:** `defaultProjectTemplates/*.json` and other files loaded via Node's `require()` (e.g. `electron/services/defaultProjects.js`) are cached in memory for the life of the running process. Replacing the file on disk while the app is already running does **nothing** until the app is fully quit and relaunched — reloading the window or just creating a new project is not enough. This has been the root cause of several "my change didn't work" reports; check this before assuming a real bug.

---

## Design Goals

These goals should guide every change — not just new features.

- **Modular.** Each concern lives in one place. IPC handlers stay thin (validate → call service → return). Business logic lives in service modules, not in handlers or React components.
- **Standardized UI.** Use the existing patterns: the `showToast` / banner / modal patterns in `ProjectPage`, the same button classes (`btn btn-primary`, `btn btn-ghost btn-sm`), the same color variables (`var(--danger)`, `var(--text-muted)`, `var(--border)`). Don't introduce new ad-hoc inline styles or new component patterns when existing ones fit. **This includes color specifically** — never hardcode a hex color for anything that isn't deliberately theme-independent (see Theming below). A hardcoded hex value that happens to look right in light mode has repeatedly turned out to render as unreadable dark-on-dark (or light-on-light) text once dark mode exists — the fix is always to trace the value back to the nearest semantic CSS variable (`var(--text)`, `var(--warning)`, `var(--danger-light)`, etc.), not to hardcode a second, dark-appropriate value next to it.
- **Localizable changes.** When adding a feature, changes should be concentrated — a new IPC channel touches the handler file, `preload.js`, and `api.js` mock. A new DB column goes in `migrate()` only. A new renderer state stays in the relevant page component. Avoid cross-cutting changes that ripple into many unrelated files.
- **Future-proof sync.** Sync is bidirectional and per-entity (LWW). Never replace it with whole-blob overwrite or add counter-gated logic. Deletions only propagate via tombstones — absence from a config is never treated as deletion.

---

## Rules

### IPC — always touch all three

Every new method requires changes in exactly three places:
1. `electron/ipc/*.js` — the handler
2. `electron/preload.js` — the `contextBridge` exposure
3. `src/lib/api.js` — the mock fallback for browser dev preview

If you skip any of these, the method works in Electron but breaks in browser mode or vice versa.

IPC handlers must be validated in `electron/ipc/contracts.js`. Keep handlers thin: validate at the contract layer, call a service or DB helper, return the result. Some historical channels (e.g. the original `sync:importAsNew`) were never added to `contracts.js` at all — don't assume a channel already has a validator just because it's in use; check, and add one when you extend a channel's signature.

### Database

The app is in production. Installed users must be able to update without losing data. Every DB change must be forward-compatible.

- **Never modify `initSchema`.** Add new columns/tables/indexes in the `migrations` array in `db.js` (idempotent DDL, each in a try/catch).
- **Data transforms** go in `runDataMigrations()` using `PRAGMA user_version`. Each entry runs exactly once in a transaction. Never edit existing entries — only append new ones.
- **New columns must have a DEFAULT or be nullable.** SQLite's `ALTER TABLE ADD COLUMN` requires this for existing rows. Never add a `NOT NULL` column without a default value.
- **Never rename or drop a column directly.** SQLite requires a table-copy migration for that. If unavoidable, add a new `runDataMigrations()` entry that copies data and recreates the table — do not touch `initSchema`.
- **Every insert** into `encounters`, `media_files`, `forms`, `media_types`, or `instructions` must set `sync_id` (UUID). Every insert into `reviews` must set `review_sync_id`.
- **Every synced edit** (not local-only relinking) must bump `updated_at = datetime('now')` on the row. `file_path` / `folder_path` changes do NOT bump it.
- **Call `backupDb('pre-...')`** before any cascading delete (encounter, media file, form, media type, bulk deletes, project). It's synchronous by design — it snapshots pre-delete state.
- **Startup backup** runs automatically on every launch (`backupDb('startup')`, throttled to once/12h, last 15 kept in `userData/backups/`). This is the safety net for bad migrations — don't remove it.
- **`projects.local_role`** (`'leader'` | `'reviewer'`, defaults `'leader'`) is deliberately **local-only, never synced** — see Sync — hard rules below. Don't let it leak into `buildConfigExport`/`buildProjectStateExport`/any of the continuous-sync payloads; it only ever travels through the one-shot `buildExport`/`createFromImport` file-share path.

### Sync — hard rules

- **Tombstones are the only way deletions propagate.** `applyStructure` never prunes. If you add a new delete path for any structural entity, call the appropriate tombstone function before removing the row or the deletion won't sync.
  - Structural entities (encounter/media/form/instruction/media_type): `recordStructureTombstone(db, projectId, kind, id)`
  - Reviews: soft-delete only (`deleted_at` set, row kept)
- **`applyStructure` has two modes** — `merge: true` (LWW, auto-sync) and `merge: false` (authoritative, manual import/join). Neither prunes. Don't add pruning logic.
- **`config_version` is legacy back-compat only.** Don't use it to gate which side wins a sync. The fingerprint + per-entity `updated_at` clocks determine that.
- **No owner-gated writes.** Every machine publishes when its local content differs from the folder. `isOwner` and `owner_projects` no longer exist — don't reintroduce them.
- **Connectivity:** Cloud sync checks `net.isOnline()` before attempting. If offline, it emits `sync:offline` (first occurrence only) and returns. The 5-minute periodic pass retries automatically; when connectivity returns it emits `sync:online`. Local folder sync has no internet check.
- **Auto-sync fires** via `scheduleSync` (2s debounce after structural changes) and `startPeriodicAutoSync` (every 5 min + 15s startup pass). Review saves use `scheduleSyncForReview` (no config_version bump).
- **Role-based sharing (`local_role`, "Leader"/"Reviewer") is scoped entirely to the manual "Share Project" / "Import Project" file flow (`buildExport`/`createFromImport`/`mergeImport` in `sync.js`), not the continuous sync-folder system.** It was a deliberate scope decision, not an oversight — don't extend it into `syncConfigLocal`/`syncConfigCloud`/`doLocalSync`/`doCloudSync` without discussing it first, since those paths have no concept of "this machine's role" and adding one would be a real semantic change to how sync treats every machine as an equal, symmetric peer (see "No owner-gated writes" above — a role gate is conceptually adjacent to an owner gate and should be held to the same scrutiny).

### Media

- **Video/audio:** always use the HTTP media server (`mediaServer.js`). `getMediaUrl(filePath)` returns a token URL that supports HTTP range requests. Call `media:getUrl` IPC from the renderer.
- **PDFs / other files:** use the `localfile://` protocol registered in `main.js`. Do **not** replace it with `protocol.handle` + `net.fetch` — that breaks range requests.
- Both mechanisms enforce an allowlist. Never serve arbitrary renderer-provided paths.
- **Adding a new encounter** goes straight from "Add Encounter" into picking/dropping a video — there's no separate name-typing step. The encounter and its media file both take the video's own filename once it's linked (`ProjectPage.jsx`, `finalizeNewMediaLink`); only renames a placeholder name, never overwrites one someone set on purpose.
- **The video seek bar is a real drag control**, not click-to-jump only: `mousedown` on the track starts tracking, then `document`-level `mousemove`/`mouseup` listeners (not element-level) keep seeking as the pointer moves anywhere on screen and release anywhere on the page, so dragging isn't lost the moment the cursor leaves the thin track itself.

### Agreement & reliability

Inter-rater agreement is computed by **two separate engines** with different jobs — don't conflate them or move logic between them without checking both consumers.

- **`src/lib/reliabilityStats.mjs`** — pooled statistics (ICC, Cohen's kappa, Fleiss' kappa, weighted kappa, percent agreement, weighted Fleiss kappa) computed **across every encounter that shares a media name**, project-wide plus any imported results files. Powers `QuestionReliabilityView` (ProjectPage's **Agreement** tab).
- **`src/lib/interraterAgreement.mjs`** — per-file comparison for a **single** video at a time. Powers **Alignment** in `ProjectPage.jsx`. ("Agreement Between Results" no longer exists — it was removed entirely, including its nav entry, its component, and the `poolAcrossRoles: false` comparison path it used. Alignment absorbed the "compare per-file agreement" role on its own, always with `poolAcrossRoles: true`. Any stray reference to "Agreement Between Results" is stale — the feature is gone, not hidden.)
- **ICC always needs 2+ subjects; every other method here only needs 1+.** ICC's model is a ratio of *between-subject* variance to total variance — mathematically undefined with one subject, full stop, no way around it. Every other method (kappa-family, percent agreement) is computed from pooled ratings, not between-subject variance, so a single subject with 2+ raters is a valid (if noisier) estimate. This is why `computeICC` alone keeps its `n < 2` guard while the others were relaxed to `n < 1`. Don't "fix" the others back to matching ICC's stricter guard — that was the actual bug, once.
- **Cohen's kappa (exactly 2 raters) and Fleiss' kappa (3+ raters) are genuinely separate functions** (`computeCohenKappa` / `computeFleissKappa`), each correctly self-labeling its own `method` in its return value. Don't collapse them back into one function that mislabels a Fleiss' result as `'cohen_kappa'` — that was a real, shipped bug in an earlier version of this file.
- **`multiselect` no longer defaults to `set_overlap`.** A standalone multiselect question's automatic method is now plain `percent` (exact-match only — two answers that overlap but aren't identical score 0, not partial credit). This was a deliberate change, not a regression. `set_overlap`'s actual math (`agreementForMultiselect`) still exists and is still exercised — but only reachable now via a multiselect-**shaped** (array) value nested as a sub-item inside a `table`/`likert_group` question scored as `agreement_method: 'item_group'`, which internally still dispatches to it. There is no remaining path to `set_overlap` for a standalone multiselect question, even if `agreement_method` is explicitly set to `'set_overlap'` on it directly — verify this against the real function before assuming otherwise, it's easy to get backwards.
- **`interraterAgreement.mjs` can never report a real ICC or weighted Fleiss kappa** — it only ever has one subject (one video) per comparison. If a question's `agreement_method` is `icc` or `weighted_fleiss_kappa`, `computeAgreementForQuestion` substitutes the type's actual per-file default (e.g. `item_group` for `likert_group`, `ordinal` for `likert`) *before* computing, so the returned `method` label always matches what was genuinely computed — never trust `questionMeta.agreement_method` directly as the displayed label in this file.
- **`reliabilityStats.mjs`'s pooled engine now supports `'numeric'`** (dial/slider-type questions), dispatching to `computeICC` — the correct pooled statistic for continuous data, same principle as ICC already being used for likert/rating questions. **The same "never trust the configured method as the display label" rule applies on the `ProjectPage.jsx` caller side too**: prefer the computed result's own `stat.method` over the originally-dispatched `entry.method` when building the display label — `'numeric'` dispatches to a function that self-labels its output `'icc'`, and using the dispatched name instead would show the literal string "numeric" (not a real label), skip ICC's interpretation bands, and apply the wrong subjects-needed threshold. When `stat` is `null` (not enough data), there's no result object to read a label from — fall back explicitly to `'icc'` for a `'numeric'`-dispatched entry rather than the raw dispatched string, since the dispatch is deterministic regardless of whether it produced a value.
- **A dial/slider question with `count > 1` (multiple sub-dials in one control) is unpacked into one pooled question per sub-dial position** (`ARRAY_UNPACK_TYPES` in `ProjectPage.jsx`'s pooling logic), the same "one pooled thing per sub-item" principle `ROW_UNPACK_TYPES` already applies to `likert_group` rows — just indexed by array position instead of a row id, since a multi-dial response has no natural per-position identifier of its own. Sub-dial labels come from `control_labels[idx]` when the schema provides them, falling back to a generic "Dial N".
- **A `null` result from a kappa-family function can mean two different things**, and the UI must distinguish them: not enough subjects (`reason` absent), or mathematically undefined because every rating agreed with zero variance (`reason: 'no_variance'`, `pExpected`/`pe === 1` makes the denominator zero). Collapsing these into one generic "not enough data" message is misleading — the second case needs real data variety to ever resolve, not just more encounters.
- **Alignment pools across instance roles by default.** `computeInterraterAgreementForMediaFile`'s `poolAcrossRoles` param controls this; Alignment always passes `true` (it's automatic and meant to show agreement among everyone who rated a file, Trainee and Consultant together). The function's own default remains `false` for any other caller — it's a general-purpose parameter, not something to flip globally just because Alignment happens to be the only caller left now that Agreement Between Results is gone.
- **Cross-file/cross-install matching key is `media_name`, never `encounter_name`.** Encounter names are a display label only and can legitimately collide across different videos. Every subject-grouping key in both engines is media name (optionally + `form_name:element_id:instance_role:instance_order` for per-question keys) — don't add encounter_name into a matching key.
- **Agreement is deliberately disabled for SDMo's dials specifically** (`agreement_enabled: false`, `agreement_method: null` on that element in `sdmo.json`) — this is a schema-level, per-question opt-out, not a code-level special case. The generic `'numeric'`/`ARRAY_UNPACK_TYPES` machinery above still exists and works for any other dial/slider question on any other form that wants it; SDMo's dials just don't use it. Don't reintroduce agreement for SDMo's dials by "fixing" this flag — it was an explicit request.

### Export formats — three distinct shapes, don't conflate them

- **`buildExport` / `createFromImport`** (`sync.js`) — the full, monolithic **project** file: structure (forms, media types, encounters, media) plus every review nested under its media file. Powers "Share Project" (`sync:saveFile`) and "Import Project" (`sync:importAsNew`, now two IPC calls — see Role-based sharing below). This is the only export format that carries the `roster` field.
- **`getMyResponsesLong` / `reviews:exportResults`** (`electron/ipc/reviews.js`) — a lighter, **per-reviewer results** export: just this machine's own submitted reviews as flat `responses_long` rows, self-describing via each row's own `form_snapshot`. This is what a single coder on their own machine actually produces via "Export Results" → Export JSON, and what "Import Results" (`reviews:importResultsFiles`) reads back in, landing in the `imported_results` table (separate from `reviews`, never merged into your own review data). Multiple reviewers of the same project each export their own separate file of this shape — there's no single shared "everyone's results" file; comparison happens by importing several of these into one project.
- **`reviews:exportResultsCsv`** — same underlying data as the JSON results export (own reviews + already-imported results, combined), but flattened to one row per individual question/sub-item and stripped of anything not useful for statistical software (no `form_snapshot`, no `review_sync_id`, no nested JSON values). Table/likert_group questions unpack to one row per sub-item; multi-dial questions unpack to one row per sub-dial — same principle as the pooled engine's `ROW_UNPACK_TYPES`/`ARRAY_UNPACK_TYPES` above, independently reimplemented in `reviews.js` since it doesn't share code with `ProjectPage.jsx`'s pooling logic. Keep both unpacking implementations in sync if the schema gains a new nestable question type.
- **`eniac_form_export: 1`** (`templates:exportForm`/`templates:importForm` in `electron/ipc/projects.js`) — the smallest of the four: just one form's own `{ name, description, schema }`, no project, no media, no reviews. This is "Share" on a single custom template, distinct from sharing a whole project.

Don't reuse one format's file-shape check (`data.sdmo`, `data.sdmo_reviews`, `data.eniac_form_export`) to validate a different import path — each is a deliberately distinct marker.

### Custom Templates ("Make Form" / "Import Form")

Template Projects is no longer limited to the two built-in SDMo/UCAT templates — anyone can create a standalone form (independent of any project) or import one someone else shared, and it becomes a new entry in the same list.

- **`custom_templates` table** (`db.js` migration): `id, name, description, form_schema, created_at`. Fully separate from the built-in templates, which stay as bundled JSON in `defaultProjectTemplates/` — editing a custom template's row has no effect on `sdmo.json`/`ucat.json` and vice versa.
- **`electron/services/defaultProjects.js`**: `listDefaultProjects(db)` now takes a `db` argument (it didn't before) and merges the hardcoded pair with `SELECT * FROM custom_templates`, prefixing custom template ids as `custom_${row.id}` so they can never collide with the built-in string ids (`'sdmo'`, `'ucat'`). `seedDefaultProject(db, templateId, overrides)` checks the `custom_` prefix and, when matched, synthesizes a seedable shape via `customTemplateAsSeedable` — a single form wrapped in an auto-generated default media type (named after the form, one workspace tab pointing at it), since a custom template is just one form and the resulting project still needs to be immediately usable, the same way SDMo/UCAT already are. `overrides.name`/`overrides.description` let the New Project modal's own typed name win over the template's stored name — previously `seedDefaultProject` always used the template's own name regardless of caller.
- **Standalone form creation** (`src/pages/FormBuilderPage.jsx`, new page, route `/form-builder`) reuses the existing `FormBuilder` component (`src/components/setup/FormBuilder.jsx`) via a new optional `saveOverride` prop — when provided, `doSave()` calls it instead of the normal `api.saveForm(projectId, ...)` + password-lock-check path, entirely bypassing the need for a project to exist. The existing project-scoped save path is otherwise completely unchanged.
- **"Make Form" from inside the New Project modal** (`HomePage.jsx`) stashes the in-progress name/description in `sessionStorage` before navigating to `/form-builder`, then `FormBuilderPage.jsx` stashes the newly-created template's id in a second `sessionStorage` key before navigating back to `/`. HomePage picks both back up on mount, re-opens New Project with everything restored, and auto-selects the just-built form. Two plain string constants (not shared via import) must match exactly between `HomePage.jsx` and `FormBuilderPage.jsx` — `PENDING_NEW_PROJECT_KEY` / `JUST_CREATED_TEMPLATE_KEY`.
- **Sharing a single custom template** ("Share" in the New Project modal's form list, custom templates only — SDMo/UCAT aren't single-form so can't go through this path) uses the `eniac_form_export: 1` format — see Export formats above.

### Role-based sharing (Leader / Reviewer)

"Share Project" can assign roles: one shared file carries a **roster** of `{ name, role }` pairs (not one file per recipient — that was an earlier design, replaced). On import, the person picks their own name from the roster rather than typing it, which sets their role and their per-project reviewer name together, atomically, from the same choice — avoiding the exact spelling/nickname drift a free-text name field would risk.

- **`projects.local_role`** — `'leader'` (default) or `'reviewer'`, local-only (see Sync — hard rules). A project created directly, from a template, or the sample project is always `'leader'` by virtue of the column default — no special-casing needed anywhere for "the creator is the leader."
- **`buildExport(db, projectId, { clearReviews, roster })`** embeds the roster array directly in the export payload; **`createFromImport(db, data, chosenName)`** looks up `chosenName` in `data.roster`, sets `local_role` accordingly, and calls `setProjectName(projectId, matchedName)` so the per-project name is never left to fall back to the (possibly differently-spelled) global `reviewer_name`. A file with no roster, or a `chosenName` that doesn't match any roster entry, both fall back to `'leader'` and no name is set here — never a silent downgrade.
- **Import is two IPC calls, not one**: `sync:previewImportFile` opens the file picker and parses the file, returning `{ data, roster }` without creating anything; `sync:importAsNew(data, chosenName)` (signature changed — it used to open its own file picker and take no arguments) does the actual creation once the person has picked a name (or, for a no-roster file, typed one via the existing free-text fallback in `HomePage.jsx`'s post-import setup modal). Don't collapse this back into one call — the whole point is that nothing is created until a name is chosen.
- **The roster picker never shows which name has which role** — deliberately, so nobody can browse the list and pick a name specifically to get a particular access level. Don't add the role back into that display.
- **A roster-based import skips the post-import "set up on this computer" modal entirely** (media folder / sync folder) and navigates straight to the project — name and role are already fully determined by the roster pick, nothing essential left to collect there. The no-roster fallback path still shows that modal, since it's the only place left to type a name in that case.
- **UI gating for `local_role === 'reviewer'`** (`ProjectPage.jsx`): Settings (both the sidebar nav button and the actual page content render, not just the button — gate both, a stale `activePage` could otherwise leak content past a hidden nav item), the whole Agreement/Alignment nav group, and Import Results are all hidden. This is a **UI-level gate only** — there is no server-side or route-level enforcement preventing a Reviewer from navigating to `/project/:id/setup` directly by URL; closing that would require changes in `SetupPage.jsx`, which hasn't been touched for this yet.

### Theming (light/dark, CSS variables)

- **All theme-dependent color lives in CSS custom properties**, defined once in `src/index.css`'s `:root` and overridden wholesale under `[data-theme="dark"]` — same variable names in both blocks, so any rule that already reads `var(--bg)`/`var(--text)`/etc. re-themes automatically with zero changes elsewhere. Never add a second, hardcoded dark-mode value next to a light-mode hex color — trace it back to the nearest existing variable (or add a new one to both blocks if genuinely nothing fits) instead.
- **The toggle is manual, not `prefers-color-scheme`** — `theme` state and `toggleTheme()` live in a `ThemeContext` created in `src/App.jsx` (`useTheme()` hook, exported from that file), applying `data-theme` to `document.documentElement` and persisting via the existing app-settings mechanism (`api.setAppSettings({ theme })` / read back via `api.getAppSettings()` on mount) — same store already used for `reviewer_name`, no backend changes needed for this. The toggle button itself currently only lives on `HomePage.jsx`'s top bar; since the setting is app-wide and global, toggling from there applies everywhere, but there's no toggle control reachable from deeper inside a project without navigating back to Home first.
- **The current palette is deliberately warm**, not the neutral blue/gray a default design system would reach for: warm ivory/cream backgrounds, a mossy-green accent (buttons, links, focus rings), and orange for warnings — replacing an earlier, cooler palette. Dark mode carries the same identity (warm brown-black background rather than the cooler gray-black a default dark theme would use, brighter mossy green/orange for contrast). If asked to adjust the palette again, keep this warm identity unless told otherwise — it was a deliberate, explicit design direction, not an incidental choice.
- **Some hardcoded colors are intentionally theme-independent and should NOT be converted to variables**: the tag-color palette array (`COLORS` in `ProjectPage.jsx`) and any per-entity fallback color (e.g. a media type's default color) are user-facing *data*, not UI chrome — they need to stay stable regardless of app theme so a given tag/media-type keeps looking the same color to everyone. Similarly, the video player's own overlay controls (progress bar, seek thumb, hover-reveal control bar, timestamp readout) are deliberately fixed dark/light-on-dark regardless of app theme, matching how virtually every video player's own chrome works independent of the surrounding page.
- **A specific, recurring bug worth watching for**: bold text placed directly inside a raw `<button>` element (no `className="btn ..."`, no explicit `color` in its own inline style) does not inherit `var(--text)` from the page body the way a `<div>`/`<span>`/heading normally would — `<button>` has its own browser-default text color that breaks the inheritance chain. This looked fine in light mode purely by coincidence and only became visibly broken (black text on a dark background) once dark mode existed. Any new custom-styled `<button>` (not using the `.btn` classes, which already set `color` via CSS) needs an explicit `color: 'var(--text)'` on the button itself if it contains anything besides an icon.

### Multi-instance forms

A form can opt into repeatable instances within one review (e.g. UCAT's Trainee/Consultant) via `schema.multi_instance_roles: [...]`. Each instance is identified by `instance_key` (unique per review), `instance_role`, `instance_order`.

- **A multi-instance form with zero instances must show a role-picker, never the form itself** (`FormInstancePrompt` in `ReviewPage.jsx`/`WorkspacePage.jsx`) — this is intentional, not a loading state: an answer must never be saved with no role attached, since it can't be matched to Trainee/Consultant in agreement/reliability afterward.
- **Cross-reviewer instance matching uses role + creation order, not `instance_key`** — `instance_key` is unique per review and would never match across two different reviewers' own instances of the same role.

### `tag_category_presence` questions

This question type is **auto-computed, never manually answered**, and **not rendered as a visible form question at all** — `FormRenderer.jsx` returns `null` for the element itself, while still running the effect that computes and saves "Present"/"Not Present" based on whether any tag from the matching category was used. Presence is shown instead directly on the Notes/Tags panel (`TagPaletteList` in `ReviewPage.jsx`/`WorkspacePage.jsx`): a category header turns green with a checkmark once a tag under it has been used. Both places match tags to categories the same way (id primarily, falling back to label) — keep them in sync if either changes.

- **A section made up entirely of `tag_category_presence` questions is hidden via CSS (`display: none` on the section wrapper), never filtered out of the render tree/array.** This distinction matters and has been a real, shipped bug once: React only runs a component's hooks (including the auto-compute effect above) for something it actually mounts. Removing such a section from the `sections` array before rendering — even though it *looks* purely visual, since nothing in it is visible either way — silently prevents the auto-compute effect from ever running at all, leaving the question's answer permanently `undefined` instead of correctly resolving to "Not Present." The nav bar's "jump to section" list applies the same hide-don't-unmount treatment for the same reason.
- **It is fully valid, and expected, for all `tag_category_presence` questions to resolve to "Not Present" even when the gating question ("Did SDM likely occur?") is "Yes."** The auto-compute effect always produces a value (`'Present'` or `'Not Present'`) the moment the question is visible/mounted, regardless of whether any tags were actually used — there is no cross-question validation rule requiring at least one category to be "Present." Don't add one without an explicit request; a reviewer legitimately tagging nothing is a real, submittable outcome.

### UI patterns

- Toasts: `showToast(message, isError?)` — disappears after 4s. Use for transient confirmations and errors.
- Persistent banners: inline `<div>` with `background`, `borderBottom`, `padding: '8px 20px'` pattern — see the `syncError` / offline banners in `ProjectPage`. Use for states that need to stay visible until resolved.
- Setup section indices come from `src/lib/setupSections.js` (`SETUP_SECTIONS`). Never hardcode section numbers.
- Page routes: `/` → HomePage, `/project/:id` → ProjectPage, `/project/:id/setup` → SetupPage, `/review/:id` → ReviewPage, `/workspace/:id` → WorkspacePage, `/form-builder` → FormBuilderPage (new, standalone — no `:id`, since it's independent of any project).
- Dial/slider controls distinguish "untouched" (`null`, shows "--") from a real answer at `min` — don't coerce through `Number()` before checking for this, `Number(null) === 0` silently turns a reset/clear into a real answer of `0` (then clamped up to `min`). The shared `NumericStepper` component includes a reset-to-untouched control; any new numeric control wrapping it should pass `null` through as-is, not run it through a clamp first.

### App updates and diagnostics

- App binary updates use `electron-updater` against GitHub Releases. Do not route app updates through project sync.
- Updates are prompted, not automatic: `autoDownload=false` and `autoInstallOnAppQuit=false`.
- Required updates are controlled by GitHub Release notes. Include `[sdmo-update:required]` to block app use until the update is installed.
- `quitAndInstall()` must call `backupDb('pre-app-update')` before restarting.
- App/update/diagnostics IPC channels are registered in `main.js`, exposed in `preload.js`, mirrored in `src/lib/api.js`, and validated in `electron/ipc/contracts.js`.
- Diagnostics export should include version/system/project-count/log information, not media files or review contents.

### Misc

- Use `node-fetch@2` (CommonJS) for HTTP in the main process. Do **not** upgrade to v3 (ESM only).
- `app.setName('SDMo')` is called at the top of `main.js` — this sets the userData path. Don't move it, and don't change the string to "EnIAC" — see the naming note at the top of this file.
- Form schema: `{ sections: [{ id, title, elements: [{ id, type, label }] }] }`. Form responses are keyed by element UUID. In Excel export iterate `sec.elements`, not `sec.questions`.
- **Removed this session, don't resurrect without a fresh discussion**: the sample/"Tutorial Project" feature (`electron/services/sampleProject.js`'s `seedSampleProject`, its HomePage buttons, and the sample-tour chain in `ProjectPage.jsx`/`ReviewPage.jsx` — the latter included a "Sync Basics" tour that turned out to have no trigger path other than the sample flow, so it was fully dead code once the sample flow was gone). The project-level "Import Project" button that used to sit on `ProjectPage.jsx`'s own top bar (redundant — you're already inside a project) was also removed; the *homepage's* "Import Project" (for creating a new project from a file, before you're inside one) is unrelated and still exists. "Agreement Between Results" — see Agreement & reliability above.

---

## Key Files at a Glance

| File | What it owns |
|------|-------------|
| `electron/main.js` | BrowserWindow, `localfile://` protocol, workspace windows, IPC module registration, quit hooks |
| `electron/updater.js` | Prompted GitHub Releases app updates, required-update release-note marker, pre-install DB backup |
| `electron/diagnostics.js` | App log file setup and diagnostics JSON export payload |
| `electron/preload.js` | `window.api` contextBridge — every renderer↔main call lives here |
| `electron/db.js` | SQLite singleton, schema init, migrations (including `custom_templates` table and `projects.local_role` column), `backupDb` |
| `electron/settings.js` | Per-install JSON settings (reviewer name, UUID, cloud tokens, media base folders, `theme`), plus per-project name via `getProjectName`/`setProjectName` |
| `electron/sync.js` | All sync logic: protocol-v3 split-index sync, tombstones, merge, auto-sync; also the legacy monolithic `buildExport`/`createFromImport`/`mergeImport` used by the manual Share/Import Project file flow (now roster-aware — see Role-based sharing) |
| `electron/mediaServer.js` | Token-URL HTTP server for video/audio range streaming |
| `electron/mediaLinks.js` | Per-machine file path resolution (`resolveLink`, `upsertLink`) |
| `electron/services/structure.js` | Forms/instructions/media-types save+delete domain logic; version-history capture (`form_versions`/`media_type_versions`), `listVersionHistory`, `restoreVersion` |
| `electron/services/snapshots.js` | Review-time workspace/form snapshots; `buildWorkspaceSnapshot`, `localizeWorkspaceSnapshot`, structure-migration preview/apply |
| `electron/services/defaultProjects.js` | Seeds new projects from the SDMo/UCAT templates *and* from `custom_templates` rows (see Custom Templates); `listDefaultProjects(db)` merges both, `seedDefaultProject(db, templateId, overrides)` accepts a name/description override so a caller's own typed name can win over the template's stored one |
| `electron/services/defaultProjectTemplates/*.json` | The SDMo and UCAT built-in template schemas themselves (forms, media types, instructions) — SDMo's dial question has `agreement_enabled: false` deliberately, see Agreement & reliability |
| `electron/ipc/contracts.js` | IPC argument validators |
| `electron/ipc/projects.js` | Project CRUD, password, sync:now, save/share project file (now roster-aware), the two-step import (`sync:previewImportFile` + `sync:importAsNew`), and the standalone-template channels `templates:create`/`templates:exportForm`/`templates:importForm` |
| `electron/ipc/encounters.js` | Encounter CRUD + bulk ops (including delete/bulkDelete), structure Excel export/import |
| `electron/ipc/media.js` | Media file CRUD + bulk ops, linking, playback |
| `electron/ipc/reviews.js` | Reviews, timestamps, form responses, soft-delete/restore, and the results-export/import pair (`getMyResponsesLong`-based JSON export/import, plus the CSV export — see Export formats) |
| `electron/ipc/cloud.js` | Cloud OAuth, folder ops, cloud sync trigger |
| `electron/cloud/onedrive.js` | Microsoft Graph API adapter (PKCE, port 3877) |
| `electron/cloud/googledrive.js` | Google Drive API v3 adapter (port 3878) |
| `src/App.jsx` | Route table (including `/form-builder`), and the `ThemeContext`/`useTheme()` hook that owns light/dark state — see Theming |
| `src/index.css` | The entire color system: `:root` (light) and `[data-theme="dark"]` CSS variable blocks, shared component classes (`.btn-*`, `.card`, `.modal`, etc.) |
| `src/lib/api.js` | Renderer API wrapper + browser-mode mocks |
| `src/lib/setupSections.js` | `SETUP_SECTIONS` constants — source of truth for Setup tab indices |
| `src/lib/reliabilityStats.mjs` | Pooled ICC/kappa/percent agreement math (including `'numeric'` → ICC dispatch) — powers the Agreement tab |
| `src/lib/interraterAgreement.mjs` | Per-file agreement math — powers Alignment only (Agreement Between Results removed) |
| `src/pages/HomePage.jsx` | Project list, unified New Project modal (name → form-with-roster-of-templates → description), Make Form / Import Form, the two-step "Import Project" flow (preview → pick-your-name-from-roster or free-text fallback), the dark-mode toggle button |
| `src/pages/FormBuilderPage.jsx` | New standalone page — hosts `FormBuilder` outside of any project via its `saveOverride` prop, saving to `custom_templates` instead of a project's own forms |
| `src/pages/ProjectPage.jsx` | Encounters list, Agreement/Alignment views, project-level actions (share with roster, delete encounter, etc.), Reviewer-role UI gating |
| `src/pages/ReviewPage.jsx` | Video player (draggable seek bar), timestamp logging, form workspace, SDMo's merged Tags/Notes panel, video auto-fit layout |
| `src/components/setup/FormBuilder.jsx` | The form-schema editor itself — used both inside a project's Setup page and, via `saveOverride`, standalone from `FormBuilderPage.jsx` |
| `src/components/forms/FormRenderer.jsx` | Renders a form schema into inputs; guide-highlight, dial/slider controls, `tag_category_presence` auto-compute |

---

## DB Schema (abbreviated)

```
projects (local_role: 'leader' | 'reviewer', local-only, not synced)
  └── media_types (config_version, archived_at) → timestamp_tags, workspace_tabs
  └── forms (schema_version, archived_at)
  └── instructions
  └── encounters
        └── media_files → media_type_id
              └── reviews (soft-deleted via deleted_at; workspace_snapshot, media_type_sync_id/version)
                    └── timestamps
                    └── form_responses (form_sync_id, form_version, form_snapshot, instance_key, instance_role, instance_order)
form_versions        ← per-edit history of each form's schema (keyed by form_sync_id + version)
media_type_versions  ← per-edit history of each media type's config (tags + workspace tabs)
deleted_structure    ← sync tombstones for structural entities
deleted_reviews      ← legacy tombstones (still written; not used in protocol-v3 sync path)
media_file_links     ← per-machine path resolution (not synced)
custom_templates     ← standalone forms made via "Make Form" or "Import Form" (id, name, description, form_schema, created_at) — not project-scoped, feeds Template Projects alongside SDMo/UCAT
imported_results     ← "Import Results" targets, separate from reviews — never merged into a project's own review data
```

### Versioning & snapshots

Forms and media types are **versioned**. Editing one bumps its `schema_version` / `config_version` and `structure.js` captures the prior state into `form_versions` / `media_type_versions` (via `captureFormVersion` / `captureMediaTypeVersion`, `INSERT OR IGNORE`). The Setup UI lists history (`setup:listVersionHistory`) and can restore a prior version as a new latest version (`setup:restoreVersion`).

Each **review captures a snapshot** of the exact instrument it was filled against: `reviews.workspace_snapshot` (media type + tags + workspace tabs + full form schemas) and `form_responses.form_snapshot` (the one form's schema). `WorkspacePage` renders from this snapshot, so a coder always sees the form as it was — later edits don't retroactively change in-flight or submitted reviews. The Excel export and `Responses_Long` sheet read these snapshots, so old answers keep their original labels and removed questions are never dropped. **`interraterAgreement.mjs` reads `form_snapshot` directly** (no live-schema fallback) — an imported results file's own `form_snapshot` must be complete and accurate for its questions' `agreement_method`/type to be read correctly by Alignment.

Re-aligning existing reviews to the current structure is **opt-in**, never automatic: `setup:previewStructureMigration` shows how many drafts/submitted reviews match, `setup:migrateStructureReviews` rewrites their snapshots. Don't auto-migrate on edit.

> **Setup IPC lives in `electron/ipc/projects.js`** (channels prefixed `setup:`), not a separate `setup.js` module. New `setup:*` methods follow the same three-place rule.

## Sync File Layout (protocol v3)

```
<sync folder>/
  project-state.json       ← canonical compact index (structure + entity hashes + tombstones)
  manifest.json            ← {protocol_version, config_version, fingerprint}
  reviews/
    <review_sync_id>.json  ← full review payload when review storage is split
```

Sync is fingerprint-driven and bidirectional. Both sides merge by `sync_id` + `updated_at` (LWW). `project-state.json` remains the single comparison/index surface: it contains structure, form/media-type version history, tombstones, and either inline reviews or hashes/paths for split review payloads. Review storage is adaptive: compacted reviews stay inline up to 5 MiB (`INLINE_REVIEWS_MAX_BYTES`), then switch to split `reviews/<review_sync_id>.json` payloads. Split review files must not become independent sources of truth; their hashes and paths ride in the index. Cloud split review payload reads/writes use bounded parallel requests for speed. Protocol-v2 monolithic `project-state.json` folders are still accepted and republished as protocol v3 on the next sync.

The Excel report (`buildReviewsWorkbook`) is **not** written during sync — it's generated on demand via the "Export Excel" button (`export:excel`). Don't reintroduce a per-sync `.xlsx` write; the per-pass upload was the slowest part of cloud sync. The workbook is version-aware: reviews keep a `form_snapshot`, so questions removed by later form edits still appear (wide-sheet columns suffixed `(removed)`, codebook `In Current Form = No`) and the `Responses_Long` sheet stays lossless.

**This protocol-v3 continuous sync system is entirely separate from the manual "Share Project"/"Import Project" file flow** (`buildExport`/`createFromImport`, described under Role-based sharing and Export formats above) — the two share some underlying helpers (`enrichKeybinds`, `localizeWorkspaceSnapshot`) but have different payload shapes, different entry points, and role-based sharing applies only to the latter. Don't assume a change to one automatically covers the other.