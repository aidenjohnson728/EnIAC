const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { test } = require('./_harness')
const { app } = require('electron')
const settings = require('../electron/settings')

// settings.js binds these paths from the (mocked) temp userData at load time.
const SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')
const BACKUP_PATH = SETTINGS_PATH + '.bak'

// These tests share the one temp userData, so reset the files around each test.
function clean() {
  for (const p of [SETTINGS_PATH, BACKUP_PATH, SETTINGS_PATH + '.tmp']) {
    try { fs.unlinkSync(p) } catch (_) {}
  }
}

test('settings: saveSettings merges with prior keys and getSettings round-trips', () => {
  clean()
  settings.saveSettings({ reviewer_name: 'Alice' })
  const merged = settings.saveSettings({ user_uuid: 'u-1' })
  // saveSettings returns the merged object…
  assert.strictEqual(merged.reviewer_name, 'Alice')
  assert.strictEqual(merged.user_uuid, 'u-1')
  // …and it's the same once re-read from disk.
  const s = settings.getSettings()
  assert.strictEqual(s.reviewer_name, 'Alice') // earlier key not clobbered
  assert.strictEqual(s.user_uuid, 'u-1')
  clean()
})

test('settings: a corrupt primary file falls back to the .bak copy (no data loss)', () => {
  clean()
  settings.saveSettings({ user_uuid: 'keep-me' }) // first write — no .bak yet
  settings.saveSettings({ cloud: 'token' })       // copies prior good copy → .bak
  // Simulate a crash mid-write leaving a truncated/garbage primary file.
  fs.writeFileSync(SETTINGS_PATH, 'garbage{not json')
  const s = settings.getSettings()
  assert.strictEqual(s.user_uuid, 'keep-me', 'recovered user_uuid from .bak')
  clean()
})

test('settings: an empty primary file still falls back to .bak', () => {
  clean()
  settings.saveSettings({ user_uuid: 'keep-me' })
  settings.saveSettings({ extra: 1 }) // creates .bak holding {user_uuid:'keep-me'}
  fs.writeFileSync(SETTINGS_PATH, '   ') // whitespace-only → treated as no data
  assert.strictEqual(settings.getSettings().user_uuid, 'keep-me')
  clean()
})

test('settings: getSettings returns {} when nothing exists', () => {
  clean()
  assert.deepStrictEqual(settings.getSettings(), {})
  clean()
})

test('settings: getOrCreateUUID generates once and is stable across calls', () => {
  clean()
  const first = settings.getOrCreateUUID()
  const second = settings.getOrCreateUUID()
  assert.ok(first, 'a uuid is generated')
  assert.strictEqual(first, second, 'same uuid returned on subsequent calls')
  assert.strictEqual(settings.getSettings().user_uuid, first, 'persisted to disk')
  clean()
})

test('settings: getProjectName prefers per-project name, then reviewer_name, then null', () => {
  clean()
  assert.strictEqual(settings.getProjectName(1), null) // nothing set
  settings.saveSettings({ reviewer_name: 'Default' })
  assert.strictEqual(settings.getProjectName(1), 'Default') // falls back to reviewer_name
  settings.setProjectName(1, 'Project One')
  assert.strictEqual(settings.getProjectName(1), 'Project One') // per-project override wins
  assert.strictEqual(settings.getProjectName(2), 'Default') // other projects still fall back
  clean()
})
