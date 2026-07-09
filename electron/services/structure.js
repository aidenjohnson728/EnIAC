const { randomUUID } = require('crypto')
const { backupDb } = require('../db')
const { bumpAndSync, recordStructureTombstone } = require('../sync')
const { migrateStructureReviews } = require('./snapshots')

function nowClock() {
  return new Date().toISOString()
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function formVersionPayload(form) {
  return {
    project_id: form.project_id,
    form_sync_id: form.sync_id,
    version: form.schema_version || 1,
    name: form.name,
    schema: form.schema || '{"sections":[]}',
    source_updated_at: form.updated_at || form.created_at || null,
  }
}

function captureFormVersion(db, formId, clock = nowClock()) {
  const form = db.prepare('SELECT * FROM forms WHERE id=?').get(formId)
  if (!form?.sync_id) return
  const payload = formVersionPayload(form)
  db.prepare(`
    INSERT OR IGNORE INTO form_versions (project_id, form_sync_id, version, name, schema, source_updated_at, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(payload.project_id, payload.form_sync_id, payload.version, payload.name, payload.schema, payload.source_updated_at, clock)
}

function mediaTypeConfig(db, mediaTypeId) {
  const mt = db.prepare('SELECT * FROM media_types WHERE id=?').get(mediaTypeId)
  if (!mt) return null
  const tags = db.prepare('SELECT label, color, description, category FROM timestamp_tags WHERE media_type_id=? ORDER BY id').all(mediaTypeId)
  const tabs = db.prepare(`
    SELECT wt.tab_type, wt.ref_id, wt.label, wt.sort_order,
           f.sync_id as form_sync_id, f.name as form_name,
           i.sync_id as instruction_sync_id, i.name as instruction_name
    FROM workspace_tabs wt
    LEFT JOIN forms f ON wt.tab_type='form' AND wt.ref_id=f.id
    LEFT JOIN instructions i ON wt.tab_type='instruction' AND wt.ref_id=i.id
    WHERE wt.media_type_id=?
    ORDER BY wt.sort_order
  `).all(mediaTypeId).map(tab => ({
    tab_type: tab.tab_type,
    ref_sync_id: tab.tab_type === 'form' ? tab.form_sync_id || null : tab.instruction_sync_id || null,
    ref_name: tab.tab_type === 'form' ? tab.form_name || null : tab.instruction_name || null,
    label: tab.label,
    sort_order: tab.sort_order,
  }))
  return {
    name: mt.name,
    reviews_required: mt.reviews_required,
    allow_custom_tags: mt.allow_custom_tags ? 1 : 0,
    color: mt.color,
    tags,
    workspace_tabs: tabs,
  }
}

function captureMediaTypeVersion(db, mediaTypeId, clock = nowClock()) {
  const mt = db.prepare('SELECT * FROM media_types WHERE id=?').get(mediaTypeId)
  if (!mt?.sync_id) return
  const config = mediaTypeConfig(db, mediaTypeId)
  if (!config) return
  db.prepare(`
    INSERT OR IGNORE INTO media_type_versions (project_id, media_type_sync_id, version, name, config, source_updated_at, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(mt.project_id, mt.sync_id, mt.config_version || 1, mt.name, JSON.stringify(config), mt.updated_at || mt.created_at || null, clock)
}

function writeMediaTypeChildren(db, projectId, mediaTypeId, config) {
  db.prepare('DELETE FROM timestamp_tags WHERE media_type_id=?').run(mediaTypeId)
  db.prepare('DELETE FROM workspace_tabs WHERE media_type_id=?').run(mediaTypeId)

  const insertTag = db.prepare('INSERT INTO timestamp_tags (media_type_id, label, color, description, category) VALUES (?,?,?,?,?)')
  for (const tag of (config.tags || [])) {
    insertTag.run(mediaTypeId, tag.label, tag.color || '#6366f1', tag.description || '', tag.category || null)
  }

  const insertTab = db.prepare('INSERT INTO workspace_tabs (media_type_id, tab_type, ref_id, label, sort_order) VALUES (?,?,?,?,?)')
  for (let i = 0; i < (config.workspace_tabs || []).length; i++) {
    const tab = config.workspace_tabs[i]
    let refId = tab.ref_id || null
    if (!refId && tab.tab_type === 'form') {
      const form = tab.ref_sync_id
        ? db.prepare('SELECT id FROM forms WHERE project_id=? AND sync_id=?').get(projectId, tab.ref_sync_id)
        : db.prepare('SELECT id FROM forms WHERE project_id=? AND name=?').get(projectId, tab.ref_name || '')
      refId = form?.id || null
    } else if (!refId && tab.tab_type === 'instruction') {
      const instr = tab.ref_sync_id
        ? db.prepare('SELECT id FROM instructions WHERE project_id=? AND sync_id=?').get(projectId, tab.ref_sync_id)
        : db.prepare('SELECT id FROM instructions WHERE project_id=? AND name=?').get(projectId, tab.ref_name || '')
      refId = instr?.id || null
    }
    if (refId) insertTab.run(mediaTypeId, tab.tab_type, refId, tab.label, i)
  }
}

function saveMediaType(db, projectId, data) {
  let mediaTypeId = data.id || null
  const clock = nowClock()
  db.transaction(() => {
    if (mediaTypeId) {
      captureMediaTypeVersion(db, mediaTypeId, clock)
      db.prepare("UPDATE media_types SET name=?, reviews_required=?, allow_custom_tags=?, color=?, config_version=COALESCE(config_version,1)+1, updated_at=? WHERE id=?")
        .run(data.name, data.reviews_required, data.allow_custom_tags ? 1 : 0, data.color, clock, mediaTypeId)
    } else {
      const r = db.prepare("INSERT INTO media_types (project_id, name, reviews_required, allow_custom_tags, color, sync_id, updated_at) VALUES (?,?,?,?,?,?,?)")
        .run(projectId, data.name, data.reviews_required || 1, data.allow_custom_tags ? 1 : 0, data.color || '#6366f1', randomUUID(), clock)
      mediaTypeId = r.lastInsertRowid
    }
    writeMediaTypeChildren(db, projectId, mediaTypeId, data)
  })()
  bumpAndSync(db, projectId)
  return mediaTypeId
}

function deleteMediaType(db, projectId, id) {
  backupDb('pre-delete-mediatype')
  const clock = nowClock()
  const activeReviews = db.prepare(`
    SELECT COUNT(*) as n FROM reviews r
    JOIN media_files mf ON r.media_file_id = mf.id
    WHERE mf.media_type_id=? AND r.deleted_at IS NULL
  `).get(id).n
  if (activeReviews > 0) {
    captureMediaTypeVersion(db, id, clock)
    db.prepare("UPDATE media_types SET archived_at=?, config_version=COALESCE(config_version,1)+1, updated_at=? WHERE id=?").run(clock, clock, id)
    bumpAndSync(db, projectId)
    return true
  }
  recordStructureTombstone(db, projectId, 'media_type', id)
  db.prepare('DELETE FROM media_types WHERE id=?').run(id)
  bumpAndSync(db, projectId)
  return true
}

function saveForm(db, projectId, data) {
  const schema = typeof data.schema === 'string' ? data.schema : JSON.stringify(data.schema)
  const clock = nowClock()
  if (data.id) {
    captureFormVersion(db, data.id, clock)
    db.prepare("UPDATE forms SET name=?, schema=?, schema_version=COALESCE(schema_version,1)+1, updated_at=? WHERE id=?").run(data.name, schema, clock, data.id)
    migrateStructureReviews(db, projectId, 'form', data.id, 'all')
    bumpAndSync(db, projectId)
    return data.id
  }
  const r = db.prepare("INSERT INTO forms (project_id, name, schema, sync_id, updated_at) VALUES (?,?,?,?,?)")
    .run(projectId, data.name, schema, randomUUID(), clock)
  bumpAndSync(db, projectId)
  return r.lastInsertRowid
}

function deleteForm(db, projectId, id) {
  backupDb('pre-delete-form')
  const clock = nowClock()
  const responses = db.prepare('SELECT COUNT(*) as n FROM form_responses WHERE form_id=?').get(id).n
  if (responses > 0) {
    captureFormVersion(db, id, clock)
    db.prepare("UPDATE forms SET archived_at=?, schema_version=COALESCE(schema_version,1)+1, updated_at=? WHERE id=?").run(clock, clock, id)
    db.prepare("UPDATE media_types SET config_version=COALESCE(config_version,1)+1, updated_at=? WHERE id IN (SELECT media_type_id FROM workspace_tabs WHERE tab_type='form' AND ref_id=?)").run(clock, id)
    db.prepare("DELETE FROM workspace_tabs WHERE tab_type='form' AND ref_id=?").run(id)
    bumpAndSync(db, projectId)
    return true
  }
  recordStructureTombstone(db, projectId, 'form', id)
  db.prepare("UPDATE media_types SET config_version=COALESCE(config_version,1)+1, updated_at=? WHERE id IN (SELECT media_type_id FROM workspace_tabs WHERE tab_type='form' AND ref_id=?)").run(clock, id)
  db.prepare("DELETE FROM workspace_tabs WHERE tab_type='form' AND ref_id=?").run(id)
  db.prepare('DELETE FROM forms WHERE id=?').run(id)
  bumpAndSync(db, projectId)
  return true
}

function listVersionHistory(db, projectId, kind, id) {
  if (kind === 'form') {
    const form = db.prepare('SELECT * FROM forms WHERE project_id=? AND id=?').get(projectId, id)
    if (!form) return []
    const history = db.prepare(`
      SELECT version, name, schema, source_updated_at, created_at, 0 as is_current
      FROM form_versions
      WHERE project_id=? AND form_sync_id=?
      ORDER BY version DESC
    `).all(projectId, form.sync_id)
    return [
      {
        version: form.schema_version || 1,
        name: form.name,
        schema: parseJson(form.schema, { sections: [] }),
        source_updated_at: form.updated_at || form.created_at || null,
        created_at: form.updated_at || form.created_at || null,
        is_current: 1,
      },
      ...history.map(v => ({ ...v, schema: parseJson(v.schema, { sections: [] }) })),
    ]
  }

  if (kind === 'mediaType') {
    const mt = db.prepare('SELECT * FROM media_types WHERE project_id=? AND id=?').get(projectId, id)
    if (!mt) return []
    const currentConfig = mediaTypeConfig(db, id)
    const history = db.prepare(`
      SELECT version, name, config, source_updated_at, created_at, 0 as is_current
      FROM media_type_versions
      WHERE project_id=? AND media_type_sync_id=?
      ORDER BY version DESC
    `).all(projectId, mt.sync_id)
    return [
      {
        version: mt.config_version || 1,
        name: mt.name,
        config: currentConfig,
        source_updated_at: mt.updated_at || mt.created_at || null,
        created_at: mt.updated_at || mt.created_at || null,
        is_current: 1,
      },
      ...history.map(v => ({ ...v, config: parseJson(v.config, {}) })),
    ]
  }
  return []
}

function restoreVersion(db, projectId, kind, id, version) {
  const clock = nowClock()
  let restoredVersion = null
  db.transaction(() => {
    if (kind === 'form') {
      const form = db.prepare('SELECT * FROM forms WHERE project_id=? AND id=?').get(projectId, id)
      if (!form) throw new Error('Form not found')
      const historical = db.prepare('SELECT * FROM form_versions WHERE project_id=? AND form_sync_id=? AND version=?')
        .get(projectId, form.sync_id, version)
      if (!historical) throw new Error('Form version not found')
      captureFormVersion(db, id, clock)
      restoredVersion = (form.schema_version || 1) + 1
      db.prepare('UPDATE forms SET name=?, schema=?, schema_version=?, archived_at=NULL, updated_at=? WHERE id=?')
        .run(historical.name, historical.schema, restoredVersion, clock, id)
      migrateStructureReviews(db, projectId, 'form', id, 'all')
    } else if (kind === 'mediaType') {
      const mt = db.prepare('SELECT * FROM media_types WHERE project_id=? AND id=?').get(projectId, id)
      if (!mt) throw new Error('Media type not found')
      const historical = db.prepare('SELECT * FROM media_type_versions WHERE project_id=? AND media_type_sync_id=? AND version=?')
        .get(projectId, mt.sync_id, version)
      if (!historical) throw new Error('Media type version not found')
      const config = parseJson(historical.config, null)
      if (!config) throw new Error('Media type version is invalid')
      captureMediaTypeVersion(db, id, clock)
      restoredVersion = (mt.config_version || 1) + 1
      db.prepare('UPDATE media_types SET name=?, reviews_required=?, allow_custom_tags=?, color=?, config_version=?, archived_at=NULL, updated_at=? WHERE id=?')
        .run(historical.name || config.name, config.reviews_required || 1, config.allow_custom_tags ? 1 : 0, config.color || '#6366f1', restoredVersion, clock, id)
      writeMediaTypeChildren(db, projectId, id, config)
    } else {
      throw new Error('Unsupported version type')
    }
  })()
  bumpAndSync(db, projectId)
  return { kind, id, restored_from_version: version, current_version: restoredVersion }
}

function saveInstruction(db, projectId, data) {
  const clock = nowClock()
  if (data.id) {
    db.prepare("UPDATE instructions SET name=?, content=?, content_type=?, file_path=?, updated_at=? WHERE id=?")
      .run(data.name, data.content || '', data.content_type || 'markdown', data.file_path || null, clock, data.id)
    bumpAndSync(db, projectId)
    return data.id
  }
  const r = db.prepare("INSERT INTO instructions (project_id, name, content, content_type, file_path, sync_id, updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(projectId, data.name, data.content || '', data.content_type || 'markdown', data.file_path || null, randomUUID(), clock)
  bumpAndSync(db, projectId)
  return r.lastInsertRowid
}

function deleteInstruction(db, projectId, id) {
  backupDb('pre-delete-instruction')
  recordStructureTombstone(db, projectId, 'instruction', id)
  db.prepare('DELETE FROM instructions WHERE id=?').run(id)
  bumpAndSync(db, projectId)
  return true
}

module.exports = {
  saveMediaType,
  deleteMediaType,
  saveForm,
  deleteForm,
  listVersionHistory,
  restoreVersion,
  saveInstruction,
  deleteInstruction,
}
