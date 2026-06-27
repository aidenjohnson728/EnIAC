const { getDb } = require('../db')
const { dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { bumpConfigVersion, scheduleSync } = require('../sync')

const VIDEO_EXTS = ['.mp4', '.mp3', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wav', '.ogg']
const DOC_EXTS = ['.pdf', '.txt', '.md', '.docx']

function getFileType(ext) {
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (DOC_EXTS.includes(ext)) return 'document'
  return 'other'
}

module.exports = function (ipcMain) {
  ipcMain.handle('media:list', (_, encounterId) => {
    const db = getDb()
    const files = db.prepare(`
      SELECT mf.*, mt.name as media_type_name, mt.reviews_required, mt.color as media_type_color
      FROM media_files mf
      LEFT JOIN media_types mt ON mf.media_type_id = mt.id
      WHERE mf.encounter_id=?
      ORDER BY mf.name
    `).all(encounterId)

    for (const f of files) {
      f.reviews = db.prepare('SELECT id, reviewer_name, status, created_at, submitted_at FROM reviews WHERE media_file_id=? AND deleted_at IS NULL').all(f.id)
      f.reviews_completed = f.reviews.filter(r => r.status === 'submitted').length
    }
    return files
  })

  ipcMain.handle('media:get', (_, id) => {
    const db = getDb()
    const file = db.prepare(`
      SELECT mf.*, mt.name as media_type_name, mt.reviews_required, mt.color as media_type_color
      FROM media_files mf
      LEFT JOIN media_types mt ON mf.media_type_id = mt.id
      WHERE mf.id=?
    `).get(id)
    if (file) {
      file.reviews = db.prepare('SELECT * FROM reviews WHERE media_file_id=? AND deleted_at IS NULL').all(file.id)
    }
    return file
  })

  ipcMain.handle('media:updateType', (_, id, mediaTypeId) => {
    const db = getDb()
    db.prepare('UPDATE media_files SET media_type_id=? WHERE id=?').run(mediaTypeId || null, id)
    const mf = db.prepare('SELECT encounter_id FROM media_files WHERE id=?').get(id)
    const enc = mf ? db.prepare('SELECT project_id FROM encounters WHERE id=?').get(mf.encounter_id) : null
    if (enc?.project_id) {
      bumpConfigVersion(db, enc.project_id)
      scheduleSync(enc.project_id)
    }
    return true
  })

  ipcMain.handle('media:getUrl', (_, filePath) => {
    return `localfile://${filePath}`
  })

  ipcMain.handle('fs:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs:scanMediaFolder', (_, folderPath, projectId) => {
    const db = getDb()
    if (!fs.existsSync(folderPath)) return { error: 'Folder not found' }

    const encounterDirs = fs.readdirSync(folderPath, { withFileTypes: true }).filter(d => d.isDirectory())

    let encountersAdded = 0
    let encountersLinked = 0
    let filesAdded = 0
    let filesLinked = 0

    const tx = db.transaction(() => {
      for (const dir of encounterDirs) {
        const encounterPath = path.join(folderPath, dir.name)
        // Match by exact folder path first, then by name (handles folder moves/renames)
        let enc = db.prepare('SELECT * FROM encounters WHERE project_id=? AND folder_path=?').get(projectId, encounterPath)
        if (!enc) {
          const byName = db.prepare('SELECT * FROM encounters WHERE project_id=? AND name=?').get(projectId, dir.name)
          if (byName) {
            db.prepare('UPDATE encounters SET folder_path=? WHERE id=?').run(encounterPath, byName.id)
            enc = byName
            encountersLinked++
          } else {
            const r = db.prepare('INSERT INTO encounters (project_id, name, folder_path, sync_id) VALUES (?,?,?,?)').run(projectId, dir.name, encounterPath, crypto.randomUUID())
            enc = { id: r.lastInsertRowid }
            encountersAdded++
          }
        }

        const files = fs.readdirSync(encounterPath, { withFileTypes: true }).filter(f => f.isFile())
        for (const file of files) {
          const ext = path.extname(file.name).toLowerCase()
          const fileType = getFileType(ext)
          const filePath = path.join(encounterPath, file.name)
          const existing = db.prepare('SELECT id FROM media_files WHERE encounter_id=? AND file_path=?').get(enc.id, filePath)
            || db.prepare('SELECT id FROM media_files WHERE encounter_id=? AND name=?').get(enc.id, file.name)
          if (existing) {
            db.prepare('UPDATE media_files SET file_path=?, file_type=? WHERE id=?').run(filePath, fileType, existing.id)
            filesLinked++
          } else {
            db.prepare('INSERT INTO media_files (encounter_id, name, file_path, file_type, sync_id) VALUES (?,?,?,?,?)').run(enc.id, file.name, filePath, fileType, crypto.randomUUID())
            filesAdded++
          }
        }
      }
    })
    tx()

    if (encountersAdded > 0 || filesAdded > 0) {
      bumpConfigVersion(db, projectId)
      scheduleSync(projectId)
    }

    // Count files still unlinked after scan (structure exists but no local file found)
    const stillUnlinked = db.prepare(`
      SELECT COUNT(*) as n FROM media_files mf
      JOIN encounters e ON mf.encounter_id = e.id
      WHERE e.project_id=? AND (mf.file_path IS NULL OR mf.file_path = '')
    `).get(projectId).n

    const stillBroken = db.prepare(`
      SELECT mf.name, e.name as enc_name, mf.file_path FROM media_files mf
      JOIN encounters e ON mf.encounter_id = e.id
      WHERE e.project_id=? AND mf.file_path IS NOT NULL AND mf.file_path != ''
    `).all(projectId).filter(f => !fs.existsSync(f.file_path)).length

    const ALL_EXTS = [...VIDEO_EXTS, ...DOC_EXTS]
    const directMediaFiles = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(f => f.isFile() && ALL_EXTS.includes(path.extname(f.name).toLowerCase()))
      .length

    return { encountersAdded, encountersLinked, filesAdded, filesLinked, directMediaFiles, totalSubfolders: encounterDirs.length, stillUnlinked, stillBroken }
  })

  ipcMain.handle('media:countReviews', (_, mediaFileId) => {
    const db = getDb()
    return db.prepare('SELECT COUNT(*) as n FROM reviews WHERE media_file_id=? AND deleted_at IS NULL').get(mediaFileId).n
  })

  ipcMain.handle('media:move', (_, projectId, mediaFileId, newEncounterId) => {
    const db = getDb()
    db.prepare('UPDATE media_files SET encounter_id=? WHERE id=?').run(newEncounterId, mediaFileId)
    bumpConfigVersion(db, projectId)
    scheduleSync(projectId)
    return true
  })

  ipcMain.handle('media:rename', (_, projectId, mediaFileId, name) => {
    const db = getDb()
    db.prepare('UPDATE media_files SET name=? WHERE id=?').run(name.trim(), mediaFileId)
    bumpConfigVersion(db, projectId)
    scheduleSync(projectId)
    return true
  })

  // Returns how many media files on this machine are unlinked (no path) or broken (path missing on disk)
  ipcMain.handle('media:healthCheck', (_, projectId) => {
    const db = getDb()
    const project = db.prepare('SELECT media_folder FROM projects WHERE id=?').get(projectId)
    const encounters = db.prepare('SELECT id, name FROM encounters WHERE project_id=?').all(projectId)
    let unlinked = 0, broken = 0, ok = 0
    const issues = []
    for (const enc of encounters) {
      const files = db.prepare('SELECT id, name, file_path FROM media_files WHERE encounter_id=?').all(enc.id)
      for (const f of files) {
        if (!f.file_path) {
          unlinked++
          issues.push({ encounter: enc.name, file: f.name, reason: 'unlinked' })
        } else if (!fs.existsSync(f.file_path)) {
          broken++
          issues.push({ encounter: enc.name, file: f.name, reason: 'missing', path: f.file_path })
        } else {
          ok++
        }
      }
    }
    return { unlinked, broken, ok, total: unlinked + broken + ok, hasMediaFolder: !!project?.media_folder, issues }
  })

  ipcMain.handle('media:deleteFile', (_, projectId, mediaFileId) => {
    const db = getDb()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM timestamps WHERE review_id IN (SELECT id FROM reviews WHERE media_file_id=?)').run(mediaFileId)
      db.prepare('DELETE FROM form_responses WHERE review_id IN (SELECT id FROM reviews WHERE media_file_id=?)').run(mediaFileId)
      db.prepare('DELETE FROM reviews WHERE media_file_id=?').run(mediaFileId)
      db.prepare('DELETE FROM media_files WHERE id=?').run(mediaFileId)
    })
    tx()
    bumpConfigVersion(db, projectId)
    scheduleSync(projectId)
    return true
  })
}
