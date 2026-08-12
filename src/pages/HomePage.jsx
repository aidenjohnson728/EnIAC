import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, Trash2, Settings, ChevronRight, Calendar, User, HelpCircle, ClipboardList, FilePlus, FileDown, Share2, Sun, Moon } from 'lucide-react'
import { api, formatDate } from '../lib/api'
import Modal from '../components/ui/Modal'
import useTour from '../components/ui/useTour'
import appIcon from '../assets/app-icon-transparent.png'
import { useTheme } from '../App'

const TUTORIAL_KEY = 'sdmo_tutorial_v1'
// Bridges the New Project modal across the navigation to /form-builder and
// back — sessionStorage (not localStorage) because this should only ever
// survive within the current app session, not persist indefinitely.
const PENDING_NEW_PROJECT_KEY = 'eniac_pending_new_project'
const JUST_CREATED_TEMPLATE_KEY = 'eniac_just_created_template_id'

const TUTORIAL_STEPS = [
  {
    targetId: 'tut-name',
    placement: 'bottom',
    title: 'Your Reviewer Name',
    body: 'This name is attached to every review you create. Use the same name on every device, spelled the same way, so synced reviews stay grouped under the right person.',
  },
  {
    targetId: 'tut-new',
    placement: 'bottom',
    title: 'Creating a New Project',
    body: "Start fresh. After creating a project you'll be taken to Settings. The Overview tab walks through forms, instructions, media types, files, and sync in the order most teams set them up.",
  },
  {
    targetId: 'tut-help',
    placement: 'bottom',
    title: 'Reopen This Tour',
    body: "Click the ? button any time to run this tutorial again.",
  },
]

export default function HomePage() {
  const { theme, toggleTheme } = useTheme()
  const [projects, setProjects] = useState([])
  const [defaultProjects, setDefaultProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [reviewerName, setReviewerName] = useState(null)
  const [showIdentity, setShowIdentity] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [importedProject, setImportedProject] = useState(null) // { id, name, syncHint }
  const [importMediaFolder, setImportMediaFolder] = useState('')
  const [importReviewerName, setImportReviewerName] = useState('')
  const [pendingImportData, setPendingImportData] = useState(null)
  const [pendingImportRoster, setPendingImportRoster] = useState([])
  const [chosenImportName, setChosenImportName] = useState('')
  const [importSyncFolder, setImportSyncFolder] = useState('')
  const tour = useTour(TUTORIAL_STEPS, TUTORIAL_KEY)
  const navigate = useNavigate()

  useEffect(() => {
    load()
    api.listDefaultProjects?.().then(setDefaultProjects).catch(() => setDefaultProjects([]))
    api.getAppSettings().then(s => {
      setReviewerName(s.reviewer_name || null)
      if (!s.reviewer_name) setShowIdentity(true)
    })
    // "Make Form" navigates away to a whole separate page (form building
    // doesn't fit in this modal), so the in-progress name/description would
    // otherwise be lost. FormBuilderPage stashes both, plus the newly
    // created template's id, in sessionStorage right before navigating
    // back here — pick that back up and re-open New Project exactly where
    // the person left off, with the new form already selected.
    const pending = sessionStorage.getItem(PENDING_NEW_PROJECT_KEY)
    if (pending) {
      try {
        const { name, description } = JSON.parse(pending)
        setForm({ name: name || '', description: description || '' })
      } catch { /* ignore malformed value */ }
      sessionStorage.removeItem(PENDING_NEW_PROJECT_KEY)
      const newTemplateId = sessionStorage.getItem(JUST_CREATED_TEMPLATE_KEY)
      if (newTemplateId) {
        setSelectedTemplateId(newTemplateId)
        sessionStorage.removeItem(JUST_CREATED_TEMPLATE_KEY)
      }
      setShowCreate(true)
    }
  }, [])

  function handleMakeForm() {
    // Save what's already been typed so New Project can resume with it
    // once the person is done building the form and comes back here.
    sessionStorage.setItem(PENDING_NEW_PROJECT_KEY, JSON.stringify({ name: form.name, description: form.description }))
    navigate('/form-builder')
  }

  async function handleImportFormForNewProject() {
    const result = await api.importTemplateForm()
    if (result?.error) {
      window.alert(result.error)
      return
    }
    if (result?.ok) {
      api.listDefaultProjects?.().then(setDefaultProjects).catch(() => {})
      setSelectedTemplateId(result.id)
    }
  }

  async function handleShareTemplateForm(templateId, e) {
    e?.stopPropagation()
    await api.exportTemplateForm(templateId)
  }

  async function handleSaveName() {
    if (!nameInput.trim()) return
    await api.setAppSettings({ reviewer_name: nameInput.trim() })
    setReviewerName(nameInput.trim())
    setShowIdentity(false)
  }


  async function handleImportProject() {
    const preview = await api.previewImportProjectFile()
    if (!preview) return
    if (preview.error) {
      window.alert(preview.error)
      return
    }
    if (preview.roster?.length > 0) {
      // Multiple names to choose from — hold the parsed data until they
      // pick which one is them; nothing is created yet.
      setPendingImportData(preview.data)
      setPendingImportRoster(preview.roster)
      setChosenImportName('')
      return
    }
    // No roster in this file (older export, or shared without one) —
    // create the project now with no assigned role (defaults to 'leader'),
    // and fall through to the existing free-text "Your Name" step.
    await finalizeImport(preview.data, null)
  }

  async function handleChooseImportName() {
    if (!chosenImportName) return
    const data = pendingImportData
    setPendingImportData(null)
    setPendingImportRoster([])
    await finalizeImport(data, chosenImportName)
  }

  async function finalizeImport(data, chosenName) {
    const result = await api.importProjectAsNew(data, chosenName)
    if (!result?.ok) return
    await load()
    if (chosenName) {
      // Roster pick already determined name + role — nothing essential
      // left to collect, so skip straight to the project instead of the
      // media-folder setup step (still available later via Setup).
      navigate(`/project/${result.projectId}`)
      return
    }
    const projects = await api.listProjects()
    const proj = projects.find(p => p.id === result.projectId)
    setImportMediaFolder('')
    setImportSyncFolder('')
    setImportReviewerName('')
    setImportedProject({
      id: result.projectId,
      name: proj?.name || 'Imported Project',
      syncHint: result.syncHint || { mode: 'none', provider: null },
    })
  }

  async function handleFinishImport() {
    const proj = await api.getProject(importedProject.id)
    const syncMode = importedProject.syncHint?.mode
    await api.updateProject(importedProject.id, {
      ...proj,
      media_folder: importMediaFolder || null,
      sync_folder: syncMode === 'local' ? (importSyncFolder || null) : null,
    })
    if (importMediaFolder) {
      await api.scanMediaFolder(importMediaFolder, importedProject.id)
    }
    // Explicit per-project name, set here rather than left to silently fall
    // back to the global reviewer_name — someone opening a shared project
    // may have used a slightly different spelling/nickname elsewhere, and
    // that inconsistency would otherwise go unnoticed. This function only
    // ever runs for the no-roster fallback case now — a roster pick skips
    // straight to the project, name already set by createFromImport.
    if (importReviewerName.trim()) {
      await api.setProjectName(importedProject.id, importReviewerName.trim())
    }
    setImportedProject(null)
    setImportReviewerName('')
    navigate(`/project/${importedProject.id}`)
  }

  async function load() {
    setLoading(true)
    const data = await api.listProjects()
    setProjects(data)
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim() || !selectedTemplateId) return
    const project = await api.createDefaultProject(selectedTemplateId, {
      name: form.name.trim(),
      description: form.description.trim(),
    })
    setShowCreate(false)
    setForm({ name: '', description: '' })
    setSelectedTemplateId(null)
    if (project?.id) navigate(`/project/${project.id}`)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await api.deleteProject(deleteTarget.id)
    setDeleteTarget(null)
    load()
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top bar */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border)',
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <img src={appIcon} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.2px' }}>EnIAC</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
          <button
            id="tut-name"
            onClick={() => { setNameInput(reviewerName || ''); setShowIdentity(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            <User size={12} color="var(--text-muted)" />
            <span style={{ fontSize: 12, color: reviewerName ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
              {reviewerName || 'Set your name'}
            </span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleImportProject} title="Import a project from a .json export file">
            <FileDown size={14} /> Import Project
          </button>
          <button id="tut-new" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Project
          </button>
          <button id="tut-help" className="btn btn-ghost btn-icon btn-sm" onClick={tour.start} title="Show tutorial">
            <HelpCircle size={15} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 28px' }}>
        <div style={{ marginBottom: 28 }}>
          <h1>Projects</h1>
          <p className="text-secondary" style={{ marginTop: 4, fontSize: 13 }}>
            Open an existing project or create a new one to start coding encounters.
          </p>
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={40} />
            <div>
              <p style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>No projects yet</p>
              <p className="text-sm" style={{ marginTop: 4 }}>Create a project to get started</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Create Project
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {projects.map(p => (
              <div
                key={p.id}
                className="card"
                style={{ cursor: 'pointer', transition: 'box-shadow 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}
                onClick={() => navigate(`/project/${p.id}`)}
                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, background: 'var(--accent-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <FolderOpen size={16} color="var(--accent)" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }} className="truncate">{p.name}</div>
                    {p.description && (
                      <div className="text-secondary text-sm truncate" style={{ marginTop: 1 }}>{p.description}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                      <Calendar size={10} color="var(--text-muted)" />
                      <span className="text-muted text-sm">{formatDate(p.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 12 }}>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    title="Settings"
                    onClick={e => { e.stopPropagation(); navigate(`/project/${p.id}/setup`) }}
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    title="Delete"
                    onClick={e => { e.stopPropagation(); setDeleteTarget(p) }}
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setForm({ name: '', description: '' }); setSelectedTemplateId(null) }}
        title="New Project"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name.trim() || !selectedTemplateId}>Create & Configure</button>
          </>
        }
      >
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label>Project Name *</label>
            <input
              autoFocus
              placeholder="e.g. Pediatric Consultation Study"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div className="form-field">
            <label>Form *</label>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              maxHeight: 260, overflowY: 'auto',
              border: '1px solid var(--border)', borderRadius: 8, padding: 6,
            }}>
              {defaultProjects.map(template => {
                const selected = selectedTemplateId === template.id
                return (
                  <div key={template.id} style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setSelectedTemplateId(template.id)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', height: 'auto', textAlign: 'left',
                        border: selected ? '1px solid var(--accent)' : '1px solid transparent',
                        background: selected ? 'var(--accent-light)' : 'var(--bg-secondary)',
                        borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font)', color: 'var(--text)',
                      }}
                    >
                      <ClipboardList size={16} style={{ flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{template.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {template.description || 'Default forms and media types'}
                        </div>
                      </div>
                    </button>
                    {/* Only custom (single-form) templates are shareable this way —
                        the built-in SDMo/UCAT templates are full multi-form projects,
                        not a single form the backend can export through this path. */}
                    {template.custom && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={(e) => handleShareTemplateForm(template.id, e)}
                        title="Share this form as a file"
                        style={{ flexShrink: 0 }}
                      >
                        <Share2 size={15} />
                      </button>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                onClick={handleMakeForm}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', height: 'auto', textAlign: 'left',
                  border: '1px dashed var(--border)', background: 'transparent',
                  borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font)', color: 'var(--text)',
                }}
              >
                <FilePlus size={16} style={{ flexShrink: 0 }} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>Make Form</div>
              </button>
              <button
                type="button"
                onClick={handleImportFormForNewProject}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', height: 'auto', textAlign: 'left',
                  border: '1px dashed var(--border)', background: 'transparent',
                  borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font)', color: 'var(--text)',
                }}
              >
                <FileDown size={16} style={{ flexShrink: 0 }} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>Import Form</div>
              </button>
            </div>
          </div>

          <div className="form-field">
            <label>Description</label>
            <textarea
              placeholder="Optional description or notes about this study"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </div>
        </form>
      </Modal>

      {/* Identity Modal */}
      <Modal
        open={showIdentity}
        onClose={() => reviewerName && setShowIdentity(false)}
        title="Your Name"
        footer={
          <>
            {reviewerName && <button className="btn btn-secondary" onClick={() => setShowIdentity(false)}>Cancel</button>}
            <button className="btn btn-primary" onClick={handleSaveName} disabled={!nameInput.trim()}>Save</button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          Your name is attached to all reviews you create.
        </p>
        <div className="form-field">
          <label>Your Name</label>
          <input
            autoFocus
            placeholder="e.g. Alice Chen"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveName()}
          />
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Project"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </>
        }
      >
        <p>Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will permanently remove all encounters, reviews, and timestamps. The media files on disk will not be affected.</p>
      </Modal>

      {/* Tutorial */}
      {tour.node}

      {/* Pick-your-name step — shown when the imported file has a roster
          (Share Project's Name/Role list). Nothing has been created yet;
          this choice determines the new project's role. */}
      {pendingImportRoster.length > 0 && (
        <Modal
          open
          onClose={() => { setPendingImportData(null); setPendingImportRoster([]); setChosenImportName('') }}
          title="Which name is you?"
          footer={
            <button className="btn btn-primary" onClick={handleChooseImportName} disabled={!chosenImportName}>
              Continue
            </button>
          }
        >
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            This project was shared with a list of people. Pick your name below — it sets your role automatically.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingImportRoster.map((entry, i) => {
              const selected = chosenImportName === entry.name
              return (
                <button
                  key={i}
                  onClick={() => setChosenImportName(entry.name)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '10px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font)',
                    border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: selected ? 'var(--accent-light)' : 'transparent',
                    borderRadius: 6, color: 'var(--text)',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</span>
                </button>
              )
            })}
          </div>
        </Modal>
      )}

      {/* Post-import folder setup */}
      {importedProject && (() => {
        const hint = importedProject.syncHint || { mode: 'none', provider: null }
        const providerLabel = hint.provider === 'onedrive' ? 'OneDrive' : hint.provider === 'googledrive' ? 'Google Drive' : 'cloud storage'

        return (
          <Modal
            open
            onClose={null}
            title={`Set up "${importedProject.name}" on this computer`}
            footer={
              <button className="btn btn-primary" onClick={handleFinishImport} disabled={!importReviewerName.trim()}>
                Open Project
              </button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Your name — explicit per-project choice, not inherited from
                  the app-wide identity, since spelling/nicknames can drift
                  between projects and that drift should never happen silently.
                  This modal only shows for the no-roster fallback case now —
                  a roster pick skips straight to the project instead. */}
              <div className="form-field">
                <label>Your Name *</label>
                <input
                  autoFocus
                  placeholder="e.g. Alice Chen"
                  value={importReviewerName}
                  onChange={e => setImportReviewerName(e.target.value)}
                />
                <span className="text-muted text-sm" style={{ marginTop: 4 }}>
                  Used to attribute your reviews on this project specifically — worth typing it exactly
                  the way the project owner expects, even if it differs slightly from your name elsewhere.
                </span>
              </div>

              {/* Media folder — always shown */}
              <div className="form-field">
                <label>Media Folder</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={importMediaFolder}
                    onChange={e => setImportMediaFolder(e.target.value)}
                    placeholder="/path/to/local/media"
                  />
                  <button className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={async () => {
                    const p = await api.selectFolder(); if (p) setImportMediaFolder(p)
                  }}>
                    <FolderOpen size={14} /> Browse
                  </button>
                </div>
                <span className="text-muted text-sm" style={{ marginTop: 4 }}>
                  The folder on <strong>this computer</strong> containing the encounter subfolders and video files.
                  Every team member needs their own local copy of the same videos — the folder name and subfolder structure must match across all machines.
                </span>
              </div>

              {hint.mode === 'cloud' && (
                <div style={{ background: 'var(--accent-light)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--accent)' }}>
                  <strong>This project syncs via {providerLabel}.</strong>
                  <br /><br />
                  After opening the project, go to <strong>Setup → Sync</strong> and sign in to {providerLabel} to connect to the shared folder.
                  Ask the project owner which folder to select — everyone on the team must connect to the same one.
                </div>
              )}

              {hint.mode === 'local' && (
                <div className="form-field">
                  <label>Sync Folder</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={importSyncFolder}
                      onChange={e => setImportSyncFolder(e.target.value)}
                      placeholder="/path/to/shared/drive/ProjectName"
                    />
                    <button className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={async () => {
                      const p = await api.selectFolder(); if (p) setImportSyncFolder(p)
                    }}>
                      <FolderOpen size={14} /> Browse
                    </button>
                  </div>
                  <span className="text-muted text-sm" style={{ marginTop: 4 }}>
                    Point to <strong>your local copy</strong> of the shared sync folder — the same OneDrive, Dropbox, or Google Drive folder the project owner is using, wherever it appears on this machine.
                    Everyone on the team must point to the same underlying folder.
                  </span>
                </div>
              )}

              {hint.mode === 'none' && (
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  No automatic sync configured. You can set this up later in <strong>Setup → Sync</strong>, or exchange reviews manually using <strong>Share File</strong> and <strong>Import File</strong> on the project page.
                </div>
              )}

              <p className="text-muted text-sm">You can change any of these later in the project's Setup page.</p>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}