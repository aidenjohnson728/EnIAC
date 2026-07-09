function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function buildWorkspaceSnapshot(db, mediaFileId) {
  const media = db.prepare(`
    SELECT mf.id, mf.sync_id, mf.name, mf.file_type, mf.media_type_id,
           mt.sync_id as media_type_sync_id, mt.config_version as media_type_version,
           mt.name as media_type_name, mt.reviews_required, mt.allow_custom_tags, mt.color
    FROM media_files mf
    LEFT JOIN media_types mt ON mf.media_type_id = mt.id
    WHERE mf.id=?
  `).get(mediaFileId)
  if (!media) return null

  const snapshot = {
    snapshot_version: 1,
    captured_at: new Date().toISOString(),
    media_file: {
      id: media.id,
      sync_id: media.sync_id || null,
      name: media.name,
      file_type: media.file_type || 'other',
    },
    media_type: media.media_type_id ? {
      id: media.media_type_id,
      sync_id: media.media_type_sync_id || null,
      version: media.media_type_version || 1,
      name: media.media_type_name || '',
      reviews_required: media.reviews_required,
      allow_custom_tags: media.allow_custom_tags ? 1 : 0,
      color: media.color || null,
    } : null,
    tags: [],
    workspace_tabs: [],
    forms: {},
    instructions: {},
  }

  if (!media.media_type_id) return snapshot

  snapshot.tags = db.prepare('SELECT label, color, description, category FROM timestamp_tags WHERE media_type_id=? ORDER BY id').all(media.media_type_id)
  const tabs = db.prepare('SELECT * FROM workspace_tabs WHERE media_type_id=? ORDER BY sort_order').all(media.media_type_id)
  for (const tab of tabs) {
    const outTab = {
      id: tab.id,
      tab_type: tab.tab_type,
      ref_id: tab.ref_id,
      label: tab.label,
      sort_order: tab.sort_order,
      ref_sync_id: null,
      ref_version: null,
      ref_name: null,
    }
    if (tab.tab_type === 'form') {
      const form = db.prepare('SELECT * FROM forms WHERE id=?').get(tab.ref_id)
      if (!form) continue
      outTab.ref_sync_id = form.sync_id || null
      outTab.ref_version = form.schema_version || 1
      outTab.ref_name = form.name
      snapshot.forms[String(form.id)] = {
        id: form.id,
        sync_id: form.sync_id || null,
        version: form.schema_version || 1,
        name: form.name,
        schema: parseJson(form.schema, { sections: [] }),
      }
    } else if (tab.tab_type === 'instruction') {
      const instr = db.prepare('SELECT * FROM instructions WHERE id=?').get(tab.ref_id)
      if (!instr) continue
      outTab.ref_sync_id = instr.sync_id || null
      outTab.ref_name = instr.name
      snapshot.instructions[String(instr.id)] = {
        id: instr.id,
        sync_id: instr.sync_id || null,
        name: instr.name,
        content_type: instr.content_type || 'markdown',
        content: instr.content || '',
        file_path: instr.file_path || null,
      }
    }
    snapshot.workspace_tabs.push(outTab)
  }

  return snapshot
}

function getFormSnapshotFromReview(db, reviewId, formId) {
  const review = db.prepare('SELECT workspace_snapshot FROM reviews WHERE id=?').get(reviewId)
  const snapshot = parseJson(review?.workspace_snapshot, null)
  return snapshot?.forms?.[String(formId)] || null
}

function currentFormSnapshot(db, formId) {
  const form = db.prepare('SELECT * FROM forms WHERE id=?').get(formId)
  if (!form) return null
  return {
    id: form.id,
    sync_id: form.sync_id || null,
    version: form.schema_version || 1,
    name: form.name,
    schema: parseJson(form.schema, { sections: [] }),
  }
}

function reviewMatchesForm(db, projectId, review, form) {
  if (!form) return false
  const snapshot = parseJson(review.workspace_snapshot, null)
  if (snapshot) {
    for (const snapForm of Object.values(snapshot.forms || {})) {
      if (snapForm.sync_id && form.sync_id && snapForm.sync_id === form.sync_id) return true
      if (snapForm.name === form.name) return true
    }
  }
  const response = db.prepare('SELECT id FROM form_responses WHERE review_id=? AND (form_id=? OR form_sync_id=?)')
    .get(review.id, form.id, form.sync_id || '')
  if (response) return true

  const currentTab = db.prepare(`
    SELECT wt.id FROM workspace_tabs wt
    JOIN media_files mf ON mf.media_type_id = wt.media_type_id
    WHERE mf.id=? AND wt.tab_type='form' AND wt.ref_id=?
  `).get(review.media_file_id, form.id)
  return !!currentTab
}

function reviewMatchesMediaType(review, mediaType) {
  if (!mediaType) return false
  if (review.current_media_type_id === mediaType.id) return true
  if (review.media_type_sync_id && mediaType.sync_id && review.media_type_sync_id === mediaType.sync_id) return true
  const snapshot = parseJson(review.workspace_snapshot, null)
  return !!(snapshot?.media_type?.sync_id && mediaType.sync_id && snapshot.media_type.sync_id === mediaType.sync_id)
}

function candidateReviews(db, projectId, scope) {
  const statusClause = scope === 'drafts' ? "AND r.status != 'submitted'" : ''
  return db.prepare(`
    SELECT r.*, mf.media_type_id as current_media_type_id
    FROM reviews r
    JOIN media_files mf ON r.media_file_id = mf.id
    JOIN encounters e ON mf.encounter_id = e.id
    WHERE e.project_id=? AND r.deleted_at IS NULL ${statusClause}
  `).all(projectId)
}

function previewStructureMigration(db, projectId, kind, id, scope = 'drafts') {
  const reviews = candidateReviews(db, projectId, scope)
  let target = null
  let matches = []
  if (kind === 'form') {
    target = db.prepare('SELECT * FROM forms WHERE id=?').get(id)
    matches = reviews.filter(r => reviewMatchesForm(db, projectId, r, target))
  } else if (kind === 'mediaType') {
    target = db.prepare('SELECT * FROM media_types WHERE id=?').get(id)
    matches = reviews.filter(r => reviewMatchesMediaType(r, target))
  }

  return {
    kind,
    id,
    scope,
    targetName: target?.name || '',
    total: matches.length,
    drafts: matches.filter(r => r.status !== 'submitted').length,
    submitted: matches.filter(r => r.status === 'submitted').length,
  }
}

function migrateStructureReviews(db, projectId, kind, id, scope = 'drafts') {
  const preview = previewStructureMigration(db, projectId, kind, id, scope)
  if (preview.total === 0) return { ...preview, updated: 0, unsubmitted: 0, reviewIds: [] }
  const form = kind === 'form' ? db.prepare('SELECT * FROM forms WHERE id=?').get(id) : null
  const mediaType = kind === 'mediaType' ? db.prepare('SELECT * FROM media_types WHERE id=?').get(id) : null
  const migratedAt = new Date(Date.now() + 1).toISOString()
  let updated = 0
  let unsubmitted = 0
  const reviewIds = []

  const tx = db.transaction(() => {
    for (const review of candidateReviews(db, projectId, scope)) {
      const matches = kind === 'form'
        ? reviewMatchesForm(db, projectId, review, form)
        : reviewMatchesMediaType(review, mediaType)
      if (!matches) continue
      reviewIds.push(review.id)

      const workspaceSnapshot = buildWorkspaceSnapshot(db, review.media_file_id)
      if (workspaceSnapshot) {
        workspaceSnapshot.captured_at = migratedAt
        db.prepare('UPDATE reviews SET workspace_snapshot=?, media_type_sync_id=?, media_type_version=? WHERE id=?')
          .run(
            JSON.stringify(workspaceSnapshot),
            workspaceSnapshot.media_type?.sync_id || null,
            workspaceSnapshot.media_type?.version || null,
            review.id
          )
        for (const snapForm of Object.values(workspaceSnapshot.forms || {})) {
          db.prepare(`
            UPDATE form_responses
            SET form_sync_id=?, form_version=?, form_snapshot=?, updated_at=?
            WHERE review_id=? AND (form_id=? OR form_sync_id=?)
          `).run(
            snapForm.sync_id || null,
            snapForm.version || null,
            JSON.stringify(snapForm),
            migratedAt,
            review.id,
            snapForm.id,
            snapForm.sync_id || ''
          )
        }
        if (kind === 'mediaType') {
          const activeFormIds = Object.keys(workspaceSnapshot.forms || {}).map(id => Number(id)).filter(Number.isFinite)
          if (activeFormIds.length > 0) {
            const placeholders = activeFormIds.map(() => '?').join(',')
            db.prepare(`DELETE FROM form_responses WHERE review_id=? AND form_id NOT IN (${placeholders})`)
              .run(review.id, ...activeFormIds)
          } else {
            db.prepare('DELETE FROM form_responses WHERE review_id=?').run(review.id)
          }
        }
      } else if (form) {
        const snapForm = currentFormSnapshot(db, form.id)
        if (snapForm) {
          db.prepare(`
            UPDATE form_responses
            SET form_sync_id=?, form_version=?, form_snapshot=?, updated_at=?
            WHERE review_id=? AND (form_id=? OR form_sync_id=?)
          `).run(snapForm.sync_id || null, snapForm.version || null, JSON.stringify(snapForm), migratedAt, review.id, form.id, form.sync_id || '')
        }
      }
      if (scope === 'all' && review.status === 'submitted') {
        const reason = kind === 'form' ? 'form_version_changed' : 'media_type_version_changed'
        db.prepare(`
          UPDATE reviews
          SET status='in_progress',
              previous_submitted_at=submitted_at,
              submitted_at=NULL,
              reopened_at=?,
              reopened_reason=?
          WHERE id=?
        `).run(migratedAt, reason, review.id)
        unsubmitted++
      }
      updated++
    }
  })
  tx()
  return { ...preview, updated, unsubmitted, reviewIds }
}

function migrateMediaFileReviews(db, mediaFileId, reason = 'media_type_version_changed') {
  const reviews = db.prepare('SELECT * FROM reviews WHERE media_file_id=? AND deleted_at IS NULL').all(mediaFileId)
  if (reviews.length === 0) return { total: 0, updated: 0, unsubmitted: 0, reviewIds: [] }

  const migratedAt = new Date(Date.now() + 1).toISOString()
  let updated = 0
  let unsubmitted = 0
  const reviewIds = []

  const tx = db.transaction(() => {
    for (const review of reviews) {
      reviewIds.push(review.id)
      const workspaceSnapshot = buildWorkspaceSnapshot(db, mediaFileId)
      const activeFormIds = Object.keys(workspaceSnapshot?.forms || {}).map(id => Number(id)).filter(Number.isFinite)

      if (workspaceSnapshot) {
        workspaceSnapshot.captured_at = migratedAt
        db.prepare('UPDATE reviews SET workspace_snapshot=?, media_type_sync_id=?, media_type_version=? WHERE id=?')
          .run(
            JSON.stringify(workspaceSnapshot),
            workspaceSnapshot.media_type?.sync_id || null,
            workspaceSnapshot.media_type?.version || null,
            review.id
          )
        for (const snapForm of Object.values(workspaceSnapshot.forms || {})) {
          db.prepare(`
            UPDATE form_responses
            SET form_sync_id=?, form_version=?, form_snapshot=?, updated_at=?
            WHERE review_id=? AND (form_id=? OR form_sync_id=?)
          `).run(
            snapForm.sync_id || null,
            snapForm.version || null,
            JSON.stringify(snapForm),
            migratedAt,
            review.id,
            snapForm.id,
            snapForm.sync_id || ''
          )
        }
      }

      if (activeFormIds.length > 0) {
        const placeholders = activeFormIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM form_responses WHERE review_id=? AND form_id NOT IN (${placeholders})`)
          .run(review.id, ...activeFormIds)
      } else {
        db.prepare('DELETE FROM form_responses WHERE review_id=?').run(review.id)
      }

      if (review.status === 'submitted') {
        db.prepare(`
          UPDATE reviews
          SET status='in_progress',
              previous_submitted_at=submitted_at,
              submitted_at=NULL,
              reopened_at=?,
              reopened_reason=?
          WHERE id=?
        `).run(migratedAt, reason, review.id)
        unsubmitted++
      }
      updated++
    }
  })
  tx()

  return { total: reviews.length, updated, unsubmitted, reviewIds }
}

function localizeWorkspaceSnapshot(db, projectId, snapshotValue) {
  const snapshot = typeof snapshotValue === 'string' ? parseJson(snapshotValue, null) : snapshotValue
  if (!snapshot) return null
  const next = JSON.parse(JSON.stringify(snapshot))
  const forms = {}
  const instructions = {}

  for (const [oldId, formSnap] of Object.entries(next.forms || {})) {
    const local = formSnap.sync_id
      ? db.prepare('SELECT id FROM forms WHERE project_id=? AND sync_id=?').get(projectId, formSnap.sync_id)
      : db.prepare('SELECT id FROM forms WHERE project_id=? AND name=?').get(projectId, formSnap.name || '')
    const key = local?.id != null ? String(local.id) : String(oldId)
    forms[key] = { ...formSnap, id: local?.id || formSnap.id }
  }

  for (const [oldId, instrSnap] of Object.entries(next.instructions || {})) {
    const local = instrSnap.sync_id
      ? db.prepare('SELECT id FROM instructions WHERE project_id=? AND sync_id=?').get(projectId, instrSnap.sync_id)
      : db.prepare('SELECT id FROM instructions WHERE project_id=? AND name=?').get(projectId, instrSnap.name || '')
    const key = local?.id != null ? String(local.id) : String(oldId)
    instructions[key] = { ...instrSnap, id: local?.id || instrSnap.id }
  }

  next.workspace_tabs = (next.workspace_tabs || []).map(tab => {
    if (tab.tab_type === 'form') {
      const local = tab.ref_sync_id
        ? db.prepare('SELECT id FROM forms WHERE project_id=? AND sync_id=?').get(projectId, tab.ref_sync_id)
        : db.prepare('SELECT id FROM forms WHERE project_id=? AND name=?').get(projectId, tab.ref_name || '')
      return { ...tab, ref_id: local?.id || tab.ref_id }
    }
    if (tab.tab_type === 'instruction') {
      const local = tab.ref_sync_id
        ? db.prepare('SELECT id FROM instructions WHERE project_id=? AND sync_id=?').get(projectId, tab.ref_sync_id)
        : db.prepare('SELECT id FROM instructions WHERE project_id=? AND name=?').get(projectId, tab.ref_name || '')
      return { ...tab, ref_id: local?.id || tab.ref_id }
    }
    return tab
  })
  next.forms = forms
  next.instructions = instructions
  return next
}

module.exports = {
  buildWorkspaceSnapshot,
  getFormSnapshotFromReview,
  currentFormSnapshot,
  localizeWorkspaceSnapshot,
  previewStructureMigration,
  migrateStructureReviews,
  migrateMediaFileReviews,
  parseJson,
}
