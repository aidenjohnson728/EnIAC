import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ChevronLeft, Settings, Filter, ChevronDown, ChevronRight,
  Video, FileText, File, Plus, CheckCircle2, Circle,
  Search, X, Play, RefreshCw, Share2, FolderDown, AlertTriangle, Cloud, User,
  LayoutList, BarChart2, Activity, LineChart, HelpCircle, Pencil,
  Download, Upload, GitCompare
} from 'lucide-react'
import { api, formatDate } from '../lib/api'
import { SETUP_SECTIONS } from '../lib/setupSections'
import { AGREEMENT_METHOD_LABELS, computeInterraterAgreementForMediaFile } from '../lib/interraterAgreement.mjs'
import Modal from '../components/ui/Modal'
import NewReviewModal from '../components/encounters/NewReviewModal'
import FilterPanel from '../components/encounters/FilterPanel'
import useTour from '../components/ui/useTour'

const PAGE_SIZE = 15

const PROJECT_TOUR_STEPS = [
  {
    targetId: 'tut-proj-nav',
    placement: 'right',
    title: 'Your Project',
    body: 'Welcome to your project. Encounters are listed in the main area. Use this sidebar to switch between Encounters, Progress, and Activity views. Settings live at the bottom.',
  },
  {
    targetId: 'tut-proj-encounters',
    placement: 'bottom',
    title: 'Encounters',
    body: 'Each encounter represents one patient or session. Click any encounter card to expand it and see its media files. Sync shares the project structure and coding data; actual video files stay on each coder\'s computer.',
  },
  {
    targetId: 'tut-proj-mediatype',
    placement: 'bottom',
    title: 'Media Types',
    body: 'This badge shows the media type — a template that defines which forms and timestamp tags are available during review. You set up media types in Settings.',
  },
  {
    targetId: 'tut-proj-addreview',
    placement: 'top',
    title: 'Add Review',
    body: 'Click "Add review" to start coding this media file. You\'ll be taken to the review page where you can watch the video, log timestamps, and fill out the coding form.',
  },
  {
    targetId: 'tut-proj-health',
    placement: 'bottom',
    title: 'Unlinked Files',
    body: "This warning is local to this machine. The sample links the first video so you can try reviewing right away; the other sample slots stay unlinked so you can practice Auto-link or manual Link without changing teammates' file paths.",
  },
  {
    targetId: 'tut-proj-autolink',
    placement: 'bottom',
    title: 'Auto-link Files',
    body: 'Have all your videos in one folder? Auto-link scans it (and subfolders) and links every file whose name matches a slot in the project — no manual locating needed. Each teammate does this once on their own machine.',
  },
  {
    targetId: 'tut-proj-sync',
    placement: 'bottom',
    title: 'Sync',
    body: "Sync Now pushes your latest reviews and setup changes, then pulls your teammates' latest work. Use Settings → Sync to choose OneDrive, Google Drive, or a shared local folder. Media files are still linked separately on each machine.",
  },
  {
    targetId: 'tut-proj-export',
    placement: 'bottom',
    title: 'Exporting Data',
    body: 'Export all reviews and timestamps to Excel at any time — organized by media type, one row per review. Snapshots preserve the exact form version each review was coded against.',
  },
]
const MEDIA_ICONS = { video: Video, document: FileText, other: File }

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316']
function colorFor(name) { let h = 0; for (const c of (name || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return COLORS[h % COLORS.length] }
function sampleProjectTourKey(projectId) { return `sdmo_sample_project_tour_started_v1:${projectId}` }

export default function ProjectPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [project, setProject] = useState(null)
  const [encounters, setEncounters] = useState([])
  const [mediaTypes, setMediaTypes] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [newReview, setNewReview] = useState(null)
  const [deleteReviewTarget, setDeleteReviewTarget] = useState(null) // { id, reviewer_name }
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [syncStatus, setSyncStatus] = useState({ syncMode: 'none', syncFolder: null, lastSyncAt: null })
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [toast, setToast] = useState(null) // { message, isError }
  const [pendingConfigData, setPendingConfigData] = useState(null)
  const [acceptingConfig, setAcceptingConfig] = useState(false)
  const [reviewerName, setReviewerName] = useState(null)
  const [showNameModal, setShowNameModal] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [showProjectNameModal, setShowProjectNameModal] = useState(false)
  const [projectNameInput, setProjectNameInput] = useState('')
  const [renameEncounterTarget, setRenameEncounterTarget] = useState(null)
  const [renameMediaTarget, setRenameMediaTarget] = useState(null)
  const [renameInput, setRenameInput] = useState('')
  const [mediaHealth, setMediaHealth] = useState(null)
  const [activePage, setActivePage] = useState('encounters')
  const [currentPage, setCurrentPage] = useState(1)
  const [autolinking, setAutolinking] = useState(false)
  const [linkSaving, setLinkSaving] = useState(null)
  const [showNewEncounterModal, setShowNewEncounterModal] = useState(false)
  const [newEncounterName, setNewEncounterName] = useState('')
  const [newMediaTarget, setNewMediaTarget] = useState(null)
  const [newMediaName, setNewMediaName] = useState('')
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanFolder, setScanFolder] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [scanningFolder, setScanningFolder] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState(null)
  const [unlockInput, setUnlockInput] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [mediaTypeConfirmTarget, setMediaTypeConfirmTarget] = useState(null)
  const [showAutolinkModal, setShowAutolinkModal] = useState(false)
  const [autolinkFolder, setAutolinkFolder] = useState('')
  const [autolinkResult, setAutolinkResult] = useState(null)
  const [syncOffline, setSyncOffline] = useState(false)
  const [googleDriveAccessIds, setGoogleDriveAccessIds] = useState([])
  const [grantingGoogleDriveAccess, setGrantingGoogleDriveAccess] = useState(false)
  const [googleDriveMetadataMissing, setGoogleDriveMetadataMissing] = useState(null)
  const [resolvingGoogleDriveMetadata, setResolvingGoogleDriveMetadata] = useState(false)
  const [sampleTourStarted, setSampleTourStarted] = useState(false)
  const query = new URLSearchParams(location.search)
  const isSampleTour = query.get('sampleTour') === '1'
  const sampleReviewId = query.get('sampleReviewId')
  const tour = useTour(PROJECT_TOUR_STEPS, 'sdmo_tour_project_v1', {
    ready: !loading && encounters.length > 0,
    onStart: useCallback(() => {
      // Expand the first encounter so media-type and add-review anchors are in the DOM.
      if (encounters[0]) setExpanded(e => ({ ...e, [encounters[0].id]: true }))
    }, [encounters]),
    onComplete: () => {
      if (isSampleTour && sampleReviewId) navigate(`/review/${sampleReviewId}?sampleTour=1`)
    },
  })

  useEffect(() => { load() }, [projectId, location.pathname])

  useEffect(() => {
    if (!isSampleTour || sampleTourStarted || loading || encounters.length === 0) return
    const key = sampleProjectTourKey(projectId)
    if (localStorage.getItem(key)) {
      setSampleTourStarted(true)
      return
    }
    localStorage.setItem(key, '1')
    setSampleTourStarted(true)
    tour.start()
  }, [isSampleTour, sampleTourStarted, loading, encounters.length, projectId, tour])

  // Periodic refresh every 15s — checks manifest.json first (tiny file),
  // only downloads full config if version changed
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const manifest = await api.checkManifest(projectId)
        if (manifest && manifest.config_version > manifest.local_version) {
          await api.fetchProjectStructure(projectId)
          const encs = await api.listEncounters(projectId)
          setEncounters(encs)
        }
      } catch {}
    }, 15000)
    return () => clearInterval(interval)
  }, [projectId])

  useEffect(() => {
    const handler = (data) => {
      if (String(data.projectId) === String(projectId)) setPendingConfigData(data.configData)
    }
    const subId = api.onConfigUpdateAvailable(handler)
    return () => api.offConfigUpdateAvailable(subId)
  }, [projectId])

  // A structural edit collided with another machine's during sync. LWW already
  // picked a winner deterministically; just let the user know and refresh.
  useEffect(() => {
    const handler = (data) => {
      if (!data?.message) return
      if (String(data?.projectId) !== String(projectId)) return
      showToast(data.message, true)
      load()
    }
    const subId = api.onSyncConflict(handler)
    return () => api.offSyncConflict(subId)
  }, [projectId])

  useEffect(() => {
    const handler = (data) => {
      if (String(data?.projectId) !== String(projectId)) return
      setSyncOffline(true)
    }
    const subId = api.onSyncOffline(handler)
    return () => api.offSyncOffline(subId)
  }, [projectId])

  useEffect(() => {
    const handler = (data) => {
      if (String(data?.projectId) !== String(projectId)) return
      setSyncOffline(false)
      showToast('Internet restored — back online and syncing.')
      api.getSyncStatus(projectId).then(setSyncStatus)
    }
    const subId = api.onSyncOnline(handler)
    return () => api.offSyncOnline(subId)
  }, [projectId])

  useEffect(() => {
    const handler = (data) => {
      if (String(data?.projectId) !== String(projectId)) return
      setGoogleDriveAccessIds(data.fileIds || [])
    }
    const subId = api.onGoogleDriveAccessRequired(handler)
    return () => api.offGoogleDriveAccessRequired(subId)
  }, [projectId])

  useEffect(() => {
    const handler = (data) => {
      if (String(data?.projectId) !== String(projectId)) return
      setGoogleDriveMetadataMissing(data.missing || ['project-state.json', 'manifest.json'])
    }
    const subId = api.onGoogleDriveMetadataMissing(handler)
    return () => api.offGoogleDriveMetadataMissing(subId)
  }, [projectId])

  async function load() {
    setLoading(true)
    const [proj, encs, types, status, name] = await Promise.all([
      api.getProject(projectId),
      api.listEncounters(projectId),
      api.listMediaTypes(projectId),
      api.getSyncStatus(projectId),
      api.getProjectName(projectId),
    ])
    setProject(proj)
    setEncounters(encs)
    setMediaTypes(types)
    setSyncStatus(status)
    setReviewerName(name || '')
    setLoading(false)
    refreshMediaHealth()
    refreshProjectStructure()
    // Auto-sync on open if sync is configured
    if (status.syncMode === 'local' || status.syncMode === 'cloud') {
      const syncFn = status.syncMode === 'cloud'
        ? () => api.cloudSyncNow(projectId)
        : () => api.syncNow(projectId)
      syncFn().then(() => api.getSyncStatus(projectId).then(setSyncStatus))
    }
  }

  async function refreshMediaHealth() {
    try {
      setMediaHealth(await api.mediaHealthCheck(projectId))
    } catch {}
  }

  async function refreshProjectStructure() {
    try {
      await api.fetchProjectStructure(projectId)
      const [encs, types] = await Promise.all([
        api.listEncounters(projectId),
        api.listMediaTypes(projectId),
      ])
      setEncounters(encs)
      setMediaTypes(types)
    } catch {}
  }

  async function handleSaveReviewerName() {
    const trimmed = nameInput.trim()
    if (!trimmed) return
    await api.setProjectName(projectId, trimmed)
    setReviewerName(trimmed)
    setShowNameModal(false)
  }

  async function handleSaveProjectName() {
    const trimmed = projectNameInput.trim()
    if (!trimmed || !project) return
    await api.updateProject(projectId, {
      ...project,
      name: trimmed,
      description: project.description || '',
      media_folder: project.media_folder || null,
      sync_folder: project.sync_folder || null,
      owner_name: project.owner_name || null,
      keybinds: project.keybinds || [],
    })
    setProject(p => ({ ...p, name: trimmed }))
    setShowProjectNameModal(false)
    showToast('Project name updated.')
  }

  function showToast(message, isError = false) {
    setToast({ message, isError })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleDeleteReview() {
    if (!deleteReviewTarget) return
    await api.deleteReview(deleteReviewTarget.id)
    setDeleteReviewTarget(null)
    const encs = await api.listEncounters(projectId)
    setEncounters(encs)
  }

  async function handleSyncNow() {
    setSyncing(true)
    // Pull latest structure from cloud first, then run full sync
    try { await api.fetchProjectStructure(projectId) } catch {}
    const result = syncStatus.syncMode === 'cloud'
      ? await api.cloudSyncNow(projectId)
      : await api.syncNow(projectId)
    setSyncing(false)
    if (result.error) { setSyncError(result.error); return }
    setSyncError(null)
    const [status, encs] = await Promise.all([
      api.getSyncStatus(projectId),
      api.listEncounters(projectId),
    ])
    setSyncStatus(status)
    setEncounters(encs)
  }

  async function handleGrantGoogleDriveAccess() {
    if (googleDriveAccessIds.length === 0) return
    setGrantingGoogleDriveAccess(true)
    const pick = await api.cloudPickGoogleDriveFiles(googleDriveAccessIds)
    if (pick?.error) {
      setGrantingGoogleDriveAccess(false)
      setSyncError(pick.error)
      return
    }
    setGoogleDriveAccessIds([])
    await handleSyncNow()
    setGrantingGoogleDriveAccess(false)
  }

  async function handleSelectGoogleDriveMetadata() {
    setResolvingGoogleDriveMetadata(true)
    setSyncError(null)
    const pick = await api.cloudPickGoogleDriveFiles([])
    if (pick?.error) {
      setResolvingGoogleDriveMetadata(false)
      setSyncError(pick.error)
      return
    }
    const files = pick.files || []
    const hasState = files.some(f => f.name === 'project-state.json')
    const hasManifest = files.some(f => f.name === 'manifest.json')
    if (!hasState || !hasManifest) {
      setResolvingGoogleDriveMetadata(false)
      setSyncError('Select both project-state.json and manifest.json from this project sync folder.')
      return
    }
    setGoogleDriveMetadataMissing(null)
    await handleSyncNow()
    setResolvingGoogleDriveMetadata(false)
  }

  async function handleCreateGoogleDriveMetadata() {
    setResolvingGoogleDriveMetadata(true)
    setSyncError(null)
    const result = await api.cloudSyncNow(projectId, { allowCreateMissingMetadata: true })
    setResolvingGoogleDriveMetadata(false)
    if (result?.error) {
      setSyncError(result.error)
      return
    }
    setGoogleDriveMetadataMissing(null)
    const [status, encs] = await Promise.all([
      api.getSyncStatus(projectId),
      api.listEncounters(projectId),
    ])
    setSyncStatus(status)
    setEncounters(encs)
  }

  async function handleAcceptConfigUpdate() {
    if (!pendingConfigData) return
    setAcceptingConfig(true)
    await api.syncAcceptConfigUpdate(Number(projectId), pendingConfigData)
    setPendingConfigData(null)
    setAcceptingConfig(false)
    load()
  }

  function formatSyncAge(ts) {
    if (!ts) return null
    const secs = Math.floor((Date.now() - ts) / 1000)
    if (secs < 60) return 'just now'
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    return `${Math.floor(secs / 3600)}h ago`
  }

  function toggle(encId) {
    setExpanded(e => ({ ...e, [encId]: !e[encId] }))
  }

  function applyFilters(encs) {
    let result = encs
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(enc =>
        enc.name.toLowerCase().includes(q) ||
        enc.media?.some(m => m.name.toLowerCase().includes(q))
      )
    }
    if (filters.completion === 'complete') result = result.filter(e => e.completed)
    if (filters.completion === 'incomplete') result = result.filter(e => !e.completed)
    if (filters.mediaType) result = result.filter(e => e.media?.some(m => m.media_type_id == filters.mediaType))
    return result
  }

  const filtered = useMemo(() => applyFilters(encounters), [encounters, filters, search])

  useEffect(() => setCurrentPage(1), [search, filters])

  async function handleOpenAutolinkModal() {
    const folder = await api.getBaseFolder(projectId)
    setAutolinkFolder(folder || '')
    setAutolinkResult(null)
    setShowAutolinkModal(true)
  }

  async function handleRunAutolink() {
    if (autolinkFolder) await api.setBaseFolder(Number(projectId), autolinkFolder)
    setAutolinking(true)
    const result = await api.autolink(projectId)
    setAutolinking(false)
    setAutolinkResult(result)
    const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
    setEncounters(encs)
    setMediaHealth(health)
  }

  async function handleManualLink(mediaFileId) {
    setLinkSaving(mediaFileId)
    const filePath = await api.browseMediaFile(mediaFileId)
    if (filePath) {
      await api.setMediaLink(mediaFileId, projectId, filePath)
      const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
      setEncounters(encs)
      setMediaHealth(health)
    }
    setLinkSaving(null)
  }

  async function handleMarkNA(mediaFileId) {
    await api.markMediaNotApplicable(mediaFileId)
    const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
    setEncounters(encs)
    setMediaHealth(health)
  }

  async function handleClearLink(mediaFileId) {
    await api.clearMediaLink(mediaFileId)
    const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
    setEncounters(encs)
    setMediaHealth(health)
  }

  async function refreshEncounterData() {
    const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
    setEncounters(encs)
    setMediaHealth(health)
  }

  async function handleCreateEncounter() {
    const name = newEncounterName.trim()
    if (!name) return
    const result = await api.createEncounter(projectId, name)
    setShowNewEncounterModal(false)
    setNewEncounterName('')
    await refreshEncounterData()
    if (result?.id) setExpanded(e => ({ ...e, [result.id]: true }))
    showToast('Encounter added.')
  }

  async function handleCreateMediaFile() {
    const name = newMediaName.trim()
    if (!name || !newMediaTarget?.id) return
    await api.createMediaFile(projectId, newMediaTarget.id, name)
    setExpanded(e => ({ ...e, [newMediaTarget.id]: true }))
    setNewMediaTarget(null)
    setNewMediaName('')
    await refreshEncounterData()
    showToast('Media added.')
  }

  async function handleRenameEncounter() {
    const name = renameInput.trim()
    if (!name || !renameEncounterTarget) return
    await api.renameEncounter(projectId, renameEncounterTarget.id, name)
    setRenameEncounterTarget(null)
    setRenameInput('')
    await refreshEncounterData()
    showToast('Encounter renamed.')
  }

  async function handleRenameMediaFile() {
    const name = renameInput.trim()
    if (!name || !renameMediaTarget) return
    await api.renameMediaFile(projectId, renameMediaTarget.id, name)
    setRenameMediaTarget(null)
    setRenameInput('')
    await refreshEncounterData()
    showToast('Media renamed.')
  }

  async function handleOpenScanModal() {
    const folder = await api.getBaseFolder(projectId)
    setScanFolder(folder || '')
    setScanResult(null)
    setShowScanModal(true)
  }

  async function handleRunFolderScan() {
    if (!scanFolder) return
    setScanningFolder(true)
    const result = await api.scanMediaFolder(scanFolder, projectId)
    setScanningFolder(false)
    setScanResult(result)
    if (!result?.error) {
      await api.setBaseFolder(Number(projectId), scanFolder)
      await refreshEncounterData()
      if (result.encountersAdded > 0 || result.encountersLinked > 0 || result.filesAdded > 0 || result.filesLinked > 0) {
        showToast('Folder scan complete.')
      }
    }
  }

  async function applyMediaTypeChange(mediaFileId, mediaTypeId) {
    await api.updateMediaType(mediaFileId, mediaTypeId || null)
    await refreshEncounterData()
    showToast('Media type updated.')
  }

  async function proceedMediaTypeChange(mediaFile, mediaTypeId) {
    try {
      const unlocked = await api.isProjectUnlocked(projectId)
      if (unlocked) {
        await applyMediaTypeChange(mediaFile.id, mediaTypeId)
        return
      }
      setUnlockTarget({ mediaFile, mediaTypeId })
      setUnlockInput('')
      setUnlockError('')
    } catch (e) {
      showToast(e?.message || 'Could not update media type.', true)
    }
  }

  async function handleChangeMediaType(mediaFile, mediaTypeId) {
    if (String(mediaFile.media_type_id || '') === String(mediaTypeId || '')) return
    const reviewCount = (mediaFile.reviews || []).length
    if (reviewCount > 0) {
      setMediaTypeConfirmTarget({ mediaFile, mediaTypeId })
      return
    }
    await proceedMediaTypeChange(mediaFile, mediaTypeId)
  }

  async function confirmMediaTypeChange() {
    if (!mediaTypeConfirmTarget) return
    const { mediaFile, mediaTypeId } = mediaTypeConfirmTarget
    setMediaTypeConfirmTarget(null)
    await proceedMediaTypeChange(mediaFile, mediaTypeId)
  }

  async function handleUnlockAndChangeMediaType() {
    if (!unlockTarget) return
    const ok = await api.verifyOwnerPassword(projectId, unlockInput)
    if (!ok) {
      setUnlockError('Incorrect password.')
      return
    }
    try {
      await applyMediaTypeChange(unlockTarget.mediaFile.id, unlockTarget.mediaTypeId)
      setUnlockTarget(null)
      setUnlockInput('')
      setUnlockError('')
    } catch (e) {
      setUnlockError(e?.message || 'Could not update media type.')
    }
  }

  async function handleSaveFile() {
    const p = await api.saveProjectFile(projectId)
    if (p) showToast(`File saved — share it with teammates.`)
  }

  async function handleExportResults() {
    const p = await api.exportResults(projectId)
    if (p) showToast('Results exported.')
  }

  async function handleImportResults() {
    const result = await api.importResultsFiles(projectId)
    if (!result) return
    if (result.imported > 0) {
      showToast(`Imported ${result.imported} result file${result.imported !== 1 ? 's' : ''}.${result.skipped?.length ? ` ${result.skipped.length} skipped.` : ''}`)
    } else if (result.skipped?.length) {
      showToast(`Could not import: ${result.skipped.join(', ')}`, true)
    }
  }

  async function handleLoadFile() {
    const result = await api.loadProjectFile(projectId)
    if (!result) return
    if (result.error) { showToast(`Import failed: ${result.error}`, true); return }
    const parts = []
    if (result.reviewsImported) parts.push(`${result.reviewsImported} new review${result.reviewsImported !== 1 ? 's' : ''}`)
    if (result.reviewsUpdated) parts.push(`${result.reviewsUpdated} updated`)
    if (result.formsAdded) parts.push(`${result.formsAdded} new form${result.formsAdded !== 1 ? 's' : ''}`)
    if (result.typesAdded) parts.push(`${result.typesAdded} new media type${result.typesAdded !== 1 ? 's' : ''}`)
    showToast(parts.length ? `Imported: ${parts.join(', ')}` : 'Nothing new to import.')
    load()
  }

  if (loading) return <div className="empty-state" style={{ height: '100vh' }}><div className="spinner" /></div>

  const mediaTypeConfirmReviewCount = mediaTypeConfirmTarget?.mediaFile?.reviews?.length || 0
  const mediaTypeConfirmSubmittedCount = (mediaTypeConfirmTarget?.mediaFile?.reviews || []).filter(review => review.status === 'submitted' || review.submitted_at).length
  const mediaTypeConfirmNextType = mediaTypeConfirmTarget
    ? mediaTypes.find(type => String(type.id) === String(mediaTypeConfirmTarget.mediaTypeId))
    : null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Top bar */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate('/')}>
            <ChevronLeft size={16} />
          </button>
          <span className="text-secondary text-sm">SDMo</span>
          <ChevronRight size={12} color="var(--text-muted)" />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setProjectNameInput(project?.name || ''); setShowProjectNameModal(true) }}
            title="Edit project name"
            style={{ fontWeight: 600, fontSize: 14, padding: '3px 6px', height: 28 }}
          >
            {project?.name}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', WebkitAppRegion: 'no-drag' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setNameInput(reviewerName || ''); setShowNameModal(true) }}
            title="Change your reviewer name for this project"
            style={{ color: reviewerName ? 'var(--text-secondary)' : 'var(--danger)' }}
          >
            <User size={13} />
            {reviewerName || 'Set your name'}
          </button>
          {(syncStatus.syncMode === 'local' || syncStatus.syncMode === 'cloud') && (
            <button id="tut-proj-sync" className="btn btn-ghost btn-sm" onClick={handleSyncNow} disabled={syncing} title="Sync now">
              {syncStatus.syncMode === 'cloud' ? <Cloud size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> : <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />}
              {syncing ? 'Syncing…' : 'Sync Now'}
              {syncStatus.lastSyncAt && !syncing && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 2 }}>· {formatSyncAge(syncStatus.lastSyncAt)}</span>
              )}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleLoadFile} title="Import project file (from email or shared folder)">
            <FolderDown size={13} /> Import File
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleSaveFile} title="Save project file to share with teammates">
            <Share2 size={13} /> Share File
          </button>
          <button id="tut-proj-export" className="btn btn-ghost btn-sm" onClick={() => api.exportExcel(projectId)} title="Export all reviews and timestamps to Excel">
            <FileText size={13} /> Export Excel
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportResults} title="Export only your coding results as a portable JSON file">
            <Download size={13} /> Export Results
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleImportResults} title="Import another coder's exported results for comparison">
            <Upload size={13} /> Import Results
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={tour.start} title="Show tutorial">
            <HelpCircle size={15} />
          </button>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: toast.isError ? 'var(--danger)' : '#1a1a1a',
          color: 'white', padding: '10px 18px', borderRadius: 8, fontSize: 13,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8, maxWidth: 480,
        }}>
          {toast.message}
        </div>
      )}

      {/* Warning banners */}
      {syncOffline && syncStatus.syncMode === 'cloud' && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          No internet — working in local mode. Retrying every 5 minutes.
        </div>
      )}
      {syncError && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#b91c1c' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Sync failed: {syncError}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: '#b91c1c' }} onClick={() => setSyncError(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {syncStatus.syncMode === 'local' && syncStatus.syncFolderExists === false && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Sync folder not found — check the path in <button className="btn btn-ghost btn-sm" style={{ color: '#92400e', textDecoration: 'underline', padding: '0 4px' }} onClick={() => navigate(`/project/${projectId}/setup?section=${SETUP_SECTIONS.SYNC}`)}>Setup → Sync</button>
        </div>
      )}
      {syncStatus.syncMode === 'cloud' && syncStatus.tokenExpired && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Cloud connection expired — reconnect in <button className="btn btn-ghost btn-sm" style={{ color: '#92400e', textDecoration: 'underline', padding: '0 4px' }} onClick={() => navigate(`/project/${projectId}/setup?section=${SETUP_SECTIONS.SYNC}`)}>Setup → Sync</button>
        </div>
      )}
      {googleDriveAccessIds.length > 0 && (
        <div style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1d4ed8' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>New Google Drive review files need access before SDMo can import them.</span>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 8 }}
            onClick={handleGrantGoogleDriveAccess}
            disabled={grantingGoogleDriveAccess}
          >
            {grantingGoogleDriveAccess ? 'Opening…' : 'Select Files'}
          </button>
        </div>
      )}
      {googleDriveMetadataMissing && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e', flexWrap: 'wrap' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>
            Google Drive cannot see {googleDriveMetadataMissing.join(' and ')}. Select the existing files from this project sync folder, or create new metadata if this folder is intentionally empty.
          </span>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: 8 }}
            onClick={handleSelectGoogleDriveMetadata}
            disabled={resolvingGoogleDriveMetadata}
          >
            {resolvingGoogleDriveMetadata ? 'Opening...' : 'Select Existing Files'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleCreateGoogleDriveMetadata}
            disabled={resolvingGoogleDriveMetadata}
          >
            Create New Files
          </button>
        </div>
      )}
      {pendingConfigData && (
        <div style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1d4ed8' }}>
          <RefreshCw size={14} style={{ flexShrink: 0 }} />
          <span>Project settings were updated by the project owner.</span>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 8 }}
            onClick={handleAcceptConfigUpdate}
            disabled={acceptingConfig}
          >
            {acceptingConfig ? 'Applying…' : 'Apply Updates'}
          </button>
        </div>
      )}

      {/* Main area: sidebar + content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{
          width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-secondary)', overflowY: 'auto',
          userSelect: 'none',
        }}>
          {/* Project name header */}
          <div style={{ padding: '20px 14px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Project</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => { setProjectNameInput(project?.name || ''); setShowProjectNameModal(true) }}
                title="Edit project name"
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  textAlign: 'left',
                  fontFamily: 'var(--font)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text)',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                  cursor: 'pointer',
                }}
              >
                {project?.name}
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="Edit project name"
                onClick={() => { setProjectNameInput(project?.name || ''); setShowProjectNameModal(true) }}
                style={{ width: 22, height: 22, padding: 0, flexShrink: 0, alignSelf: 'center' }}
              >
                <Pencil size={12} />
              </button>
            </div>
          </div>

          {/* Nav items */}
          <div id="tut-proj-nav" style={{ padding: '2px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[
              { id: 'encounters', icon: LayoutList, label: 'Encounters' },
              { id: 'progress',   icon: BarChart2,  label: 'Progress' },
              { id: 'activity',   icon: Activity,   label: 'Activity' },
              { id: 'dataviz',    icon: LineChart,  label: 'Data Visualization' },
              { id: 'agreement',  icon: GitCompare, label: 'Agreement Between Results' },
            ].map(({ id, icon: Icon, label }) => {
              const active = activePage === id
              return (
                <button key={id} onClick={() => setActivePage(id)}
                  className="btn btn-ghost btn-sm"
                  style={{
                    justifyContent: 'flex-start', width: '100%',
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                    background: active ? 'var(--bg-hover, rgba(0,0,0,0.06))' : 'transparent',
                  }}>
                  <Icon size={13} />
                  {label}
                </button>
              )
            })}
          </div>

          {/* Bottom: Settings */}
          <div style={{ marginTop: 'auto', padding: '8px 6px', borderTop: '1px solid var(--border)' }}>
            <button onClick={() => navigate(`/project/${projectId}/setup`)}
              className="btn btn-ghost btn-sm"
              style={{ justifyContent: 'flex-start', width: '100%' }}>
              <Settings size={13} />
              Settings
            </button>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>

          {/* Media health warning — shown on all views */}
          {mediaHealth && (mediaHealth.unlinked + mediaHealth.broken) > 0 && (
            <div id="tut-proj-health" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0 }} />
              <span style={{ color: '#92400e', flex: 1 }}>
                {mediaHealth.unlinked + mediaHealth.broken} of {mediaHealth.total} media file{mediaHealth.total !== 1 ? 's' : ''} {mediaHealth.broken > 0 && mediaHealth.unlinked > 0 ? 'are not linked or missing' : mediaHealth.broken > 0 ? 'cannot be found on disk' : 'are not linked on this machine'}.
                {!mediaHealth.hasBaseFolder ? ' Set a base folder in Settings → Media Folder.' : ' Go to Settings → Media Folder to auto-link or manually locate files.'}
              </span>
              <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => navigate(`/project/${projectId}/setup?section=${SETUP_SECTIONS.FILES}`)}>Fix</button>
            </div>
          )}

          {/* ── ENCOUNTERS ── */}
          {activePage === 'encounters' && (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div id="tut-proj-encounters">
                  <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Encounters</h1>
                  <p className="text-secondary text-sm" style={{ marginTop: 3 }}>
                    {filtered.length} encounter{filtered.length !== 1 ? 's' : ''}{filtered.length !== encounters.length ? ` (filtered from ${encounters.length})` : ''} · {encounters.filter(e => e.completed).length} complete
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowNewEncounterModal(true)}>
                    <Plus size={13} /> Add Encounter
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleOpenScanModal} disabled={scanningFolder}>
                    <FolderDown size={13} />
                    Scan Folder
                  </button>
                  <button id="tut-proj-autolink" className="btn btn-secondary btn-sm" onClick={handleOpenAutolinkModal} disabled={autolinking}>
                    <RefreshCw size={13} style={{ animation: autolinking ? 'spin 1s linear infinite' : 'none' }} />
                    {autolinking ? 'Linking…' : 'Auto-link Files'}
                  </button>
                  <div style={{ position: 'relative' }}>
                    <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input placeholder="Search encounters…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 28, width: 200, height: 32, fontSize: 13 }} />
                    {search && <button style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => setSearch('')}><X size={12} color="var(--text-muted)" /></button>}
                  </div>
                  <button className={`btn btn-sm ${showFilter ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowFilter(s => !s)}>
                    <Filter size={13} /> Filter {Object.keys(filters).length > 0 && `(${Object.keys(filters).length})`}
                  </button>
                </div>
              </div>
              {showFilter && <FilterPanel filters={filters} setFilters={setFilters} mediaTypes={mediaTypes} onClose={() => setShowFilter(false)} />}
              {filtered.length === 0 ? (
                <div className="empty-state">
                  <FolderOpenIcon />
                  <p>No encounters found</p>
                  {encounters.length === 0 && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => setShowNewEncounterModal(true)}>
                        <Plus size={13} /> Add Encounter
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={handleOpenScanModal}>
                        <FolderDown size={13} /> Scan Folder
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div id="tut-proj-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(enc => (
                      <EncounterRow key={enc.id} encounter={enc} expanded={!!expanded[enc.id]} onToggle={() => toggle(enc.id)} mediaTypes={mediaTypes} onRenameEncounter={() => { setRenameEncounterTarget(enc); setRenameInput(enc.name || '') }} onRenameMedia={(mf) => { setRenameMediaTarget(mf); setRenameInput(mf.name || '') }} onAddMedia={() => { setNewMediaTarget(enc); setNewMediaName(enc.name || '') }} onChangeMediaType={handleChangeMediaType} onAddReview={(mf) => setNewReview({ mediaFile: mf })} onOpenReview={(reviewId) => navigate(`/review/${reviewId}`)} onDeleteReview={(r) => setDeleteReviewTarget(r)} onManualLink={handleManualLink} onMarkNA={handleMarkNA} onClearLink={handleClearLink} linkSaving={linkSaving} />
                    ))}
                  </div>
                  <Pagination currentPage={currentPage} totalPages={Math.ceil(filtered.length / PAGE_SIZE)} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
                </>
              )}
            </>
          )}

          {/* ── PROGRESS ── */}
          {activePage === 'progress' && <ProgressView encounters={encounters} mediaTypes={mediaTypes} />}

          {/* ── ACTIVITY ── */}
          {activePage === 'activity' && <ActivityView encounters={encounters} />}

          {/* ── DATA VISUALIZATION ── */}
          {activePage === 'dataviz' && <DataVizView projectId={projectId} mediaTypes={mediaTypes} />}
          {activePage === 'agreement' && <AgreementResultsView projectId={projectId} />}

        </div>
      </div>

      <Modal
        open={!!deleteReviewTarget}
        onClose={() => setDeleteReviewTarget(null)}
        title="Delete Review"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteReviewTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDeleteReview}>Delete</button>
          </>
        }
      >
        <p>Delete the review by <strong>{deleteReviewTarget?.reviewer_name}</strong>? All timestamps and form responses in this review will be permanently removed.</p>
      </Modal>

      <Modal
        open={showNewEncounterModal}
        onClose={() => setShowNewEncounterModal(false)}
        title="Add Encounter"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowNewEncounterModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreateEncounter} disabled={!newEncounterName.trim()}>
              Add Encounter
            </button>
          </>
        }
      >
        <div className="form-field">
          <label>Encounter Name</label>
          <input
            autoFocus
            value={newEncounterName}
            onChange={e => setNewEncounterName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateEncounter()}
            placeholder="e.g. Encounter 001"
          />
        </div>
      </Modal>

      <Modal
        open={!!newMediaTarget}
        onClose={() => setNewMediaTarget(null)}
        title="Add Media"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setNewMediaTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreateMediaFile} disabled={!newMediaName.trim()}>
              Add Media
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Add a media slot under <strong>{newMediaTarget?.name}</strong>. You can link the local file afterward.
          </p>
          <div className="form-field">
            <label>Media File Name</label>
            <input
              autoFocus
              value={newMediaName}
              onChange={e => setNewMediaName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateMediaFile()}
              placeholder="e.g. consult_video.mp4"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!renameEncounterTarget}
        onClose={() => setRenameEncounterTarget(null)}
        title="Rename Encounter"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRenameEncounterTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleRenameEncounter} disabled={!renameInput.trim()}>
              Save
            </button>
          </>
        }
      >
        <div className="form-field">
          <label>Encounter Name</label>
          <input
            autoFocus
            value={renameInput}
            onChange={e => setRenameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRenameEncounter()}
          />
        </div>
      </Modal>

      <Modal
        open={!!renameMediaTarget}
        onClose={() => setRenameMediaTarget(null)}
        title="Rename Media"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRenameMediaTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleRenameMediaFile} disabled={!renameInput.trim()}>
              Save
            </button>
          </>
        }
      >
        <div className="form-field">
          <label>Media File Name</label>
          <input
            autoFocus
            value={renameInput}
            onChange={e => setRenameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRenameMediaFile()}
          />
        </div>
      </Modal>

      <Modal
        open={showScanModal}
        onClose={() => { if (!scanningFolder) { setShowScanModal(false); setScanResult(null) } }}
        title="Scan Folder"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => { setShowScanModal(false); setScanResult(null) }} disabled={scanningFolder}>
              {scanResult ? 'Close' : 'Cancel'}
            </button>
            {!scanResult && (
              <button className="btn btn-primary" onClick={handleRunFolderScan} disabled={scanningFolder || !scanFolder}>
                <RefreshCw size={13} style={{ animation: scanningFolder ? 'spin 1s linear infinite' : 'none' }} />
                {scanningFolder ? 'Scanning…' : 'Scan Folder'}
              </button>
            )}
          </>
        }
      >
        {!scanResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              Scan a folder whose subfolders are encounters. Media files inside each subfolder will be added and linked automatically.
            </p>
            <div className="form-field" style={{ margin: 0 }}>
              <label>Folder</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={scanFolder}
                  onChange={e => setScanFolder(e.target.value)}
                  placeholder="/path/to/project/media"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" style={{ flexShrink: 0 }}
                  onClick={async () => { const p = await api.selectFolder(); if (p) setScanFolder(p) }}>
                  Browse
                </button>
              </div>
            </div>
          </div>
        ) : scanResult.error ? (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c' }}>
            {scanResult.error}
          </div>
        ) : (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span><strong>{scanResult.encountersAdded || 0}</strong> encounter{scanResult.encountersAdded === 1 ? '' : 's'} added</span>
            <span><strong>{scanResult.encountersLinked || 0}</strong> existing encounter{scanResult.encountersLinked === 1 ? '' : 's'} matched to folders</span>
            <span><strong>{scanResult.filesAdded || 0}</strong> media file{scanResult.filesAdded === 1 ? '' : 's'} added</span>
            <span><strong>{scanResult.filesLinked || 0}</strong> existing media file{scanResult.filesLinked === 1 ? '' : 's'} linked</span>
            {scanResult.directMediaFiles > 0 && (
              <span style={{ color: '#d97706' }}>{scanResult.directMediaFiles} media file{scanResult.directMediaFiles === 1 ? '' : 's'} were in the top folder. Put files inside encounter subfolders to import them.</span>
            )}
            {(scanResult.stillUnlinked > 0 || scanResult.stillBroken > 0) && (
              <span style={{ color: 'var(--text-muted)' }}>{scanResult.stillUnlinked || 0} still unlinked · {scanResult.stillBroken || 0} missing</span>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!mediaTypeConfirmTarget}
        onClose={() => setMediaTypeConfirmTarget(null)}
        title="Change media type?"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setMediaTypeConfirmTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmMediaTypeChange}>
              Change Media Type
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, padding: '10px 12px', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8 }}>
            <AlertTriangle size={18} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.55 }}>
              <strong>{mediaTypeConfirmTarget?.mediaFile?.name}</strong> already has {mediaTypeConfirmReviewCount} review{mediaTypeConfirmReviewCount === 1 ? '' : 's'}.
              {mediaTypeConfirmSubmittedCount > 0 && (
                <> {mediaTypeConfirmSubmittedCount} submitted review{mediaTypeConfirmSubmittedCount === 1 ? '' : 's'} will be reopened and marked in progress.</>
              )}
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            Changing the media type updates the workspace snapshot for existing reviews. Any forms that are no longer part of the selected media type may be removed from those reviews.
          </p>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            New media type: <strong style={{ color: 'var(--text-secondary)' }}>{mediaTypeConfirmNextType?.name || 'No media type'}</strong>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
        title="Unlock Media Type Change"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setUnlockTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleUnlockAndChangeMediaType} disabled={!unlockInput}>
              Unlock and Apply
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            This project is password protected. Enter the owner password to change the media type for <strong>{unlockTarget?.mediaFile?.name}</strong>.
          </p>
          <div className="form-field">
            <label>Owner Password</label>
            <input
              autoFocus
              type="password"
              value={unlockInput}
              onChange={e => { setUnlockInput(e.target.value); setUnlockError('') }}
              onKeyDown={e => e.key === 'Enter' && handleUnlockAndChangeMediaType()}
            />
            {unlockError && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{unlockError}</span>}
          </div>
        </div>
      </Modal>

      <Modal
        open={showAutolinkModal}
        onClose={() => { if (!autolinking) { setShowAutolinkModal(false); setAutolinkResult(null) } }}
        title="Auto-link Files"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => { setShowAutolinkModal(false); setAutolinkResult(null) }} disabled={autolinking}>
              {autolinkResult ? 'Close' : 'Cancel'}
            </button>
            {!autolinkResult && (
              <button className="btn btn-primary" onClick={handleRunAutolink} disabled={autolinking || !autolinkFolder}>
                <RefreshCw size={13} style={{ animation: autolinking ? 'spin 1s linear infinite' : 'none' }} />
                {autolinking ? 'Linking…' : 'Auto-link'}
              </button>
            )}
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!autolinkResult ? (
            <>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 4 }}>How auto-link works</strong>
                Auto-link searches a folder (and all its subfolders) for files whose names match the media slots in this project. Matching is done by filename — the file name on disk must match the slot name in the project exactly (case-insensitive). Already-linked files are skipped.
                <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', lineHeight: 1.7 }}>
                  Slot: <strong>consult_video.mp4</strong><br />
                  Match: <strong>/your/folder/Patient001/consult_video.mp4</strong> ✓<br />
                  No match: <strong>/your/folder/ConsultVideo.mp4</strong> ✗
                </div>
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label>Base Folder</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={autolinkFolder}
                    onChange={e => setAutolinkFolder(e.target.value)}
                    placeholder="/path/to/your/media/folder"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-secondary" style={{ flexShrink: 0 }}
                    onClick={async () => { const p = await api.selectFolder(); if (p) setAutolinkFolder(p) }}>
                    Browse
                  </button>
                </div>
                <span className="text-muted text-sm" style={{ marginTop: 4 }}>
                  The folder (and subfolders) to search. This is saved per project so you only set it once.
                </span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {autolinkResult.error ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c' }}>
                  {autolinkResult.error}
                </div>
              ) : (
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {autolinkResult.linked > 0
                    ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ {autolinkResult.linked} file{autolinkResult.linked !== 1 ? 's' : ''} linked</span>
                    : <span style={{ color: 'var(--text-muted)' }}>No new files linked</span>}
                  {autolinkResult.skipped > 0 && <span style={{ color: 'var(--text-muted)' }}>· {autolinkResult.skipped} already linked (skipped)</span>}
                  {autolinkResult.ambiguous > 0 && <span style={{ color: '#d97706' }}>· {autolinkResult.ambiguous} ambiguous — multiple files matched the same name, link manually using the button on each file</span>}
                  {autolinkResult.notFound > 0 && <span style={{ color: 'var(--text-muted)' }}>· {autolinkResult.notFound} not found in folder</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {newReview && (
        <NewReviewModal
          mediaFile={newReview.mediaFile}
          projectId={projectId}
          onClose={() => setNewReview(null)}
          onCreated={(reviewId) => { setNewReview(null); navigate(`/review/${reviewId}`) }}
        />
      )}

      {/* Reviewer name modal */}
      <Modal
        open={showNameModal}
        onClose={() => setShowNameModal(false)}
        title="Your Name for This Project"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowNameModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveReviewerName} disabled={!nameInput.trim()}>Save</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            This name is attached to every review you create on this project. Use the same name on every device.
            <br /><br />
            <strong>Sharing this computer?</strong> Each person should set their own name here before creating reviews.
          </p>
          <div className="form-field">
            <label>Your Name</label>
            <input
              autoFocus
              placeholder="e.g. Alice Chen"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveReviewerName()}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={showProjectNameModal}
        onClose={() => setShowProjectNameModal(false)}
        title="Edit Project Name"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowProjectNameModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveProjectName} disabled={!projectNameInput.trim()}>Save</button>
          </>
        }
      >
        <div className="form-field">
          <label>Project Name</label>
          <input
            autoFocus
            value={projectNameInput}
            onChange={e => setProjectNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveProjectName()}
            placeholder="Project name"
          />
        </div>
      </Modal>

      {tour.node}
    </div>
  )
}

function FolderOpenIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function Pagination({ currentPage, totalPages, total, pageSize, onPageChange }) {
  if (totalPages <= 1) return null
  const start = (currentPage - 1) * pageSize + 1
  const end = Math.min(currentPage * pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
        ← Prev
      </button>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {start}–{end} of {total}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
        Next →
      </button>
    </div>
  )
}

function EncounterRow({ encounter, expanded, onToggle, mediaTypes, onRenameEncounter, onRenameMedia, onAddMedia, onChangeMediaType, onAddReview, onOpenReview, onDeleteReview, onManualLink, onMarkNA, onClearLink, linkSaving }) {
  const completedMedia = encounter.media?.filter(m => {
    if (!m.reviews_required) return m.reviews?.some(r => r.status === 'submitted')
    return m.reviews_completed >= m.reviews_required
  }) || []
  const total = encounter.media?.length || 0
  const complete = encounter.completed

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Encounter header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', cursor: 'pointer', background: expanded ? 'var(--bg-secondary)' : 'var(--bg)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => !expanded && (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => !expanded && (e.currentTarget.style.background = 'var(--bg)')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {expanded ? <ChevronDown size={15} color="var(--text-secondary)" /> : <ChevronRight size={15} color="var(--text-secondary)" />}
          {complete
            ? <CheckCircle2 size={15} color="var(--success)" />
            : <Circle size={15} color="var(--text-muted)" />
          }
          <span style={{ fontWeight: 500, fontSize: 14 }}>{encounter.name}</span>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title="Rename encounter"
            style={{ width: 22, height: 22, padding: 0 }}
            onClick={e => { e.stopPropagation(); onRenameEncounter() }}
          >
            <Pencil size={11} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="text-muted text-sm">{total} media file{total !== 1 ? 's' : ''}</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ height: 24, padding: '2px 8px', fontSize: 11 }}
            onClick={e => { e.stopPropagation(); onAddMedia() }}
          >
            <Plus size={11} /> Add media
          </button>
          <span className={`badge ${complete ? 'badge-success' : 'badge-muted'}`}>
            {complete ? 'Complete' : `${completedMedia.length}/${total}`}
          </span>
        </div>
      </div>

      {/* Media list */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          {(encounter.media || []).map((mf, idx) => (
            <MediaRow
              key={mf.id}
              mediaFile={mf}
              mediaTypes={mediaTypes}
              onAddReview={() => onAddReview(mf)}
              onOpenReview={onOpenReview}
              onDeleteReview={onDeleteReview}
              onManualLink={onManualLink}
              onMarkNA={onMarkNA}
              onClearLink={onClearLink}
              onChangeMediaType={onChangeMediaType}
              onRename={() => onRenameMedia(mf)}
              linkSaving={linkSaving}
              isFirst={idx === 0}
            />
          ))}
          {encounter.media?.length === 0 && (
            <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13 }}>No media files in this encounter folder.</div>
          )}
        </div>
      )}
    </div>
  )
}

function linkStatusBadge(status) {
  if (!status || status === 'linked') return null
  if (status === 'missing') return <span style={{ fontSize: 10, fontWeight: 600, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 3, padding: '1px 5px' }}>File missing</span>
  if (status === 'not_applicable') return <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>N/A</span>
  return <span style={{ fontSize: 10, fontWeight: 600, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3, padding: '1px 5px' }}>Not linked</span>
}

function reopenedReasonLabel(reason) {
  if (reason === 'form_version_changed') return 'Reopened after form update'
  if (reason === 'media_type_version_changed') return 'Reopened after media type update'
  return 'Reopened'
}

function MediaRow({ mediaFile, mediaTypes, onAddReview, onOpenReview, onDeleteReview, onManualLink, onMarkNA, onClearLink, onChangeMediaType, onRename, linkSaving, isFirst }) {
  const Icon = MEDIA_ICONS[mediaFile.file_type] || File
  const required = mediaFile.reviews_required
  const completed = mediaFile.reviews_completed || 0
  const mediaType = mediaTypes.find(t => t.id === mediaFile.media_type_id)
  const status = mediaFile.link_status
  const busy = linkSaving === mediaFile.id

  return (
    <div id={isFirst ? 'tut-proj-mediarow' : undefined} style={{
      padding: '12px 20px 12px 40px',
      borderBottom: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon size={14} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 500, fontSize: 13 }} className="truncate">{mediaFile.name}</span>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title="Rename media"
            style={{ width: 22, height: 22, padding: 0, flexShrink: 0 }}
            onClick={onRename}
          >
            <Pencil size={11} />
          </button>
          {linkStatusBadge(status)}
          {status !== 'linked' && status !== 'not_applicable' && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22, flexShrink: 0 }}
              onClick={() => onManualLink(mediaFile.id)} disabled={busy}>
              {busy ? '…' : status === 'missing' ? 'Locate' : 'Link'}
            </button>
          )}
          {status === 'linked' && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22, flexShrink: 0 }}
              onClick={() => onManualLink(mediaFile.id)} disabled={busy}>
              {busy ? '…' : 'Relink'}
            </button>
          )}
          {status !== 'not_applicable' && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22, color: 'var(--text-muted)', flexShrink: 0 }}
              onClick={() => onMarkNA(mediaFile.id)} title="Mark as not applicable">
              N/A
            </button>
          )}
          {status === 'not_applicable' && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22, flexShrink: 0 }}
              onClick={() => onClearLink(mediaFile.id)}>
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div id={isFirst ? 'tut-proj-mediatype' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: mediaType?.color || 'var(--border)', flexShrink: 0 }} />
            <select
              title="Media type"
              value={mediaFile.media_type_id || ''}
              onChange={e => onChangeMediaType(mediaFile, e.target.value || null)}
              style={{
                height: 26,
                maxWidth: 180,
                fontSize: 11,
                color: 'var(--text-secondary)',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '2px 22px 2px 7px',
              }}
            >
              <option value="">No media type</option>
              {mediaTypes.map(type => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </div>
          {required && (
            <span className={`badge ${completed >= required ? 'badge-success' : 'badge-muted'}`}>
              {completed}/{required} reviews
            </span>
          )}
        </div>
      </div>

      {/* Reviews */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="text-muted text-sm">Reviewed by:</span>
        {(mediaFile.reviews || []).length === 0 && (
          <span className="text-muted text-sm">—</span>
        )}
        {(mediaFile.reviews || []).map(r => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, background: 'var(--accent-light)', borderRadius: 4, overflow: 'hidden' }}>
            <button
              className="badge badge-accent"
              onClick={() => onOpenReview(r.id)}
              style={{ cursor: 'pointer', border: 'none', borderRadius: 0, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent' }}
            >
              <Play size={9} />
              {r.reviewer_name}
              {r.status === 'submitted' && <CheckCircle2 size={9} color="var(--success)" />}
              {r.status !== 'submitted' && r.reopened_at && (
                <span title={reopenedReasonLabel(r.reopened_reason)} style={{ fontSize: 9, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3, padding: '0 4px' }}>
                  Reopened
                </span>
              )}
            </button>
            <button
              onClick={() => onDeleteReview(r)}
              title="Delete review"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 5px', display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <button id={isFirst ? 'tut-proj-addreview' : undefined} className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22 }} onClick={onAddReview}>
          <Plus size={11} /> Add review
        </button>
      </div>
    </div>
  )
}

// ── Progress View ─────────────────────────────────────────────────────────────
function ProgressView({ encounters, mediaTypes }) {
  const allMedia = encounters.flatMap(e => (e.media || []))
  const allReviews = allMedia.flatMap(m => (m.reviews || []))
  const submitted = allReviews.filter(r => r.status === 'submitted')
  const totalEnc = encounters.length
  const completeEnc = encounters.filter(e => e.completed).length

  // Per-reviewer stats
  const reviewerMap = {}
  for (const r of allReviews) {
    const name = r.reviewer_name || 'Unknown'
    if (!reviewerMap[name]) reviewerMap[name] = { total: 0, submitted: 0 }
    reviewerMap[name].total++
    if (r.status === 'submitted') reviewerMap[name].submitted++
  }
  const reviewers = Object.entries(reviewerMap).sort((a, b) => b[1].submitted - a[1].submitted)
  const maxSubmitted = Math.max(1, ...reviewers.map(([, v]) => v.submitted))

  // Per media type stats
  const typeMap = {}
  for (const m of allMedia) {
    const name = m.media_type_name || 'Untyped'
    const color = m.media_type_color || '#6366f1'
    if (!typeMap[name]) typeMap[name] = { total: 0, submitted: 0, color }
    typeMap[name].total += m.reviews_required || 1
    typeMap[name].submitted += m.reviews_completed || 0
  }
  const types = Object.entries(typeMap)

  const Stat = ({ label, value, sub }) => (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '18px 22px', minWidth: 140 }}>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Progress</h1>
      <p className="text-secondary text-sm" style={{ marginBottom: 28 }}>Completion overview across all encounters and reviewers.</p>

      {/* Top stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        <Stat label="Encounters Complete" value={`${completeEnc}/${totalEnc}`} sub={totalEnc > 0 ? `${Math.round(completeEnc / totalEnc * 100)}%` : '—'} />
        <Stat label="Reviews Submitted" value={submitted.length} sub={`of ${allReviews.length} total`} />
        <Stat label="Active Reviewers" value={reviewers.length} />
      </div>

      {/* Overall progress bar */}
      {allReviews.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            <span>Overall Completion</span>
            <span style={{ color: 'var(--text-muted)' }}>{Math.round(submitted.length / allReviews.length * 100)}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 99 }}>
            <div style={{ height: '100%', borderRadius: 99, background: 'var(--primary)', width: `${submitted.length / allReviews.length * 100}%`, transition: 'width 0.4s' }} />
          </div>
        </div>
      )}

      {/* Per-reviewer breakdown */}
      {reviewers.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>By Reviewer</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reviewers.map(([name, stats]) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{stats.submitted} submitted · {stats.total} total</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 99 }}>
                  <div style={{ height: '100%', borderRadius: 99, background: 'var(--primary)', width: `${stats.submitted / maxSubmitted * 100}%`, transition: 'width 0.4s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per encounter completion */}
      {encounters.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>By Encounter</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {encounters.map(enc => {
              const total = (enc.media || []).reduce((s, m) => s + (m.reviews_required || 1), 0)
              const done = (enc.media || []).reduce((s, m) => s + Math.min(m.reviews_completed || 0, m.reviews_required || 1), 0)
              const pct = total > 0 ? done / total * 100 : 0
              return (
                <div key={enc.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 160, fontSize: 12, color: enc.completed ? 'var(--success)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {enc.completed && <CheckCircle2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />}{enc.name}
                  </div>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 99 }}>
                    <div style={{ height: '100%', borderRadius: 99, background: enc.completed ? 'var(--success)' : 'var(--primary)', width: `${pct}%`, transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', width: 40, textAlign: 'right' }}>{Math.round(pct)}%</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {encounters.length === 0 && <div className="empty-state"><p>No encounters yet.</p></div>}
    </div>
  )
}

// ── Activity View ─────────────────────────────────────────────────────────────
function ActivityView({ encounters }) {
  const events = []
  for (const enc of encounters) {
    for (const m of (enc.media || [])) {
      for (const r of (m.reviews || [])) {
        if (r.submitted_at) events.push({ type: 'submitted', date: new Date(r.submitted_at), reviewer: r.reviewer_name, encounter: enc.name, file: m.name })
        else events.push({ type: 'in_progress', date: new Date(r.created_at), reviewer: r.reviewer_name, encounter: enc.name, file: m.name })
      }
    }
  }
  events.sort((a, b) => b.date - a.date)

  function groupByDate(events) {
    const groups = {}
    for (const e of events) {
      const key = e.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    }
    return Object.entries(groups)
  }

  function initials(name) {
    return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }



  const groups = groupByDate(events)

  return (
    <div style={{ maxWidth: 620 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Activity</h1>
      <p className="text-secondary text-sm" style={{ marginBottom: 28 }}>Review events across all encounters, newest first.</p>

      {groups.length === 0 && <div className="empty-state"><p>No review activity yet.</p></div>}

      {groups.map(([date, evts]) => (
        <div key={date} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{date}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {evts.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 7, background: 'var(--bg-secondary)' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: colorFor(e.reviewer), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {initials(e.reviewer)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span>{e.reviewer}</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {e.encounter} / {e.file}</span>
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {e.type === 'submitted'
                    ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', background: 'var(--success-light)', padding: '2px 7px', borderRadius: 99 }}>Submitted</span>
                    : <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--border)', padding: '2px 7px', borderRadius: 99 }}>In progress</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {e.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function getAgreementSchemaSections(formSnapshot) {
  if (!formSnapshot) return []
  if (Array.isArray(formSnapshot?.sections)) return formSnapshot.sections
  if (Array.isArray(formSnapshot?.schema?.sections)) return formSnapshot.schema.sections
  if (Array.isArray(formSnapshot?.form?.schema?.sections)) return formSnapshot.form.schema.sections
  return []
}

function collectAgreementQuestionOptions(reviews) {
  const sections = new Map()
  const questions = new Map()

  for (const review of reviews || []) {
    for (const formResponse of review.form_responses || []) {
      const formName = formResponse.form_snapshot?.name || 'Form'
      for (const section of getAgreementSchemaSections(formResponse.form_snapshot)) {
        const sectionKey = `${formResponse.form_id || 'form'}:${section.id || section.title || 'section'}`
        if (!sections.has(sectionKey)) {
          sections.set(sectionKey, {
            id: sectionKey,
            label: `${formName} · ${section.title || 'Untitled section'}`,
            questionIds: [],
          })
        }
        const sectionEntry = sections.get(sectionKey)
        for (const el of section.elements || []) {
          if (!el?.id || el.type === 'text_block') continue
          if (!questions.has(String(el.id))) {
            questions.set(String(el.id), {
              id: String(el.id),
              label: `${formName} · ${el.label || 'Untitled question'}`,
              sectionId: sectionKey,
              isFinalEvaluation: el.global_agreement_question === true,
            })
          }
          if (!sectionEntry.questionIds.includes(String(el.id))) sectionEntry.questionIds.push(String(el.id))
        }
      }
    }
  }

  return {
    sections: Array.from(sections.values()).filter(section => section.questionIds.length > 0),
    questions: Array.from(questions.values()),
  }
}

function mediaTypeOptionId(id) {
  return id == null || id === '' ? 'untyped' : String(id)
}

function toggleSelection(list, id) {
  return list.includes(id) ? list.filter(item => item !== id) : [...list, id]
}

function agreementMediaTypeIdForReview(review, mediaTypes = []) {
  if (review?.media_type_id != null && review.media_type_id !== '') return mediaTypeOptionId(review.media_type_id)

  if (review?.media_type_sync_id) {
    const bySyncId = mediaTypes.find(type => type.sync_id && type.sync_id === review.media_type_sync_id)
    if (bySyncId) return mediaTypeOptionId(bySyncId.id)
  }

  const snapshotMediaType = review?.workspace_snapshot?.media_type
  if (snapshotMediaType?.sync_id) {
    const bySnapshotSyncId = mediaTypes.find(type => type.sync_id && type.sync_id === snapshotMediaType.sync_id)
    if (bySnapshotSyncId) return mediaTypeOptionId(bySnapshotSyncId.id)
  }
  if (snapshotMediaType?.name) {
    const bySnapshotName = mediaTypes.find(type => type.name === snapshotMediaType.name)
    if (bySnapshotName) return mediaTypeOptionId(bySnapshotName.id)
  }

  const formIds = new Set((review?.form_responses || [])
    .map(formResponse => formResponse?.form_id)
    .filter(id => id != null && id !== '')
    .map(id => String(id)))
  if (formIds.size > 0) {
    const matches = mediaTypes.filter(type => (type.workspace_tabs || []).some(tab => (
      tab.tab_type === 'form' && formIds.has(String(tab.ref_id))
    )))
    if (matches.length === 1) return mediaTypeOptionId(matches[0].id)
    if (matches.length > 1 && review?.media_type_name) {
      const byName = matches.find(type => type.name === review.media_type_name)
      if (byName) return mediaTypeOptionId(byName.id)
    }
    if (matches.length > 0) return mediaTypeOptionId(matches[0].id)
  }

  return 'untyped'
}

function AgreementMultiSelect({ label, options, selectedIds, onChange, emptyText, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectedCount = selectedIds.length
  const summary = selectedCount === 0 ? `No ${label.toLowerCase()} selected` : `${selectedCount} selected`
  const menuStyle = {
    position: 'absolute',
    zIndex: 30,
    top: '100%',
    marginTop: 6,
    width: 'min(420px, calc(100vw - 48px))',
    minWidth: '100%',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg)',
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden',
  }
  if (align === 'right') menuStyle.right = 0
  else menuStyle.left = 0

  return (
    <div className="form-field" style={{ margin: 0, position: 'relative' }} ref={ref}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <label style={{ margin: 0 }}>{label}</label>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange([])} disabled={selectedCount === 0} style={{ height: 24, padding: '2px 8px', fontSize: 11 }}>
          Clear
        </button>
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen(value => !value)}
        style={{ width: '100%', height: 34, justifyContent: 'space-between', fontSize: 13, padding: '0 10px', gap: 8 }}
      >
        <span className="truncate" style={{ minWidth: 0, textAlign: 'left' }}>{summary}</span>
        <ChevronDown size={14} style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <div style={menuStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {selectedCount === 0 ? 'No filter applied' : `${selectedCount} selected`}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} style={{ height: 24, padding: '2px 8px', fontSize: 11 }}>
              Done
            </button>
          </div>
          <div style={{ maxHeight: 280, overflow: 'auto', padding: 6 }}>
            {options.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>{emptyText}</div>
            ) : options.map(option => (
              <label key={option.id} style={{
                display: 'grid',
                gridTemplateColumns: '16px minmax(0, 1fr)',
                alignItems: 'start',
                columnGap: 10,
                padding: '8px 9px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                margin: 0,
              }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(option.id)}
                  onChange={() => onChange(toggleSelection(selectedIds, option.id))}
                  style={{ marginTop: 2 }}
                />
                <span style={{ lineHeight: 1.35, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{option.label}</span>
                  {option.subLabel && <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: 2 }}>{option.subLabel}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Data Visualization View ───────────────────────────────────────────────────
function DataVizView({ projectId, mediaTypes = [] }) {
  const [agreementRows, setAgreementRows] = useState([])
  const [rawReviews, setRawReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMediaTypeId, setSelectedMediaTypeId] = useState('')
  const [agreementMode, setAgreementMode] = useState('question')
  const [selectedSectionIds, setSelectedSectionIds] = useState([])
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([])

  useEffect(() => {
    if (!projectId) return
    let active = true
    async function load() {
      setLoading(true)
      try {
        const raw = await api.getProjectInterraterAgreementData(projectId)
        if (!active) return
        setRawReviews(raw || [])
      } catch {
        setRawReviews([])
        setAgreementRows([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [projectId])

  const mediaTypesWithReviews = useMemo(() => {
    const byId = new Map()
    for (const type of mediaTypes || []) {
      byId.set(mediaTypeOptionId(type.id), { id: mediaTypeOptionId(type.id), name: type.name || 'Media type' })
    }
    for (const review of rawReviews || []) {
      const id = agreementMediaTypeIdForReview(review, mediaTypes)
      if (!byId.has(id)) byId.set(id, { id, name: review.media_type_name || (id === 'untyped' ? 'Untyped' : 'Media type') })
    }
    const reviewedIds = new Set((rawReviews || []).map(review => agreementMediaTypeIdForReview(review, mediaTypes)))
    return Array.from(byId.values()).filter(type => reviewedIds.has(String(type.id)))
  }, [mediaTypes, rawReviews])

  useEffect(() => {
    if (mediaTypesWithReviews.length === 0) {
      if (selectedMediaTypeId) setSelectedMediaTypeId('')
      return
    }
    if (selectedMediaTypeId && mediaTypesWithReviews.some(type => String(type.id) === String(selectedMediaTypeId))) return
    setSelectedMediaTypeId(String(mediaTypesWithReviews[0].id))
  }, [mediaTypesWithReviews, selectedMediaTypeId])

  const filteredReviews = useMemo(() => {
    if (!selectedMediaTypeId) return []
    return rawReviews.filter(review => agreementMediaTypeIdForReview(review, mediaTypes) === String(selectedMediaTypeId))
  }, [mediaTypes, rawReviews, selectedMediaTypeId])

  const questionOptions = useMemo(() => collectAgreementQuestionOptions(filteredReviews), [filteredReviews])

  useEffect(() => {
    const validSectionIds = new Set(questionOptions.sections.map(section => section.id))
    const validQuestionIds = new Set(questionOptions.questions.map(question => question.id))
    setSelectedSectionIds(ids => ids.filter(id => validSectionIds.has(id)))
    setSelectedQuestionIds(ids => ids.filter(id => validQuestionIds.has(id)))
  }, [questionOptions])

  useEffect(() => {
    const effectiveQuestionIds = (() => {
      if (agreementMode !== 'question') return null
      const ids = new Set(selectedQuestionIds)
      for (const sectionId of selectedSectionIds) {
        const section = questionOptions.sections.find(item => item.id === sectionId)
        for (const questionId of section?.questionIds || []) ids.add(questionId)
      }
      return ids.size > 0 ? Array.from(ids) : null
    })()

    const grouped = new Map()
    for (const review of filteredReviews || []) {
      if (!review?.form_responses?.length) continue
      const key = `${review.media_file_id}`
      if (!grouped.has(key)) {
        grouped.set(key, { mediaName: review.media_name, encounterName: review.encounter_name, reviews: [] })
      }
      grouped.get(key).reviews.push(review)
    }

    const rows = Array.from(grouped.values()).map(entry => computeInterraterAgreementForMediaFile({
      mediaName: entry.mediaName,
      encounterName: entry.encounterName,
      reviewDetails: entry.reviews,
      questionIds: effectiveQuestionIds,
      globalOnly: agreementMode === 'final',
    })).filter(item => item.reviewCount >= 2)
    rows.sort((a, b) => (b.overallAgreement ?? -1) - (a.overallAgreement ?? -1))
    setAgreementRows(rows)
  }, [agreementMode, filteredReviews, questionOptions, selectedQuestionIds, selectedSectionIds])

  const scoredAgreementRows = agreementRows.filter(row => row.overallAgreement != null)
  const averageAgreement = scoredAgreementRows.length > 0
    ? scoredAgreementRows.reduce((sum, row) => sum + row.overallAgreement, 0) / scoredAgreementRows.length
    : null
  const finalQuestionCount = questionOptions.questions.filter(question => question.isFinalEvaluation).length
  const selectedMediaType = mediaTypesWithReviews.find(type => String(type.id) === String(selectedMediaTypeId))

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Data Visualization</h1>
          <p className="text-secondary text-sm" style={{ margin: 0 }}>Compare question-level agreement or the final evaluation question for one media type.</p>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 1.5fr)', gap: 12 }}>
          <div className="form-field" style={{ margin: 0 }}>
            <label>Media Type</label>
            <select value={selectedMediaTypeId} onChange={e => { setSelectedMediaTypeId(e.target.value); setSelectedSectionIds([]); setSelectedQuestionIds([]) }} style={{ height: 34, fontSize: 13 }}>
              {mediaTypesWithReviews.length === 0 && <option value="">No reviewed media types</option>}
              {mediaTypesWithReviews.map(type => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label>Compare</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className={`btn btn-sm ${agreementMode === 'question' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAgreementMode('question')}>
                Question-Level Agreement
              </button>
              <button className={`btn btn-sm ${agreementMode === 'final' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAgreementMode('final')}>
                Final Evaluation Agreement
              </button>
            </div>
          </div>
        </div>
        {agreementMode === 'question' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <AgreementMultiSelect
              label="Sections"
              options={questionOptions.sections.map(section => ({
                id: section.id,
                label: section.label,
                subLabel: `${section.questionIds.length} question${section.questionIds.length === 1 ? '' : 's'}`,
              }))}
              selectedIds={selectedSectionIds}
              onChange={setSelectedSectionIds}
              emptyText="No sections found"
            />
            <AgreementMultiSelect
              label="Questions"
              options={questionOptions.questions.map(question => ({
                id: question.id,
                label: question.label,
              }))}
              selectedIds={selectedQuestionIds}
              onChange={setSelectedQuestionIds}
              emptyText="No questions found"
              align="right"
            />
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-muted)' }}>
              {selectedSectionIds.length === 0 && selectedQuestionIds.length === 0
                ? 'Using all comparable questions.'
                : `Using ${selectedSectionIds.length} section${selectedSectionIds.length === 1 ? '' : 's'} and ${selectedQuestionIds.length} individual question${selectedQuestionIds.length === 1 ? '' : 's'}.`}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: finalQuestionCount > 0 ? 'var(--text-secondary)' : '#92400e', background: finalQuestionCount > 0 ? 'var(--bg-secondary)' : '#fffbeb', border: `1px solid ${finalQuestionCount > 0 ? 'var(--border)' : '#fde68a'}`, borderRadius: 8, padding: '8px 10px' }}>
            {finalQuestionCount > 0
              ? `${finalQuestionCount} final evaluation question${finalQuestionCount === 1 ? '' : 's'} found for ${selectedMediaType?.name || 'this media type'}.`
              : 'No final evaluation question is set for this media type. Mark one question in form settings to use this mode.'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Files Compared</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{agreementRows.length}</div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Average Agreement</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{averageAgreement == null ? '—' : `${Math.round(averageAgreement * 100)}%`}</div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><p>Calculating agreement…</p></div>
      ) : agreementRows.length === 0 ? (
        <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <LineChart size={38} style={{ margin: '0 auto 14px', opacity: 0.35 }} />
          <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No matching multi-review comparisons yet</p>
          <p style={{ fontSize: 13 }}>Submit at least two reviews for the same file, or adjust the media type and agreement filters.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agreementRows.map(row => (
            <div key={`${row.encounterName}-${row.mediaName}`} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{row.mediaName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {row.encounterName} · {row.reviewCount} reviews
                    {row.excludedQuestionCount > 0 ? ` · ${row.excludedQuestionCount} excluded` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: row.overallAgreement >= 0.8 ? 'var(--success)' : row.overallAgreement >= 0.6 ? 'var(--accent)' : 'var(--danger)' }}>
                  {row.overallAgreement == null ? '—' : `${Math.round(row.overallAgreement * 100)}%`}
                </div>
              </div>
              {row.questions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {row.questions.slice(0, 6).map(question => (
                    <div key={`${row.mediaName}-${question.label}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{question.label}</span>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {AGREEMENT_METHOD_LABELS[question.method] || question.type} · w{question.weight ?? 1} · {Math.round((question.agreement || 0) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comparable form questions were found for this video.</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Agreement Between Results View ────────────────────────────────────────────
// Compares the current machine's own submitted-review answers ("mine") against
// an imported results file ("theirs"), using the same computeInterraterAgreementForMediaFile
// engine that powers Data Visualization above. Matching across the two sets is by
// encounter_name + media_name (not sync ids), since imported results come from an
// unrelated install where local ids/sync ids won't line up. Neither set of coding
// is ever modified — this view only reads api.getResultsComparisonData().
function AgreementResultsView({ projectId }) {
  const [loading, setLoading] = useState(true)
  const [mineRows, setMineRows] = useState([])
  const [importedSources, setImportedSources] = useState([])
  const [selectedSourceId, setSelectedSourceId] = useState('')

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await api.getResultsComparisonData(projectId)
      setMineRows(data?.mine || [])
      setImportedSources(data?.imported || [])
    } catch {
      setMineRows([])
      setImportedSources([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (importedSources.length === 0) {
      if (selectedSourceId) setSelectedSourceId('')
      return
    }
    if (selectedSourceId && importedSources.some(s => String(s.id) === String(selectedSourceId))) return
    setSelectedSourceId(String(importedSources[0].id))
  }, [importedSources, selectedSourceId])

  async function handleDeleteSource(id) {
    await api.deleteImportedResult(id, projectId)
    load()
  }

  const selectedSource = importedSources.find(s => String(s.id) === String(selectedSourceId))

  const agreementRows = useMemo(() => {
    if (!selectedSource) return []
    const grouped = new Map()
    const addRow = (row, bucket) => {
      const key = `${row.encounter_name}||${row.media_name}`
      if (!grouped.has(key)) grouped.set(key, { encounterName: row.encounter_name, mediaName: row.media_name, mine: [], theirs: [] })
      grouped.get(key)[bucket].push(row)
    }
    for (const row of mineRows) addRow(row, 'mine')
    for (const row of (selectedSource.responses_long || [])) addRow(row, 'theirs')

    const rows = []
    for (const entry of grouped.values()) {
      // Missing on one side is handled by the "Only In..." tiles below rather than
      // rendered as a broken/empty comparison card here.
      if (entry.mine.length === 0 || entry.theirs.length === 0) continue
      const reviewDetails = [
        { form_responses: entry.mine.map(r => ({ form_id: r.form_id, responses: r.responses, form_snapshot: r.form_snapshot })) },
        { form_responses: entry.theirs.map(r => ({ form_id: r.form_id, responses: r.responses, form_snapshot: r.form_snapshot })) },
      ]
      rows.push(computeInterraterAgreementForMediaFile({
        mediaName: entry.mediaName,
        encounterName: entry.encounterName,
        reviewDetails,
      }))
    }
    rows.sort((a, b) => (b.overallAgreement ?? -1) - (a.overallAgreement ?? -1))
    return rows
  }, [mineRows, selectedSource])

  const missing = useMemo(() => {
    if (!selectedSource) return { mineOnly: 0, theirsOnly: 0 }
    const mineKeys = new Set(mineRows.map(r => `${r.encounter_name}||${r.media_name}`))
    const theirKeys = new Set((selectedSource.responses_long || []).map(r => `${r.encounter_name}||${r.media_name}`))
    let mineOnly = 0, theirsOnly = 0
    for (const k of mineKeys) if (!theirKeys.has(k)) mineOnly++
    for (const k of theirKeys) if (!mineKeys.has(k)) theirsOnly++
    return { mineOnly, theirsOnly }
  }, [mineRows, selectedSource])

  const scoredAgreementRows = agreementRows.filter(row => row.overallAgreement != null)
  const averageAgreement = scoredAgreementRows.length > 0
    ? scoredAgreementRows.reduce((sum, row) => sum + row.overallAgreement, 0) / scoredAgreementRows.length
    : null

  if (loading) return <div className="empty-state"><p>Loading…</p></div>

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Agreement Between Results</h1>
        <p className="text-secondary text-sm" style={{ margin: 0 }}>Compare your coding against an imported results file. Neither set of coding is modified.</p>
      </div>

      {importedSources.length === 0 ? (
        <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <GitCompare size={38} style={{ margin: '0 auto 14px', opacity: 0.35 }} />
          <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No imported results yet</p>
          <p style={{ fontSize: 13 }}>Use "Import Results" above to load another coder's exported results file.</p>
        </div>
      ) : (
        <>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
              <label>Compare against</label>
              <select value={selectedSourceId} onChange={e => setSelectedSourceId(e.target.value)} style={{ height: 34, fontSize: 13, width: '100%' }}>
                {importedSources.map(s => (
                  <option key={s.id} value={s.id}>{s.reviewer_name || s.source_name} · imported {formatDate(s.imported_at)}</option>
                ))}
              </select>
            </div>
            {selectedSource && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteSource(selectedSource.id)}>
                Remove this import
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Files Compared</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{agreementRows.length}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall Agreement</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{averageAgreement == null ? '—' : `${Math.round(averageAgreement * 100)}%`}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Only In Mine</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{missing.mineOnly}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Only In Imported</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{missing.theirsOnly}</div>
            </div>
          </div>

          {agreementRows.length === 0 ? (
            <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: 14, fontWeight: 500 }}>No overlapping media files found between the two result sets.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {agreementRows.map(row => (
                <div key={`${row.encounterName}-${row.mediaName}`} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{row.mediaName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.encounterName}</div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: row.overallAgreement >= 0.8 ? 'var(--success)' : row.overallAgreement >= 0.6 ? 'var(--accent)' : 'var(--danger)' }}>
                      {row.overallAgreement == null ? '—' : `${Math.round(row.overallAgreement * 100)}%`}
                    </div>
                  </div>
                  {row.questions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {row.questions.map(question => (
                        <div key={`${row.mediaName}-${question.label}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{question.label}</span>
                          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {AGREEMENT_METHOD_LABELS[question.method] || question.type} · {Math.round((question.agreement || 0) * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comparable questions found for this file.</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}