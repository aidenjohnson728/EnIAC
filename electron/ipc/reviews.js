const { getDb } = require('../db')
const { scheduleSyncForReview } = require('../sync')
const { getOrCreateUUID } = require('../settings')
const { buildWorkspaceSnapshot, getFormSnapshotFromReview, currentFormSnapshot } = require('../services/snapshots')
const { dialog } = require('electron')
const fs = require('fs')
const path = require('path')

// Builds this machine's own submitted-review answers as portable "responses_long"
// rows: one row per (review × form × instance), self-describing via form_snapshot
// so it can be read on another install where local form_id integers don't line up.
// Shared by reviews:exportResults (writes to disk) and reviews:getResultsComparisonData
// (in-memory, feeds the Agreement Between Results page). No media/settings included.
function getMyResponsesLong(db, projectId) {
  const uuid = getOrCreateUUID()
  const reviews = db.prepare(`
    SELECT r.id, r.reviewer_name, r.review_sync_id,
           mf.name as media_name, mt.name as media_type_name,
           e.name as encounter_name
    FROM reviews r
    JOIN media_files mf ON r.media_file_id = mf.id
    JOIN encounters e ON mf.encounter_id = e.id
    LEFT JOIN media_types mt ON mf.media_type_id = mt.id
    WHERE e.project_id=? AND r.reviewer_uuid=? AND r.status='submitted' AND r.deleted_at IS NULL
    ORDER BY e.name, mf.name
  `).all(projectId, uuid)

  const rows = []
  for (const review of reviews) {
    const formResponses = db.prepare(`
      SELECT fr.form_id, fr.responses, fr.form_snapshot, fr.form_sync_id,
             fr.instance_key, fr.instance_role, fr.instance_order,
             f.name as form_name, f.schema as current_schema
      FROM form_responses fr
      LEFT JOIN forms f ON fr.form_id = f.id
      WHERE fr.review_id=?
    `).all(review.id)
    for (const fr of formResponses) {
      rows.push({
        encounter_name: review.encounter_name,
        media_name: review.media_name,
        media_type_name: review.media_type_name,
        reviewer_name: review.reviewer_name,
        review_sync_id: review.review_sync_id,
        form_id: fr.form_sync_id || String(fr.form_id),
        form_name: fr.form_name || null,
        instance_key: fr.instance_key || '',
        instance_role: fr.instance_role || null,
        instance_order: fr.instance_order || 0,
        form_snapshot: fr.form_snapshot ? JSON.parse(fr.form_snapshot) : (fr.current_schema ? JSON.parse(fr.current_schema) : null),
        responses: fr.responses ? JSON.parse(fr.responses) : {},
      })
    }
  }
  return rows
}

// form_snapshot has taken a couple of different shapes across this codebase
// (bare {sections}, or {schema:{sections}}) — same defensive lookup pattern
// used elsewhere in the app.
function getSchemaSectionsForExport(schema) {
  if (!schema) return []
  if (Array.isArray(schema.sections)) return schema.sections
  if (Array.isArray(schema.schema?.sections)) return schema.schema.sections
  return []
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

// Reduces any response value down to one plain, human-readable cell —
// statistical software needs a single scalar per cell, not a JSON blob.
// Object-valued questions (likert_group rows, tag-presence groups) are
// unpacked into their own separate rows below rather than reaching this
// function as a whole object; this only handles what's left after that:
// arrays (multiselect, or an un-unpacked edge case) get joined with '; '.
function formatCsvAnswerValue(value) {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map(formatCsvAnswerValue).join('; ')
  if (typeof value === 'object') return JSON.stringify(value)
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return String(value)
}

// Flattens one responses_long row (one review × form × instance, with a
// single nested `responses` object keyed by element id) into one flat CSV
// row PER INDIVIDUAL QUESTION — and per sub-item for likert_group/table
// questions, and per sub-value for a multi-dial question — mirroring the
// same "one pooled thing per sub-item" unpacking already used by the
// reliability engine in ProjectPage.jsx, for the same reason: a single cell
// containing a nested object or array isn't usable in stats software.
// Deliberately excludes anything not useful for statistical analysis —
// review_sync_id, form_id, instance_key, and the full form_snapshot schema
// are all internal bookkeeping, not data a researcher would want as a column.
function flattenResponseRowForCsv(row) {
  const sections = getSchemaSectionsForExport(row.form_snapshot)
  const elements = sections.flatMap(s => s?.elements || [])
  const out = []
  const base = {
    encounter_name: row.encounter_name,
    media_name: row.media_name,
    media_type_name: row.media_type_name,
    reviewer_name: row.reviewer_name,
    form_name: row.form_name,
    instance_role: row.instance_role || '',
    instance_order: row.instance_order || '',
  }

  for (const el of elements) {
    if (el.type === 'text_block') continue
    const value = row.responses?.[el.id]

    if (el.type === 'likert_group' || el.type === 'table') {
      const groupVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
      for (const item of (el.items || [])) {
        out.push({
          ...base,
          question_id: `${el.id}:${item.id}`,
          question_label: el.label ? `${el.label} - ${item.label || item.id}` : (item.label || item.id),
          question_type: el.type,
          answer: formatCsvAnswerValue(groupVal[item.id]),
        })
      }
      continue
    }

    if ((el.type === 'dial' || el.type === 'vertical_slider') && Number(el.count || 1) > 1) {
      const count = Math.min(5, Math.max(1, Number(el.count || 1)))
      const arr = Array.isArray(value) ? value : []
      for (let idx = 0; idx < count; idx++) {
        const subLabel = el.control_labels?.[idx] || `Sub-value ${idx + 1}`
        out.push({
          ...base,
          question_id: `${el.id}:${idx}`,
          question_label: el.label ? `${el.label} - ${subLabel}` : subLabel,
          question_type: el.type,
          answer: formatCsvAnswerValue(arr[idx]),
        })
      }
      continue
    }

    out.push({
      ...base,
      question_id: el.id,
      question_label: el.label || el.id,
      question_type: el.type,
      answer: formatCsvAnswerValue(value),
    })
  }
  return out
}

function buildCsvFromResponsesLong(rows) {
  const headers = [
    'encounter_name', 'media_name', 'media_type_name', 'reviewer_name', 'form_name',
    'instance_role', 'instance_order', 'question_id', 'question_label', 'question_type', 'answer',
  ]
  const lines = [headers.join(',')]
  for (const row of rows) {
    for (const flat of flattenResponseRowForCsv(row)) {
      lines.push(headers.map(h => csvEscape(flat[h])).join(','))
    }
  }
  return lines.join('\n')
}

module.exports = function (ipcMain) {
  ipcMain.handle('reviews:projectAgreementData', (_, projectId) => {
    const db = getDb()
    const reviews = db.prepare(`
      SELECT r.id, r.reviewer_name, r.status, r.media_file_id, r.created_at,
             r.media_type_sync_id, r.media_type_version, r.workspace_snapshot,
             mf.name as media_name, mf.encounter_id, mf.media_type_id,
             mt.name as media_type_name,
             e.name as encounter_name
      FROM reviews r
      JOIN media_files mf ON r.media_file_id = mf.id
      JOIN encounters e ON mf.encounter_id = e.id
      LEFT JOIN media_types mt ON mf.media_type_id = mt.id
      WHERE e.project_id=? AND r.deleted_at IS NULL
      ORDER BY e.name, mf.name, r.created_at
    `).all(projectId)

    const result = []
    for (const review of reviews) {
      let workspaceSnapshot = null
      try {
        workspaceSnapshot = review.workspace_snapshot ? JSON.parse(review.workspace_snapshot) : null
      } catch {
        workspaceSnapshot = null
      }
      const snapshotMediaType = workspaceSnapshot?.media_type || null
      const effectiveMediaTypeId = review.media_type_id ?? snapshotMediaType?.id ?? review.media_type_sync_id ?? snapshotMediaType?.sync_id ?? null
      const effectiveMediaTypeName = review.media_type_name || snapshotMediaType?.name || (effectiveMediaTypeId == null ? 'Untyped' : 'Media type')
      const formResponses = db.prepare(`
        SELECT fr.form_id, fr.responses, fr.form_snapshot, f.name as form_name, f.schema as current_schema,
               fr.instance_key, fr.instance_role, fr.instance_order
        FROM form_responses fr
        LEFT JOIN forms f ON fr.form_id = f.id
        WHERE fr.review_id=?
      `).all(review.id)
      result.push({
        ...review,
        media_type_id: effectiveMediaTypeId,
        media_type_name: effectiveMediaTypeName,
        workspace_snapshot: workspaceSnapshot,
        form_responses: formResponses.map(fr => ({
          form_id: fr.form_id,
          form_name: fr.form_name || null,
          instance_key: fr.instance_key || '',
          instance_role: fr.instance_role || null,
          instance_order: fr.instance_order || 0,
          responses: fr.responses ? JSON.parse(fr.responses) : {},
          form_snapshot: fr.form_snapshot ? JSON.parse(fr.form_snapshot) : (fr.current_schema ? JSON.parse(fr.current_schema) : null),
        })),
      })
    }

    return result
  })

  ipcMain.handle('reviews:list', (_, mediaFileId) => {
    const db = getDb()
    return db.prepare('SELECT * FROM reviews WHERE media_file_id=? AND deleted_at IS NULL ORDER BY created_at').all(mediaFileId)
  })

  ipcMain.handle('reviews:create', (_, data) => {
    const db = getDb()
    const crypto = require('crypto')
    const uuid = getOrCreateUUID()
    const snapshot = buildWorkspaceSnapshot(db, data.media_file_id)
    const r = db.prepare(`
      INSERT INTO reviews (media_file_id, reviewer_name, reviewer_uuid, review_sync_id, media_type_sync_id, media_type_version, workspace_snapshot)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      data.media_file_id,
      data.reviewer_name,
      uuid,
      crypto.randomUUID(),
      snapshot?.media_type?.sync_id || null,
      snapshot?.media_type?.version || null,
      snapshot ? JSON.stringify(snapshot) : null
    )
    const review = db.prepare('SELECT * FROM reviews WHERE id=?').get(r.lastInsertRowid)
    scheduleSyncForReview(r.lastInsertRowid)
    return review
  })

  ipcMain.handle('reviews:get', (_, id) => {
    const db = getDb()
    const review = db.prepare('SELECT * FROM reviews WHERE id=?').get(id)
    if (!review) return null
    review.timestamps = db.prepare('SELECT * FROM timestamps WHERE review_id=? ORDER BY time_seconds').all(id)
    review.form_responses = db.prepare('SELECT * FROM form_responses WHERE review_id=?').all(id)
    review.workspace_snapshot = review.workspace_snapshot ? JSON.parse(review.workspace_snapshot) : null
    for (const fr of review.form_responses) {
      fr.responses = JSON.parse(fr.responses)
      fr.form_snapshot = fr.form_snapshot ? JSON.parse(fr.form_snapshot) : null
    }
    return review
  })

  ipcMain.handle('reviews:submit', (_, id, data) => {
    const db = getDb()
    db.prepare(`
      UPDATE reviews
      SET status='submitted',
          notes=?,
          submitted_at=datetime('now'),
          reopened_at=NULL,
          reopened_reason=NULL
      WHERE id=?
    `).run(data.notes || '', id)
    scheduleSyncForReview(id)
    return true
  })

  ipcMain.handle('reviews:delete', (_, id) => {
    const db = getDb()
    const row = db.prepare(`
      SELECT r.reviewer_name, r.review_sync_id, mf.name as media_name, e.name as encounter_name, e.project_id
      FROM reviews r
      JOIN media_files mf ON r.media_file_id = mf.id
      JOIN encounters e ON mf.encounter_id = e.id
      WHERE r.id=?
    `).get(id)
    db.prepare("UPDATE reviews SET deleted_at=datetime('now') WHERE id=?").run(id)
    if (row) {
      db.prepare('INSERT OR IGNORE INTO deleted_reviews (project_id, encounter_name, media_name, reviewer_name, review_sync_id) VALUES (?,?,?,?,?)')
        .run(row.project_id, row.encounter_name, row.media_name, row.reviewer_name, row.review_sync_id || null)
      const { scheduleSync } = require('../sync')
      scheduleSync(row.project_id)
    }
    return true
  })

  ipcMain.handle('reviews:restore', (_, id) => {
    const db = getDb()
    const row = db.prepare(`
      SELECT r.reviewer_name, r.review_sync_id, mf.name as media_name, e.name as encounter_name, e.project_id
      FROM reviews r
      JOIN media_files mf ON r.media_file_id = mf.id
      JOIN encounters e ON mf.encounter_id = e.id
      WHERE r.id=?
    `).get(id)
    db.prepare("UPDATE reviews SET deleted_at=NULL, restored_at=datetime('now') WHERE id=?").run(id)
    if (row) {
      if (row.review_sync_id) {
        db.prepare('DELETE FROM deleted_reviews WHERE project_id=? AND review_sync_id=?').run(row.project_id, row.review_sync_id)
      } else {
        db.prepare('DELETE FROM deleted_reviews WHERE project_id=? AND encounter_name=? AND media_name=? AND reviewer_name=?')
          .run(row.project_id, row.encounter_name, row.media_name, row.reviewer_name)
      }
      const { scheduleSync } = require('../sync')
      scheduleSync(row.project_id)
    }
    return true
  })

  ipcMain.handle('reviews:listDeleted', (_, projectId) => {
    const db = getDb()
    return db.prepare(`
      SELECT r.id, r.reviewer_name, r.status, r.created_at, r.deleted_at,
             mf.name as media_name, e.name as encounter_name
      FROM reviews r
      JOIN media_files mf ON r.media_file_id = mf.id
      JOIN encounters e ON mf.encounter_id = e.id
      WHERE e.project_id=? AND r.deleted_at IS NOT NULL
      ORDER BY r.deleted_at DESC
    `).all(projectId)
  })

  // Return distinct reviewer names that this machine's UUID has used for a project
  ipcMain.handle('reviews:getMachineReviewNames', (_, projectId) => {
    const db = getDb()
    const uuid = getOrCreateUUID()
    return db.prepare(`
      SELECT DISTINCT r.reviewer_name FROM reviews r
      JOIN media_files mf ON r.media_file_id = mf.id
      JOIN encounters e ON mf.encounter_id = e.id
      WHERE e.project_id = ? AND r.reviewer_uuid = ? AND r.deleted_at IS NULL
    `).all(projectId, uuid).map(r => r.reviewer_name)
  })

  ipcMain.handle('reviews:unsubmit', (_, id) => {
    const db = getDb()
    db.prepare("UPDATE reviews SET status='in_progress', submitted_at=NULL WHERE id=?").run(id)
    scheduleSyncForReview(id)
    return true
  })

  ipcMain.handle('reviews:saveTimestamp', (_, reviewId, data) => {
    const db = getDb()
    let resultId
    if (data.id) {
      db.prepare('UPDATE timestamps SET time_seconds=?, tag_id=?, tag_label=?, tag_color=?, notes=? WHERE id=?')
        .run(data.time_seconds, data.tag_id || null, data.tag_label || null, data.tag_color || null, data.notes || '', data.id)
      resultId = data.id
    } else {
      const r = db.prepare('INSERT INTO timestamps (review_id, time_seconds, tag_id, tag_label, tag_color, notes) VALUES (?,?,?,?,?,?)')
        .run(reviewId, data.time_seconds, data.tag_id || null, data.tag_label || null, data.tag_color || null, data.notes || '')
      resultId = r.lastInsertRowid
    }
    scheduleSyncForReview(reviewId)
    return resultId
  })

  ipcMain.handle('reviews:updateTimestamp', (_, id, data) => {
    const db = getDb()
    const current = db.prepare('SELECT review_id, tag_id, tag_label, tag_color, notes FROM timestamps WHERE id=?').get(id)
    if (!current) return false
    db.prepare('UPDATE timestamps SET tag_id=?, tag_label=?, tag_color=?, notes=? WHERE id=?')
      .run(
        Object.prototype.hasOwnProperty.call(data, 'tag_id') ? data.tag_id || null : current.tag_id,
        Object.prototype.hasOwnProperty.call(data, 'tag_label') ? data.tag_label || null : current.tag_label,
        Object.prototype.hasOwnProperty.call(data, 'tag_color') ? data.tag_color || null : current.tag_color,
        Object.prototype.hasOwnProperty.call(data, 'notes') ? data.notes || '' : current.notes || '',
        id
      )
    scheduleSyncForReview(current.review_id)
    return true
  })

  ipcMain.handle('reviews:deleteTimestamp', (_, id) => {
    const db = getDb()
    const ts = db.prepare('SELECT review_id FROM timestamps WHERE id=?').get(id)
    db.prepare('DELETE FROM timestamps WHERE id=?').run(id)
    if (ts) scheduleSyncForReview(ts.review_id)
    return true
  })

  ipcMain.handle('reviews:saveFormResponse', (_, reviewId, data) => {
    const db = getDb()
    const instanceKey = data.instance_key || ''
    const responses = typeof data.responses === 'string' ? data.responses : JSON.stringify(data.responses)
    const formSnapshot = getFormSnapshotFromReview(db, reviewId, data.form_id) || currentFormSnapshot(db, data.form_id)
    const formSyncId = formSnapshot?.sync_id || null
    const formVersion = formSnapshot?.version || null
    const formSnapshotJson = formSnapshot ? JSON.stringify(formSnapshot) : null
    const existing = db.prepare('SELECT id FROM form_responses WHERE review_id=? AND form_id=? AND instance_key=?').get(reviewId, data.form_id, instanceKey)
    if (existing) {
      db.prepare("UPDATE form_responses SET responses=?, form_sync_id=COALESCE(form_sync_id,?), form_version=COALESCE(form_version,?), form_snapshot=COALESCE(form_snapshot,?), updated_at=datetime('now') WHERE id=?")
        .run(responses, formSyncId, formVersion, formSnapshotJson, existing.id)
    } else {
      db.prepare('INSERT INTO form_responses (review_id, form_id, responses, form_sync_id, form_version, form_snapshot, instance_key, instance_role, instance_order) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(reviewId, data.form_id, responses, formSyncId, formVersion, formSnapshotJson, instanceKey, data.instance_role || null, data.instance_order || 0)
    }
    scheduleSyncForReview(reviewId)
    return true
  })

  // Repeatable form instances (e.g. "Trainee 1", "Trainee 2", "Consultant 1")
  // — creates a fresh, blank response set for the same form within the same
  // review. Numbered per-role, in creation order within that role, matching
  // what's shown in the instance switcher (role + count of that role so far).
  ipcMain.handle('reviews:addFormInstance', (_, reviewId, formId, role) => {
    const db = getDb()
    const crypto = require('crypto')
    const sameRoleCount = db.prepare('SELECT COUNT(*) as n FROM form_responses WHERE review_id=? AND form_id=? AND instance_role=?').get(reviewId, formId, role).n
    const order = sameRoleCount + 1
    const instanceKey = crypto.randomUUID()
    const formSnapshot = getFormSnapshotFromReview(db, reviewId, formId) || currentFormSnapshot(db, formId)
    db.prepare('INSERT INTO form_responses (review_id, form_id, responses, form_sync_id, form_version, form_snapshot, instance_key, instance_role, instance_order) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(reviewId, formId, '{}', formSnapshot?.sync_id || null, formSnapshot?.version || null, formSnapshot ? JSON.stringify(formSnapshot) : null, instanceKey, role, order)
    scheduleSyncForReview(reviewId)
    return { instance_key: instanceKey, instance_role: role, instance_order: order }
  })

  ipcMain.handle('reviews:removeFormInstance', (_, reviewId, formId, instanceKey) => {
    const db = getDb()
    db.prepare('DELETE FROM form_responses WHERE review_id=? AND form_id=? AND instance_key=?').run(reviewId, formId, instanceKey || '')
    scheduleSyncForReview(reviewId)
    return true
  })

  // ── Results export/import (portable coding-results comparison) ───────────────

  ipcMain.handle('reviews:exportResults', async (_, projectId) => {
    const db = getDb()
    const project = db.prepare('SELECT name FROM projects WHERE id=?').get(projectId)
    const rows = getMyResponsesLong(db, projectId)
    const payload = {
      sdmo_results_export: 1,
      project_name: project?.name || 'Project',
      reviewer_name: rows[0]?.reviewer_name || null,
      exported_at: new Date().toISOString(),
      responses_long: rows,
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Results',
      defaultPath: `${(project?.name || 'project').replace(/[^\w.-]+/g, '_')}-results-${stamp}.json`,
      filters: [{ name: 'SDMo Results', extensions: ['json'] }],
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return filePath
  })

  // CSV variant of the export above — same underlying data (this machine's
  // own submitted reviews), but flattened into one row per question/sub-item
  // and stripped of everything that isn't directly useful in statistical
  // software (no form_snapshot, no review_sync_id, no nested JSON values).
  // The JSON export above is unaffected and stays the format used to
  // re-import into another EnIAC install.
  ipcMain.handle('reviews:exportResultsCsv', async (_, projectId) => {
    const db = getDb()
    const project = db.prepare('SELECT name FROM projects WHERE id=?').get(projectId)
    // Own reviews alone would only ever produce a single-reviewer CSV, which
    // isn't usable for agreement statistics — those need multiple raters'
    // scores present together. Imported results (from Import Results, or
    // another coder's exported JSON) use the exact same responses_long shape
    // as getMyResponsesLong's output, so they combine directly with no
    // reshaping needed — same source data reviews:getResultsComparisonData
    // already uses to feed the Agreement Between Results page.
    const ownRows = getMyResponsesLong(db, projectId)
    const importedSources = db.prepare('SELECT data FROM imported_results WHERE project_id=?').all(projectId)
    const importedRows = importedSources.flatMap(s => {
      try { return JSON.parse(s.data) } catch { return [] }
    })
    const rows = [...ownRows, ...importedRows]
    const csv = buildCsvFromResponsesLong(rows)
    const stamp = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Results (CSV)',
      defaultPath: `${(project?.name || 'project').replace(/[^\w.-]+/g, '_')}-results-${stamp}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, csv, 'utf-8')
    return filePath
  })

  ipcMain.handle('reviews:importResultsFiles', async (_, projectId) => {
    const db = getDb()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Results',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'SDMo Results', extensions: ['json'] }],
    })
    if (canceled || !filePaths?.length) return { imported: 0, skipped: [] }

    let imported = 0
    const skipped = []
    for (const filePath of filePaths) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (parsed?.sdmo_results_export !== 1 || !Array.isArray(parsed.responses_long)) {
          skipped.push(path.basename(filePath))
          continue
        }
        db.prepare('INSERT INTO imported_results (project_id, source_name, reviewer_name, data) VALUES (?,?,?,?)')
          .run(projectId, path.basename(filePath), parsed.reviewer_name || null, JSON.stringify(parsed.responses_long))
        imported++
      } catch {
        skipped.push(path.basename(filePath))
      }
    }
    return { imported, skipped }
  })

  ipcMain.handle('reviews:listImportedResults', (_, projectId) => {
    const db = getDb()
    return db.prepare('SELECT id, source_name, reviewer_name, imported_at FROM imported_results WHERE project_id=? ORDER BY imported_at DESC').all(projectId)
  })

  ipcMain.handle('reviews:deleteImportedResult', (_, id) => {
    getDb().prepare('DELETE FROM imported_results WHERE id=?').run(id)
    return true
  })

  ipcMain.handle('reviews:getResultsComparisonData', (_, projectId) => {
    const db = getDb()
    const mine = getMyResponsesLong(db, projectId)
    const sources = db.prepare('SELECT id, source_name, reviewer_name, imported_at, data FROM imported_results WHERE project_id=? ORDER BY imported_at DESC').all(projectId)
    const imported = sources.map(s => {
      let responses_long = []
      try { responses_long = JSON.parse(s.data) } catch {}
      return { id: s.id, source_name: s.source_name, reviewer_name: s.reviewer_name, imported_at: s.imported_at, responses_long }
    })
    return { mine, imported }
  })
}