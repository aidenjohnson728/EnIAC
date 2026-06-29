const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

let logPath = null

function setupFileLogging() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logPath = path.join(dir, 'sdmo.log')
    const stream = fs.createWriteStream(logPath, { flags: 'a' })
    const original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    }

    for (const level of Object.keys(original)) {
      console[level] = (...args) => {
        original[level](...args)
        try {
          const line = args.map(arg => {
            if (arg instanceof Error) return arg.stack || arg.message
            if (typeof arg === 'string') return arg
            return JSON.stringify(arg)
          }).join(' ')
          stream.write(`${new Date().toISOString()} [${level}] ${line}\n`)
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[diagnostics] file logging setup failed:', e?.message || e)
  }
}

function listBackups() {
  try {
    const dir = path.join(app.getPath('userData'), 'backups')
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('sdmo-') && f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(dir, f))
        return { file: f, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  } catch (_) {
    return []
  }
}

function projectSummary() {
  try {
    const { getDb } = require('./db')
    const db = getDb()
    const projects = db.prepare(`
      SELECT
        p.id,
        CASE
          WHEN p.cloud_provider IS NOT NULL THEN 'cloud'
          WHEN p.sync_folder IS NOT NULL THEN 'local'
          ELSE 'none'
        END AS sync_mode,
        p.cloud_provider,
        COUNT(DISTINCT e.id) AS encounters,
        COUNT(DISTINCT mf.id) AS media_files,
        COUNT(DISTINCT r.id) AS reviews
      FROM projects p
      LEFT JOIN encounters e ON e.project_id = p.id
      LEFT JOIN media_files mf ON mf.encounter_id = e.id
      LEFT JOIN reviews r ON r.media_file_id = mf.id AND r.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.id
    `).all()
    return projects.map(p => ({
      id: p.id,
      syncMode: p.sync_mode,
      cloudProvider: p.cloud_provider || null,
      encounters: p.encounters,
      mediaFiles: p.media_files,
      reviews: p.reviews,
    }))
  } catch (e) {
    return { error: e?.message || String(e) }
  }
}

function readRecentLog() {
  if (!logPath) return ''
  try {
    const maxBytes = 200 * 1024
    const stat = fs.statSync(logPath)
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(logPath, 'r')
    const buffer = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    fs.closeSync(fd)
    return buffer.toString('utf8')
  } catch (_) {
    return ''
  }
}

function buildDiagnostics() {
  const pkg = require('../package.json')
  const userData = app.getPath('userData')
  const dbPath = path.join(userData, 'sdmo.db')
  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      appId: pkg.build?.appId || null,
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
    paths: {
      userData,
      databaseExists: fs.existsSync(dbPath),
      logPath,
    },
    backups: listBackups(),
    projects: projectSummary(),
    update: (() => {
      try { return require('./updater').getUpdateStatus() } catch (_) { return null }
    })(),
    recentLog: readRecentLog(),
  }
}

function getLogPath() {
  return logPath
}

module.exports = { setupFileLogging, buildDiagnostics, getLogPath }
