# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Keep this file in sync

**Whenever you make a change that conflicts with anything documented here, update CLAUDE.md in the same change.** This includes: removing/renaming a function or IPC handler named here, changing the sync protocol or on-disk file layout, adding/removing a synced entity or DB table, changing build/test commands, or altering the access-control model. A stale CLAUDE.md is worse than none — if you can't fully verify a section you touched, correct it or add a dated note rather than leaving it misleading. Treat the claims here as needing verification against source when there are bugs.

## What This App Is

SDMo is a **patient encounter coding desktop app** built for research studies. Coders watch videos (or review PDFs) of clinical encounters and log timestamped observations while filling out structured forms. The app supports multi-user projects synced via a shared local folder or directly via OneDrive / Google Drive cloud APIs.

Core workflow: Home → select Project → see Encounters → open a media file → Review page (video + timestamp logger + form workspace) → Submit.

## Commands

```bash
npm run dev          # Vite dev server + Electron together (uses concurrently + wait-on)
npm run vite         # Vite only (no Electron)
npm run electron     # Electron only (expects Vite running at localhost:5173)
npm run build        # Vite production build → dist/
npm run dist:mac     # Full Mac DMG build (arm64 + x64) → release/
npm run dist:win     # Windows NSIS installer → release/
npm run dist:linux   # Linux AppImage → release/
```

No linter is configured.

### Testing

**There is no `npm test` script.** Run the suite directly via Electron-as-Node (required because `better-sqlite3` is a native addon built for Electron's ABI):

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron test/run.js
```

Tests live in `test/` (`migrations.test.js`, `sync.test.js`) and exercise the main-process data layer (schema/migrations, sync merge logic, tombstones).

- `test/run.js` installs an `electron` module mock (temp `userData`, stubbed `dialog`) **before** requiring any project code, then loads every `*.test.js` and runs them.
- `test/_harness.js` is a tiny zero-dependency runner (`test(name, fn)` + `run()`), so no test framework is needed.
- `test/helpers.js` builds isolated in-memory DBs via the exported `initSchema`/`migrate`/`runDataMigrations` from `db.js`, plus seed helpers (`createProject`, `addEncounter`, `addMedia`, `addReview`, …).
- Pure logic tests use their own in-memory DBs; they call exported functions from `sync.js` directly.

**Canary tests** — keep these green when touching sync: the config round-trip (`buildConfigExport → mergeConfigImport`), `config: prune KEEPS an encounter that has reviews`, and the structure-tombstone tests. When you add a new synced entity, migration, or tombstone, add a corresponding test.

## Architecture

### Process Split

This is a standard Electron app (Electron 32) with two processes:

**Main process** (`electron/`): Node.js, has filesystem and SQLite access. All database queries and file I/O happen here via IPC handlers.

**Renderer process** (`src/`): React 18 + Vite, runs in a sandboxed webview with `contextIsolation: true` and `nodeIntegration: false`. Cannot touch the filesystem or database directly.

**Bridge**: `electron/preload.js` exposes `window.api` via `contextBridge`. Every renderer-to-main call goes through `window.api.someMethod()` → IPC → handler → response.

`src/lib/api.js` wraps `window.api` and falls back to mock data when running outside Electron (browser dev preview). **Always add a new method to all three: the IPC handler, `electron/preload.js`, and the mock in `src/lib/api.js`.**

### Main Process Files

| File | Responsibility |
|------|---------------|
| `electron/main.js` | Calls `app.setName('SDMo')`, creates BrowserWindow, registers `localfile://` protocol, requires all IPC modules |
| `electron/db.js` | SQLite singleton via `better-sqlite3`. `getDb()` initializes schema + runs migrations on first call. DB lives at `app.getPath('userData')/sdmo.db` |
| `electron/settings.js` | Per-installation JSON settings at `app.getPath('userData')/app-settings.json`. Stores `reviewer_name`, `user_uuid`, `project_names`, cloud tokens, `media_base_folders`. Atomic write (temp → rename) with a `.bak` fallback |
| `electron/sync.js` | All sync logic: split-file local/cloud sync, tombstones, legacy export/import, debounced `scheduleSync` |
| `electron/ipc/projects.js` | Project CRUD, password/unlock, Excel export, sync:now, sync:importAsNew |
| `electron/ipc/encounters.js` | Encounter CRUD + bulk delete, Excel structure export/import |
| `electron/ipc/media.js` | Media file CRUD + bulk delete/type, `fs:scanMediaFolder`, file linking |
| `electron/ipc/reviews.js` | Reviews, timestamps, form responses, soft-delete/restore |
| `electron/ipc/cloud.js` | Cloud OAuth connect/disconnect, folder listing/selection, cloud sync trigger |
| `electron/cloud/onedrive.js` | Microsoft Graph API adapter (PKCE OAuth, port 3877) |
| `electron/cloud/googledrive.js` | Google Drive API v3 adapter (installed-app OAuth, port 3878) |
| `electron/cloud/cloudSync.js` | Adapter factory: `getAdapter(provider)` → onedrive or googledrive |

Each `electron/ipc/*.js` exports a function that receives `ipcMain` and registers handlers.

### Database Schema

Key tables and relationships:
```
projects (+ cloud_provider, cloud_folder_id, config_version columns)
  └── media_types → timestamp_tags, workspace_tabs
  └── forms
  └── instructions
  └── encounters
        └── media_files → media_type_id (FK to media_types)
              └── reviews (soft-deleted via deleted_at)
                    └── timestamps
                    └── form_responses
deleted_reviews    ← tombstone table for cross-machine review deletion sync
deleted_structure  ← tombstone table for cross-machine encounter/media deletion sync
media_file_links   ← per-machine local file path resolution (not synced)
```

**Schema migrations** (`db.js`): two layers.
- `migrate()` holds idempotent DDL — `ALTER TABLE` column adds, `CREATE TABLE IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS` — in the `migrations` array, each in a try/catch so it's safe to re-run. Add new columns, tables, and indexes here; never modify `initSchema`.
- `runDataMigrations()` is the home for **data** transforms. It uses `PRAGMA user_version`: each entry runs exactly once, in a transaction, advancing `user_version`. The v0→v1 entry backfills `sync_id`/`review_sync_id` on legacy rows. New rows always get their sync ids at insert time, so these are upgrade-only.

**Stable sync ids**: every `encounters`/`media_files` insert sets `sync_id` and every `reviews` insert sets `review_sync_id` at creation. Sync matches on these ids first and falls back to name only for legacy data. If you add an insert path for these tables, set the sync id there too.

**Backups** (`backupDb(reason)` in `db.js`): writes a synchronous `VACUUM INTO` snapshot to `userData/backups/` (keeps newest 15). Called on startup (throttled to once per 12h) and **before any cascading delete** (form, media type, encounter, media file, bulk deletes, project) and before a remote config apply. `VACUUM INTO` is synchronous on purpose so the snapshot captures pre-delete state. Add a `backupDb('pre-...')` call before any new destructive operation.

### Sync Architecture

Three sync modes, selected per-project in Setup → Sync: **None** (manual Export/Import file flow only), **Local folder** (split-file sync to a shared folder), **Cloud** (direct API sync to OneDrive/Google Drive).

#### Split-file sync layout (local and cloud)
```
<sync_folder_or_drive_folder>/
  project-config.json      ← structure: forms, media types, instructions, encounters schema, config_version
  manifest.json            ← tiny {config_version} for cheap "who's newer" checks
  reviews/
    <reviewer-uuid>.json   ← per-reviewer, only that machine writes its own
  reviews-export.xlsx      ← derived, write-only: multi-sheet Excel of ALL reviews, rewritten every sync
  deleted-reviews.json     ← append-only review tombstone log
  deleted-structure.json   ← append-only encounter/media tombstone log
```

- **`reviews-export.xlsx`** is a convenience report for researchers — the same workbook the "Export Excel" button produces (one `<Media Type> Reviews` + `<Media Type> Timestamps` sheet pair per media type), regenerated and uploaded at the end of every sync so the latest reviews are always available in the shared folder/cloud without anyone manually exporting. It is **derived and write-only**: it is built from the local DB *after* peer reviews are merged in (so it equals the union of all `reviews/*.json`), is never read back or merged, and is not a source of truth — deleting it just means the next sync rewrites it. Built by `buildReviewsWorkbook(db, projectId)` in `sync.js` (returns `null` when there are no reviews, so an empty workbook is never written); the `export:excel` IPC handler reuses the same function. Writing binary `.xlsx` to the cloud uses the adapters' `writeFile(folderId, name, content, mimeType)` — the 4th `mimeType` arg defaults to `application/json`; Google Drive base64-encodes `Buffer` content in its multipart body.

- **`config_version`**: integer on `projects`, bumped by `bumpConfigVersion` on any structural change or settings save (via `bumpAndSync`). It is a **per-machine "who's newer" counter**, not a schema version. Config sync compares the local counter against the folder's `manifest.json`: if the folder is newer, pull + apply (`replaceStructureFromConfig`); if local is newer, write `project-config.json` + `manifest.json`.
- **Config writing is NOT owner-gated.** Every machine writes the config when its `config_version` exceeds the folder's — last-writer-wins by counter. (Historical note: an `isOwner`/PI-only-write model was documented and then removed in 2026-06; do not reintroduce references to `isOwner` or `owner_projects` — they no longer exist.)
- **`CONFIG_FORMAT_VERSION`** (in `sync.js`, currently 4): the on-disk config *format* version, stamped into `project-config.json` as `version`. `assertConfigCompatible` refuses to apply a config whose `version` is newer than this app understands. Bump it when the config format changes incompatibly.
- **Concurrent-sync guard**: `doLocalSync`/`doCloudSync` run through a per-project mutex (`runExclusiveSync`); a sync requested mid-flight is queued to run once afterward. `cancelSync(projectId)` clears the debounce timer and queue (called on project delete).
- **Auto-sync**: `scheduleSync(projectId)` debounces 2 seconds. `bumpAndSync` = `bumpConfigVersion` + `scheduleSync`, called after structural changes and settings saves. Review saves call `scheduleSyncForReview` (sync without bumping config_version).
- **Sync order** (`sync:now` / `cloud:syncNow` and auto-sync): review tombstones → **structure tombstones** → config → peer reviews → write own review → write config (if local is newer) → write tombstone files → write `reviews-export.xlsx` report.

#### Deletion propagation (tombstones)
Two independent tombstone mechanisms, both append-only and merged across machines:

- **Reviews** — soft-deleted (`deleted_at` set, row kept). `deleted_reviews` propagates the deletion; restoring removes the tombstone. Helpers: `applyTombstones` / `buildTombstones`.
- **Encounters & media files** — hard-deleted, with a `deleted_structure` tombstone keyed by `sync_id` (`kind` = `'encounter'` | `'media'`). Recorded by `recordEncounterTombstone` / `recordMediaTombstone` in the delete handlers (`encounters:delete`, `media:deleteFile`, and the `*:bulkDelete` variants) **before** the row is removed. Helpers: `applyStructureTombstones` / `buildStructureTombstones`.

**Why structure tombstones exist:** config-apply prunes encounters/media absent from the authoritative config, but a safety guard (`_applyConfigTransaction`) refuses to prune anything that still has reviews — so a stale/buggy config can't cascade-delete reviewer work. That guard meant an explicit deletion of a *reviewed* encounter never propagated (and could be re-published by a reviewer that kept it). A tombstone is a **deliberate** deletion (the delete UI warns it destroys reviews), so it **overrides the guard**: `applyStructureTombstones` runs before config-apply and deletes the item everywhere, and config-apply **skips any tombstoned `sync_id`** so a stale peer config can't resurrect it.

**If you add a new way to delete an encounter or media file, record a structure tombstone there too**, or the deletion won't propagate.

#### Legacy Export/Import (manual file flow)
`buildExport` / `mergeImport` / `createFromImport` still exist for the manual Save File / Import File flow. `mergeImport` only adds structure (never prunes), so structure tombstones are not part of this path. Do not remove these functions.

#### Cloud OAuth
- **OneDrive**: PKCE flow, Azure app `769f4075-4597-4d51-ba1b-c3611914ca68`, redirect `http://localhost:3877`. Tokens stored as `onedrive_tokens` + `onedrive_email` in `app-settings.json`.
- **Google Drive**: installed-app flow, GCP client in `electron/cloud/googledrive.js`, redirect `http://localhost:3878`. Scope: `https://www.googleapis.com/auth/drive email profile` (full drive scope needed for shared folders). Tokens stored as `googledrive_tokens` + `googledrive_email`.
- Both OAuth servers listen with `{ exclusive: false }` and are cancellable via `cloud:cancelAuth` IPC.
- `ensureFolder` uses `conflictBehavior: 'fail'` (OneDrive) / query-first (Google Drive) to avoid duplicate folder creation.

### Local File Protocol

Videos are served via a custom `localfile://` protocol registered in `main.js`:
```js
protocol.registerFileProtocol('localfile', (request, callback) => {
  const filePath = decodeURIComponent(request.url.replace('localfile://', ''))
  callback({ path: filePath })
})
```
This uses Chromium's native file serving, which supports HTTP range requests needed for video seeking. Do **not** replace with `protocol.handle` + `net.fetch` — that breaks range requests and videos won't play.

### Access Control (password / unlock)

There is **one** gate: a per-installation in-memory unlock set.

- Owner password is hashed with SHA-256 (`crypto.createHash`) and stored in `projects.owner_password_hash`. The hash is included in the synced config so all machines enforce the same password.
- `unlockedProjects` is an in-memory `Set` in `ipc/projects.js`, populated by `project:verifyPassword`/`project:setPassword` and cleared on app restart. `projects:get` exposes `is_unlocked` from it.
- The SetupPage uses `is_unlocked` to gate **editing settings** (the `locked` / `isOwner` props inside SetupPage are renderer-local and just mean "is unlocked"). This is the only thing the unlock state controls — it does **not** gate config writing (see Sync Architecture).
- There is no persistent ownership concept. (The former `isOwner()` function and `owner_projects` setting were removed in 2026-06.)

### Soft Delete vs Hard Delete

- **Reviews** are soft-deleted (`deleted_at` set). All listing queries filter `WHERE deleted_at IS NULL`. Propagated via `deleted_reviews`; restore removes the tombstone.
- **Encounters / media files** are hard-deleted (FK cascade), propagated via `deleted_structure` tombstones (see above).

### Form Schema

Forms stored as JSON in `forms.schema`:
```json
{ "sections": [{ "id": "uuid", "title": "...", "elements": [{ "id": "uuid", "type": "text|number|select|...", "label": "..." }] }] }
```
Form responses in `form_responses.responses` are keyed by element UUID: `{ "element-uuid": value }`.
In Excel export, iterate `sec.elements` (not `sec.questions`).

### Renderer Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `HomePage` | Project list, reviewer name, import/create, tutorial |
| `/project/:id` | `ProjectPage` | Encounter list (paginated, `PAGE_SIZE = 15`), media files, review badges, sync now, export Excel. Fixed-height (`100vh`) sidebar |
| `/project/:id/setup` | `SetupPage` | 10-tab settings; manages encounters/files incl. multi-select bulk delete + bulk set-media-type |
| `/review/:id` | `ReviewPage` | Video player, timestamp logger (scrollable sidebar), form workspace tabs |

`SetupPage` section indices are defined in `src/lib/setupSections.js` (the source of truth — import `SETUP_SECTIONS` rather than hardcoding): 0=Overview, 1=Forms, 2=Instructions, 3=Media Types, 4=Encounters, 5=Files, 6=Sync, 7=Keybinds, 8=Access, 9=Deleted Reviews.

**Encounters management (SetupPage, section 4)**: per-row rename / add file / move / set media type / delete, plus **multi-select** via checkboxes on encounter headers and file rows. A floating action bar offers bulk Set-media-type (files only) and bulk Delete; these route through `encounters:bulkDelete` / `media:bulkDelete` / `media:bulkUpdateType` (one backup + one transaction + one sync per batch).

**Excel structure export/import** (`encounters:exportStructure` / `previewImport` / `applyImport`): three columns only — `Encounter`, `File Name`, `Media Type`. The importer reads only those columns.

### Packaging

- Built with `electron-builder`. Config is in the `"build"` key of `package.json`.
- `better-sqlite3` is a native addon listed in `asarUnpack` (excluded from the asar archive). electron-builder rebuilds it via `@electron/rebuild` during packaging. After a manual `npm install`, rebuild with `./node_modules/.bin/electron-rebuild -f -w better-sqlite3`.
- `app.setName('SDMo')` is called at the top of `main.js` so the packaged app stores data under the `SDMo` userData name. Output goes to `release/`. Mac builds produce two DMGs (arm64 + x64). App is unsigned — users on other Macs may need `xattr -cr /Applications/SDMo.app` if Gatekeeper blocks it.
- GitHub Actions workflow at `.github/workflows/build.yml` builds all platforms on tag push.
- `node-fetch@2` (CommonJS) is required for HTTP in the main process — do not upgrade to v3 (ESM only).

### Tutorial System

First-time tutorial on `HomePage` uses `TutorialBubble` (portal-rendered, positioned via `getBoundingClientRect`). State persisted to `localStorage` key `sdmo_tutorial_v1`. Target elements identified by `id` attributes (`tut-name`, `tut-import`, `tut-new`, `tut-help`). Re-triggered via the `?` button.
