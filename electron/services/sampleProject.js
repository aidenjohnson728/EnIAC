const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')
const { app } = require('electron')
const { saveForm, saveMediaType } = require('./structure')
const { upsertLink } = require('../mediaLinks')

const SAMPLE_NAME = '📘 Sample Tutorial Project'
const SAMPLE_DESCRIPTION =
  'A read-along example project. Walk through encounters, media, media types, file linking, and the review page. Safe to delete once you are comfortable.'

// Resolves the bundled sample video shipped via electron-builder `extraResources`.
// Dev runs from the repo; packaged builds copy media/ into Resources/.
function sampleVideoPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'media', 'sample-encounter.mp4')]
    : [path.join(__dirname, '..', '..', 'media', 'sample-encounter.mp4')]
  return candidates.find(p => fs.existsSync(p)) || candidates[0]
}

function sampleFormSchema() {
  return {
    sections: [
      {
        id: randomUUID(),
        title: 'Encounter Overview',
        elements: [
          { id: randomUUID(), type: 'short_answer', label: 'Chief complaint', placeholder: 'e.g. persistent cough' },
          { id: randomUUID(), type: 'multiple_choice', label: 'Encounter setting', options: ['Inpatient', 'Outpatient', 'Telehealth'] },
        ],
      },
      {
        id: randomUUID(),
        title: 'Communication Quality',
        elements: [
          { id: randomUUID(), type: 'rating', label: 'Overall clinician rapport', options: ['1', '2', '3', '4', '5'] },
          { id: randomUUID(), type: 'paragraph', label: 'Notes for the research team', placeholder: 'Anything notable about this encounter…' },
        ],
      },
    ],
  }
}

function seedSampleProject(db) {
  // Idempotent: if a sample project already exists, just reopen it.
  const existing = db.prepare('SELECT id FROM projects WHERE name=?').get(SAMPLE_NAME)
  if (existing) return { id: existing.id, alreadyExisted: true }

  const result = db.prepare('INSERT INTO projects (name, description) VALUES (?,?)').run(SAMPLE_NAME, SAMPLE_DESCRIPTION)
  const projectId = result.lastInsertRowid

  // 1. A form with a mix of element types so the workspace shows variety.
  const formId = saveForm(db, projectId, { name: 'Encounter Coding Form', schema: sampleFormSchema() })

  // 2. A media type wiring the form into the workspace, with a few timestamp tags.
  saveMediaType(db, projectId, {
    name: 'Consultation Video',
    reviews_required: 1,
    allow_custom_tags: 1,
    color: '#6366f1',
    tags: [
      { label: 'Greeting', color: '#22c55e', description: 'Clinician introduces themselves' },
      { label: 'Question', color: '#3b82f6', description: 'Open or closed question asked' },
      { label: 'Empathy', color: '#a855f7', description: 'Empathic statement or acknowledgement' },
    ],
    workspace_tabs: [
      { tab_type: 'form', ref_id: formId, label: 'Coding Form' },
    ],
  })

  const mediaType = db.prepare('SELECT id FROM media_types WHERE project_id=? ORDER BY id DESC LIMIT 1').get(projectId)
  const mediaTypeId = mediaType?.id || null

  // 3. A few encounters. The first media file is linked to the bundled sample
  //    video so its review page genuinely plays; the rest stay unlinked so the
  //    Files/autolink tour and the media-health banner have real targets.
  const insertEncounter = db.prepare(
    "INSERT INTO encounters (project_id, name, folder_path, sync_id, updated_at) VALUES (?,?,?,?,datetime('now'))"
  )
  const insertMedia = db.prepare(
    "INSERT INTO media_files (encounter_id, name, file_path, file_type, media_type_id, sync_id, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))"
  )

  const videoPath = sampleVideoPath()
  const encounters = ['Patient 001', 'Patient 002', 'Patient 003']
  encounters.forEach((encName, idx) => {
    const enc = insertEncounter.run(projectId, encName, '', randomUUID())
    const mediaName = 'consultation.mp4'
    // Patient 001 gets an absolute path to the bundled video so the media server
    // can serve it and the review page plays. Others stay empty (unlinked) so the
    // Files tour has real targets to point at.
    const filePath = idx === 0 ? videoPath : ''
    const mf = insertMedia.run(enc.lastInsertRowid, mediaName, filePath, 'video', mediaTypeId, randomUUID())
    if (idx === 0) {
      upsertLink(db, mf.lastInsertRowid, videoPath, false)
    }
  })

  return { id: projectId, alreadyExisted: false }
}

module.exports = { seedSampleProject, SAMPLE_NAME }
