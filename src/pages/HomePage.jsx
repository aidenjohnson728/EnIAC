import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, Trash2, Settings, ChevronRight, Calendar, User, Upload, HelpCircle, GraduationCap, ClipboardList } from 'lucide-react'
import { api, formatDate } from '../lib/api'
import Modal from '../components/ui/Modal'
import useTour from '../components/ui/useTour'
import appIcon from '../assets/app-icon-transparent.png'

const TUTORIAL_KEY = 'sdmo_tutorial_v1'

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
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const templateDropdownRef = useRef(null)

  useEffect(() => {
    if (!showTemplateDropdown) return
    function handleClickOutside(e) {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target)) {
        setShowTemplateDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTemplateDropdown])
  const [projects, setProjects] = useState([])
  const [defaultProjects, setDefaultProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [reviewerName, setReviewerName] = useState(null)
  const [showIdentity, setShowIdentity] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [importedProject, setImportedProject] = useState(null) // { id, name, syncHint }
  const [importMediaFolder, setImportMediaFolder] = useState('')
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
  }, [])

  async function handleTrySample() {
    const result = await api.createSampleProject()
    if (result?.id && result?.tutorialReviewId) navigate(`/project/${result.id}?sampleTour=1&sampleReviewId=${result.tutorialReviewId}`)
    else if (result?.id) navigate(`/project/${result.id}`)
  }

  async function handleCreateDefault(templateId) {
    const result = await api.createDefaultProject(templateId)
    setShowTemplates(false)
    setShowTemplateDropdown(false)
    if (result?.id) navigate(`/project/${result.id}`)
  }

  async function handleSaveName() {
    if (!nameInput.trim()) return
    await api.setAppSettings({ reviewer_name: nameInput.trim() })
    setReviewerName(nameInput.trim())
    setShowIdentity(false)
  }


  async function handleImportProject() {
    const result = await api.importProjectAsNew()
    if (result?.ok) {
      await load()
      const projects = await api.listProjects()
      const proj = projects.find(p => p.id === result.projectId)
      setImportMediaFolder('')
      setImportSyncFolder('')
      setImportedProject({
        id: result.projectId,
        name: proj?.name || 'Imported Project',
        syncHint: result.syncHint || { mode: 'none', provider: null },
      })
    }
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
    setImportedProject(null)
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
    if (!form.name.trim()) return
    const project = await api.createProject({ name: form.name.trim(), description: form.description.trim() })
    setShowCreate(false)
    setForm({ name: '', description: '' })
    navigate(`/project/${project.id}/setup`)
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
            <Upload size={14} /> Import Project
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleTrySample} title="Open a ready-made tutorial project with a guided walkthrough">
            <GraduationCap size={14} /> Tutorial Project
          </button>
          {defaultProjects.length > 0 && (
            <div
              ref={templateDropdownRef}
              style={{ position: 'relative' }}
            >
              <button
                className="btn btn-secondary btn-sm"
                title="Create a project from a built-in template"
                onClick={() => setShowTemplateDropdown(s => !s)}
              >
                <ClipboardList size={14} /> Template Projects
              </button>

              {showTemplateDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    width: 220,
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow-md)',
                    padding: 6,
                    zIndex: 1000,
                  }}
                >
                  {defaultProjects.map(template => (
                    <button
                      key={template.id}
                      onClick={() => handleCreateDefault(template.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 3,
                        padding: '10px 12px',
                        border: 'none',
                        background: 'transparent',
                        borderRadius: 6,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'var(--font)',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--bg-secondary)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {template.name}
                      </span>

                      <span style={{ 
                        fontSize: 12, 
                        color: 'var(--text-muted)' 
                      }}>
                        {template.description || 'Default project template'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button id="tut-new" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Project
          </button>
          <button id="tut-help" className="btn btn-ghost btn-icon btn-sm" onClick={tour.start} title="Show tutorial">
            <HelpCircle size={15} />
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
            <p className="text-sm" style={{ marginTop: -2, color: 'var(--text-muted)' }}>
              New to EnIAC? Open the tutorial project for a guided walkthrough.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={handleTrySample}>
                <GraduationCap size={14} /> Try Tutorial Project
              </button>
              {defaultProjects.length > 0 && (
                <button className="btn btn-secondary" onClick={() => setShowTemplates(true)}>
                  <ClipboardList size={14} /> Template Projects
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Create Project
              </button>
            </div>
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

      {/* Template Modal */}
      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title="Template Project"
        footer={<button className="btn btn-secondary" onClick={() => setShowTemplates(false)}>Cancel</button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Start from a built-in project template with forms and media types already configured.
          </p>
          {defaultProjects.map(template => (
            <button
              key={template.id}
              className="btn btn-secondary"
              onClick={() => handleCreateDefault(template.id)}
              style={{ justifyContent: 'flex-start', gap: 12, padding: '14px 16px', height: 'auto', textAlign: 'left' }}
            >
              <ClipboardList size={18} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{template.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {template.description || 'Default forms and media types'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      {/* Create Modal */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setForm({ name: '', description: '' }) }}
        title="New Project"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name.trim()}>Create & Configure</button>
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

      {/* Post-import folder setup */}
      {importedProject && (() => {
        const hint = importedProject.syncHint || { mode: 'none', provider: null }
        const providerLabel = hint.provider === 'onedrive' ? 'OneDrive' : hint.provider === 'googledrive' ? 'Google Drive' : 'cloud storage'

        return (
          <Modal
            open
            onClose={null}
            title={`Set up "${importedProject.name}" on this computer`}
            footer={<button className="btn btn-primary" onClick={handleFinishImport}>Open Project</button>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

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
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#1d4ed8' }}>
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