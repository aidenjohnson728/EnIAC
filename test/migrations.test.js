const path = require('path')
const assert = require('node:assert')
const { test } = require('./_harness')
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))
const { initSchema, migrate, runDataMigrations } = require('../electron/db')
const { makeDb } = require('./helpers')

function rawDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  migrate(db) // columns + indexes, but NOT the user_version data migrations
  return db
}

test('migrations: schema has all core tables', () => {
  const db = makeDb()
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  for (const t of ['projects', 'media_types', 'timestamp_tags', 'forms', 'instructions',
    'workspace_tabs', 'encounters', 'media_files', 'reviews', 'timestamps',
    'form_responses', 'deleted_reviews', 'media_file_links']) {
    assert.ok(names.includes(t), `missing table ${t}`)
  }
  db.close()
})

test('migrations: hot-path indexes exist', () => {
  const db = makeDb()
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name)
  for (const i of ['idx_reviews_media_file', 'idx_reviews_sync', 'idx_media_files_encounter',
    'idx_media_files_sync', 'idx_timestamps_review', 'idx_form_responses_review',
    'idx_encounters_project']) {
    assert.ok(idx.includes(i), `missing index ${i}`)
  }
  db.close()
})

test('migrations: runDataMigrations backfills sync ids and advances user_version once per run', () => {
  const db = rawDb()
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0)

  const p = db.prepare('INSERT INTO projects (name) VALUES (?)').run('P').lastInsertRowid
  const e = db.prepare('INSERT INTO encounters (project_id, name, folder_path) VALUES (?,?,?)').run(p, 'E', '').lastInsertRowid
  const m = db.prepare('INSERT INTO media_files (encounter_id, name, file_path, file_type) VALUES (?,?,?,?)').run(e, 'M', '', 'video').lastInsertRowid
  db.prepare('INSERT INTO reviews (media_file_id, reviewer_name) VALUES (?,?)').run(m, 'Alice')
  const f = db.prepare('INSERT INTO forms (project_id, name) VALUES (?,?)').run(p, 'F').lastInsertRowid
  const mt = db.prepare('INSERT INTO media_types (project_id, name) VALUES (?,?)').run(p, 'Video').lastInsertRowid

  // Pre-condition: legacy rows have NULL sync ids (encounter/media + forms/media_types)
  assert.strictEqual(db.prepare('SELECT sync_id FROM encounters WHERE id=?').get(e).sync_id, null)
  assert.strictEqual(db.prepare('SELECT sync_id FROM forms WHERE id=?').get(f).sync_id, null)

  runDataMigrations(db)

  // Two data migrations exist now (v0→v1 encounter/media/review, v1→v2 form/media_type/instruction).
  const TARGET = 2
  assert.strictEqual(db.pragma('user_version', { simple: true }), TARGET)
  assert.ok(db.prepare('SELECT sync_id FROM encounters WHERE id=?').get(e).sync_id)
  assert.ok(db.prepare('SELECT sync_id FROM media_files WHERE id=?').get(m).sync_id)
  assert.ok(db.prepare('SELECT review_sync_id FROM reviews WHERE media_file_id=?').get(m).review_sync_id)
  assert.ok(db.prepare('SELECT sync_id FROM forms WHERE id=?').get(f).sync_id)
  assert.ok(db.prepare('SELECT sync_id FROM media_types WHERE id=?').get(mt).sync_id)

  // Idempotent: capture ids, re-run, confirm unchanged and version stays put
  const before = db.prepare('SELECT sync_id FROM encounters WHERE id=?').get(e).sync_id
  runDataMigrations(db)
  assert.strictEqual(db.pragma('user_version', { simple: true }), TARGET)
  assert.strictEqual(db.prepare('SELECT sync_id FROM encounters WHERE id=?').get(e).sync_id, before)
  db.close()
})
