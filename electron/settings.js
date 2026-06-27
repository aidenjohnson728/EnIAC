const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')

const SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')

function getSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) } catch { return {} }
}

function saveSettings(data) {
  const current = getSettings()
  const merged = { ...current, ...data }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2))
  return merged
}

// Returns the stable UUID for this installation, generating one if needed
function getOrCreateUUID() {
  const s = getSettings()
  if (s.user_uuid) return s.user_uuid
  const uuid = randomUUID()
  saveSettings({ user_uuid: uuid })
  return uuid
}

// Per-project display name: stored as project_names[projectId] in settings
function getProjectName(projectId) {
  const s = getSettings()
  return s.project_names?.[String(projectId)] || s.reviewer_name || null
}

function setProjectName(projectId, name) {
  const s = getSettings()
  const project_names = { ...(s.project_names || {}), [String(projectId)]: name }
  saveSettings({ project_names })
}

module.exports = { getSettings, saveSettings, getOrCreateUUID, getProjectName, setProjectName }
