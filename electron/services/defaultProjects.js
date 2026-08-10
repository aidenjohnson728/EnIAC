const fs = require('fs')
const os = require('os')
const path = require('path')
const { saveForm, saveInstruction, saveMediaType } = require('./structure')
const ucatTemplate = require('./defaultProjectTemplates/ucat.json')
const sdmoTemplate = require('./defaultProjectTemplates/sdmo.json')

const DEFAULT_PROJECTS = [
  {
    id: 'ucat',
    name: ucatTemplate.name || 'UCAT',
    description: ucatTemplate.description || '',
    forms: ucatTemplate.forms || [],
    instructions: ucatTemplate.instructions || [],
    mediaTypes: ucatTemplate.mediaTypes || [],
  },{
    id: 'sdmo',
    name: sdmoTemplate.name || 'SDMo',
    description: sdmoTemplate.description || '',
    forms: sdmoTemplate.forms || [],
    instructions: sdmoTemplate.instructions || [],
    mediaTypes: sdmoTemplate.mediaTypes || [],
  },{
    id: 'ucat_sdmo',
    name: 'UCAT/SDMo',
    description: ucatTemplate.description || sdmoTemplate.description || '',
    forms: [...(ucatTemplate.forms || []), ...(sdmoTemplate.forms || [])],
    instructions: [...(ucatTemplate.instructions || []), ...(sdmoTemplate.instructions || [])],
    mediaTypes: [...(ucatTemplate.mediaTypes || []), ...(sdmoTemplate.mediaTypes || [])],
  }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueProjectName(db, baseName) {
  const existing = new Set(db.prepare('SELECT name FROM projects').all().map(row => row.name))
  if (!existing.has(baseName)) return baseName
  let i = 2
  while (existing.has(`${baseName} ${i}`)) i += 1
  return `${baseName} ${i}`
}

function safeFileName(name) {
  return String(name || 'instruction').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'instruction'
}

function defaultInstructionDir() {
  try {
    const electron = require('electron')
    if (electron && typeof electron === 'object' && electron.app?.getPath) {
      return path.join(electron.app.getPath('userData'), 'default-instructions')
    }
  } catch (_) {}
  return path.join(os.tmpdir(), 'sdmo-default-instructions')
}

function materializeInstructionFile(instruction) {
  if (instruction.content_type !== 'pdf' || !instruction.pdf_data) return instruction.file_path || null
  const dir = defaultInstructionDir()
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${safeFileName(instruction.name)}.pdf`)
  fs.writeFileSync(filePath, Buffer.from(instruction.pdf_data, 'base64'))
  return filePath
}

function listDefaultProjects(db) {
  const builtIn = DEFAULT_PROJECTS
    .filter(project => project.id !== 'ucat_sdmo')
    .map(({ id, name, description }) => ({ id, name, description, custom: false }))
  // Custom templates (from "Make Form" / "Import Form") are DB-backed, not
  // bundled JSON — persist across restarts, unlike the two built-in ones.
  // Prefixed ids avoid ever colliding with a built-in template's plain
  // string id ('sdmo', 'ucat').
  const customRows = db ? db.prepare('SELECT id, name, description FROM custom_templates ORDER BY created_at DESC').all() : []
  const custom = customRows.map(row => ({ id: `custom_${row.id}`, name: row.name, description: row.description || '', custom: true }))
  return [...builtIn, ...custom]
}

// A custom template is just one form, not a full built-in template's
// {forms, instructions, mediaTypes} — but a project seeded from it still
// needs to actually be usable, the same way SDMo/UCAT are immediately
// ready to review media in. Synthesizes a single default media type with a
// workspace tab pointing at the form, named after the form itself, so the
// resulting project isn't a form with nothing to attach it to.
function customTemplateAsSeedable(db, rowId) {
  const row = db.prepare('SELECT id, name, description, form_schema FROM custom_templates WHERE id=?').get(rowId)
  if (!row) return null
  const formName = row.name
  return {
    id: `custom_${row.id}`,
    name: row.name,
    description: row.description || '',
    forms: [{ name: formName, schema: JSON.parse(row.form_schema) }],
    instructions: [],
    mediaTypes: [{
      name: formName,
      reviews_required: 1,
      allow_custom_tags: 1,
      color: '#6366f1',
      tags: [],
      workspace_tabs: [{ tab_type: 'form', label: formName, ref_name: formName }],
    }],
  }
}

function seedDefaultProject(db, templateId) {
  let template = DEFAULT_PROJECTS.find(project => project.id === templateId)
  if (!template && String(templateId).startsWith('custom_')) {
    const rowId = String(templateId).slice('custom_'.length)
    template = customTemplateAsSeedable(db, rowId)
  }
  if (!template) throw new Error('Default project template not found')

  const name = uniqueProjectName(db, template.name)
  const result = db.prepare('INSERT INTO projects (name, description) VALUES (?,?)')
    .run(name, template.description || '')
  const projectId = result.lastInsertRowid

  const formIdsByName = new Map()
  for (const form of template.forms || []) {
    const id = saveForm(db, projectId, { name: form.name, schema: clone(form.schema) })
    formIdsByName.set(form.name, id)
  }

  const instructionIdsByName = new Map()
  for (const instruction of template.instructions || []) {
    const id = saveInstruction(db, projectId, {
      name: instruction.name,
      content: instruction.content || '',
      content_type: instruction.content_type || 'markdown',
      file_path: materializeInstructionFile(instruction),
    })
    instructionIdsByName.set(instruction.name, id)
  }

  for (const mediaType of template.mediaTypes || []) {
    saveMediaType(db, projectId, {
      name: mediaType.name,
      reviews_required: mediaType.reviews_required ?? 1,
      allow_custom_tags: mediaType.allow_custom_tags ?? 1,
      color: mediaType.color || '#6366f1',
      tags: clone(mediaType.tags || []),
      workspace_tabs: (mediaType.workspace_tabs || []).map(tab => ({
        ...tab,
        ref_id: tab.ref_id || (tab.ref_name
          ? (tab.tab_type === 'instruction' ? instructionIdsByName.get(tab.ref_name) : formIdsByName.get(tab.ref_name))
          : null),
      })).filter(tab => (tab.tab_type !== 'form' && tab.tab_type !== 'instruction') || tab.ref_id),
    })
  }

  return { id: projectId, name, templateId }
}

// Saves a standalone form (from "Make Form" or "Import Form") as a new
// custom template. Same shape both callers need: a name, optional
// description, and the form's own schema object (not yet stringified).
function createCustomTemplate(db, { name, description, formSchema }) {
  const result = db.prepare('INSERT INTO custom_templates (name, description, form_schema) VALUES (?,?,?)')
    .run(name, description || '', JSON.stringify(formSchema))
  return { id: `custom_${result.lastInsertRowid}`, name }
}

// Returns exactly what "Share" needs to write to a portable file — the IPC
// handler owns the actual dialog.showSaveDialog/fs.writeFileSync calls.
function getCustomTemplateFormForExport(db, rowId) {
  const row = db.prepare('SELECT name, description, form_schema FROM custom_templates WHERE id=?').get(rowId)
  if (!row) return null
  return { name: row.name, description: row.description || '', schema: JSON.parse(row.form_schema) }
}

module.exports = { listDefaultProjects, seedDefaultProject, createCustomTemplate, getCustomTemplateFormForExport }