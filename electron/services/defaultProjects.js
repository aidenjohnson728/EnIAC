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

function listDefaultProjects() {
  return DEFAULT_PROJECTS.map(({ id, name, description }) => ({ id, name, description }))
}

function seedDefaultProject(db, templateId) {
  const template = DEFAULT_PROJECTS.find(project => project.id === templateId)
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

module.exports = { listDefaultProjects, seedDefaultProject }
