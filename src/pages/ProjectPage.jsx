import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ChevronLeft, Settings, ChevronDown, ChevronRight,
  Video, FileText, File, Plus, CheckCircle2, Circle,
  Search, X, Play, RefreshCw, Share2, FolderDown, AlertTriangle, Cloud, User,
  LayoutList, BarChart2, LineChart, HelpCircle, Pencil,
  Download, Upload, Gauge
} from 'lucide-react'
import { api, formatDate } from '../lib/api'
import { SETUP_SECTIONS } from '../lib/setupSections'
import { AGREEMENT_METHOD_LABELS, computeInterraterAgreementForMediaFile } from '../lib/interraterAgreement.mjs'
import {
  computeQuestionReliability,
  iccInterpretation,
  kappaInterpretation,
} from '../lib/reliabilityStats.mjs'
import Modal from '../components/ui/Modal'
import NewReviewModal from '../components/encounters/NewReviewModal'
import useTour from '../components/ui/useTour'

const PAGE_SIZE = 15

const PROJECT_TOUR_STEPS = [
  {
    targetId: 'tut-proj-nav',
    placement: 'right',
    title: 'Your Project',
    body: 'Welcome to your project. Encounters are listed in the main area. Use this sidebar to switch between Encounters and Progress views. Settings live at the bottom.',
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
    body: "This warning is local to this machine. Use Link on the file in the list below to relink it manually.",
  },
  {
    targetId: 'tut-proj-sync',
    placement: 'bottom',
    title: 'Sync',
    body: "Sync Now pushes your latest reviews and setup changes, then pulls your teammates' latest work. Use Settings → Sync to choose OneDrive, Google Drive, or a shared local folder. Media files are still linked separately on each machine.",
  },
]
const MEDIA_ICONS = { video: Video, document: FileText, other: File }

export default function ProjectPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [project, setProject] = useState(null)
  // Role-based access (Share Project's Leader/Reviewer assignment). Reviewers
  // don't see Settings, Agreement/Alignment, or Import Results — see
  // sync.js's buildExport/createFromImport for how local_role gets set.
  // Note: this only hides the UI entry points here — SetupPage itself isn't
  // gated against someone navigating to /project/:id/setup directly by URL.
  const isReviewer = project?.local_role === 'reviewer'
  const [encounters, setEncounters] = useState([])
  const [mediaTypes, setMediaTypes] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [newReview, setNewReview] = useState(null)
  const [deleteReviewTarget, setDeleteReviewTarget] = useState(null) // { id, reviewer_name }
  const [deleteMediaTarget, setDeleteMediaTarget] = useState(null) // { id, name }
  const [deleteEncounterTarget, setDeleteEncounterTarget] = useState(null) // { id, name }
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
  const [linkSaving, setLinkSaving] = useState(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef(null)
  const [shareClearReviews, setShareClearReviews] = useState(false)
  const [shareRecipients, setShareRecipients] = useState([{ name: '', role: 'reviewer' }])
  const [sharing, setSharing] = useState(false)
  const [newMediaTarget, setNewMediaTarget] = useState(null)
  const [relinkTarget, setRelinkTarget] = useState(null)
  const [isDraggingRelink, setIsDraggingRelink] = useState(false)
  const [isDraggingNewMedia, setIsDraggingNewMedia] = useState(false)
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanFolder, setScanFolder] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [scanningFolder, setScanningFolder] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState(null)
  const [unlockInput, setUnlockInput] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [mediaTypeConfirmTarget, setMediaTypeConfirmTarget] = useState(null)
  const [syncOffline, setSyncOffline] = useState(false)
  const [googleDriveAccessIds, setGoogleDriveAccessIds] = useState([])
  const [grantingGoogleDriveAccess, setGrantingGoogleDriveAccess] = useState(false)
  const [googleDriveMetadataMissing, setGoogleDriveMetadataMissing] = useState(null)
  const [resolvingGoogleDriveMetadata, setResolvingGoogleDriveMetadata] = useState(false)
  const tour = useTour(PROJECT_TOUR_STEPS, 'sdmo_tour_project_v1', {
    ready: !loading && encounters.length > 0,
    onStart: useCallback(() => {
      // Expand the first encounter so media-type and add-review anchors are in the DOM.
      if (encounters[0]) setExpanded(e => ({ ...e, [encounters[0].id]: true }))
    }, [encounters]),
  })

  useEffect(() => { load() }, [projectId, location.pathname])

  useEffect(() => {
    if (!showExportMenu) return
    function handleClickOutside(e) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showExportMenu])

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

  async function handleDeleteMedia() {
    if (!deleteMediaTarget) return
    await api.deleteMediaFile(projectId, deleteMediaTarget.id)
    setDeleteMediaTarget(null)
    const encs = await api.listEncounters(projectId)
    setEncounters(encs)
  }

  async function handleDeleteEncounter() {
    if (!deleteEncounterTarget) return
    await api.deleteEncounter(projectId, deleteEncounterTarget.id)
    setDeleteEncounterTarget(null)
    const encs = await api.listEncounters(projectId)
    setEncounters(encs)
    showToast('Encounter deleted.')
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

  function applySearch(encs) {
    // Sorted ascending by id (creation order) so a newly created encounter
    // always lands after existing ones, rather than wherever the backend
    // happens to return it.
    let result = [...encs].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(enc =>
        enc.name.toLowerCase().includes(q) ||
        enc.media?.some(m => m.name.toLowerCase().includes(q))
      )
    }
    return result
  }

  const filtered = useMemo(() => applySearch(encounters), [encounters, search])

  useEffect(() => setCurrentPage(1), [search])

  // Shared by both manual browse and drag-and-drop relinking below — decides
  // whether to rename the media file (and its encounter, if it's the only
  // media file in it) to match the newly-linked file's name. Automatic when
  // safe (no existing submitted reviews to orphan); otherwise asks first,
  // since media_name is the exact key Agreement/Alignment/Progress use to
  // match reviews across reviewers and installs — renaming it out from under
  // existing reviews would silently stop them matching anything recorded
  // after the rename.
  async function maybeRenameAfterRelink(mediaFileId, linkResult) {
    if (!linkResult?.nameChanged) return
    if (linkResult.hasReviews) {
      const proceed = window.confirm(
        `This file already has submitted reviews recorded under the name "${linkResult.currentName}". ` +
        `Renaming it to "${linkResult.newName}" means those existing reviews won't automatically match ` +
        `new ones or imported results going forward. Rename anyway?`
      )
      if (!proceed) return
    }
    await api.applyRelinkRename(projectId, mediaFileId, linkResult.newName)
  }

  async function handleManualLink(mediaFileId) {
    setLinkSaving(mediaFileId)
    const filePath = await api.browseMediaFile(mediaFileId)
    if (filePath) {
      const result = await api.setMediaLink(mediaFileId, projectId, filePath)
      await maybeRenameAfterRelink(mediaFileId, result)
      const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
      setEncounters(encs)
      setMediaHealth(health)
    }
    setLinkSaving(null)
  }

  // Called with an already-resolved absolute path (from either the row-level
  // drop target or the relink modal's own drop zone below) — skips straight
  // to setMediaLink instead of opening the native picker.
  async function handleDropLink(mediaFileId, filePath) {
    setLinkSaving(mediaFileId)
    const result = await api.setMediaLink(mediaFileId, projectId, filePath)
    await maybeRenameAfterRelink(mediaFileId, result)
    const [encs, health] = await Promise.all([api.listEncounters(projectId), api.mediaHealthCheck(projectId)])
    setEncounters(encs)
    setMediaHealth(health)
    setLinkSaving(null)
  }

  // Drop zone for the relink modal itself — mirrors handleNewMediaDragOver/
  // DragLeave/Drop below (the Add Media flow's own drop zone) so both
  // linking a new file and relinking an existing one feel the same.
  function handleRelinkDragOver(e) {
    e.preventDefault()
    if (!isDraggingRelink) setIsDraggingRelink(true)
  }
  function handleRelinkDragLeave(e) {
    e.preventDefault()
    setIsDraggingRelink(false)
  }
  function handleRelinkDrop(e) {
    e.preventDefault()
    setIsDraggingRelink(false)
    const file = e.dataTransfer?.files?.[0]
    const filePath = file ? api.getPathForFile(file) : null
    if (filePath && relinkTarget) {
      setRelinkTarget(null)
      handleDropLink(relinkTarget.id, filePath)
    }
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

  function basenameFromPath(filePath) {
    const parts = String(filePath).split(/[\\/]/)
    return parts[parts.length - 1] || filePath
  }

  async function handleAddEncounterWithMedia() {
    // No name-typing step anymore — the encounter starts with a placeholder,
    // immediately opens straight into picking a video, and both the
    // encounter name and media name get set to the video's own filename once
    // it's actually chosen. Mirrors the same placeholder-then-rename pattern
    // already used for media files below.
    const result = await api.createEncounter(projectId, 'New Encounter')
    await refreshEncounterData()
    if (result?.id) {
      setExpanded(e => ({ ...e, [result.id]: true }))
      setNewMediaTarget({ id: result.id, name: 'New Encounter' })
    }
  }

  async function finalizeNewMediaLink(mediaId, filePath, currentName, encounterId, encounterName) {
    if (!filePath) return
    await api.setMediaLink(mediaId, projectId, filePath)
    const linkedName = basenameFromPath(filePath)
    if (linkedName && linkedName !== currentName) {
      await api.renameMediaFile(projectId, mediaId, linkedName)
    }
    // The encounter itself also takes the video's name now, matching the
    // media name exactly — only when it's still carrying the placeholder, so
    // this never clobbers a name someone already set deliberately.
    if (linkedName && encounterId && encounterName === 'New Encounter') {
      await api.renameEncounter(projectId, encounterId, linkedName)
    }
    await refreshEncounterData()
    showToast('Video linked.')
  }

  async function handleCreateMediaFile() {
    if (!newMediaTarget?.id) return
    const encounterId = newMediaTarget.id
    const encounterName = newMediaTarget.name
    // Placeholder name only — immediately overwritten by the real filename
    // once a file is picked below. If the file dialog is canceled, this is
    // what's left; still renameable manually afterward like any media file.
    const placeholderName = 'New Media'
    const created = await api.createMediaFile(projectId, encounterId, placeholderName)

    // Projects with only one media type (e.g. the UCAT/SDMo templates) don't
    // need someone to manually pick it — reuses the existing, already-safe
    // handleChangeMediaType (it no-ops correctly for a brand-new file with no
    // reviews yet, so this never triggers the "reassign type" confirmation).
    if (created?.id && mediaTypes.length === 1) {
      await handleChangeMediaType({ id: created.id, media_type_id: null, reviews: [] }, mediaTypes[0].id)
    }

    setExpanded(e => ({ ...e, [encounterId]: true }))
    setNewMediaTarget(null)
    await refreshEncounterData()
    showToast('Media added.')

    // Streamlined flow, continued: immediately move into picking the actual
    // video file for this media slot — its filename becomes the media name
    // automatically (still editable afterward via the existing rename option).
    if (created?.id) {
      const filePath = await api.browseMediaFile(created.id)
      await finalizeNewMediaLink(created.id, filePath, placeholderName, encounterId, encounterName)
    }
  }

  function handleNewMediaDragOver(e) {
    e.preventDefault()
    if (!isDraggingNewMedia) setIsDraggingNewMedia(true)
  }

  function handleNewMediaDragLeave(e) {
    e.preventDefault()
    setIsDraggingNewMedia(false)
  }

  function handleNewMediaDrop(e) {
    e.preventDefault()
    setIsDraggingNewMedia(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    const filePath = api.getPathForFile(file)
    if (filePath) handleDropNewMediaFile(filePath)
  }

  async function handleDropNewMediaFile(filePath) {
    if (!newMediaTarget?.id || !filePath) return
    const encounterId = newMediaTarget.id
    const encounterName = newMediaTarget.name
    // The dropped file's own name becomes the media name directly — no
    // placeholder needed here since the real filename is already known.
    const name = basenameFromPath(filePath)
    const created = await api.createMediaFile(projectId, encounterId, name)
    if (created?.id && mediaTypes.length === 1) {
      await handleChangeMediaType({ id: created.id, media_type_id: null, reviews: [] }, mediaTypes[0].id)
    }
    setExpanded(e => ({ ...e, [encounterId]: true }))
    setNewMediaTarget(null)
    await refreshEncounterData()
    showToast('Media added.')
    if (created?.id) await finalizeNewMediaLink(created.id, filePath, name, encounterId, encounterName)
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

  function addShareRecipient() {
    setShareRecipients(list => [...list, { name: '', role: 'reviewer' }])
  }

  function removeShareRecipient(index) {
    setShareRecipients(list => list.length <= 1 ? list : list.filter((_, i) => i !== index))
  }

  function updateShareRecipient(index, changes) {
    setShareRecipients(list => list.map((r, i) => i === index ? { ...r, ...changes } : r))
  }

  function resetShareModal() {
    setShowShareModal(false)
    setShareClearReviews(false)
    setShareRecipients([{ name: '', role: 'reviewer' }])
  }

  async function handleSaveFile() {
    const roster = shareRecipients
      .map(r => ({ name: r.name.trim(), role: r.role }))
      .filter(r => r.name)
    if (roster.length === 0) return
    setSharing(true)
    try {
      const p = await api.saveProjectFile(projectId, {
        clearReviews: shareClearReviews,
        roster,
      })
      if (p) {
        const clearedNote = shareClearReviews ? ' Reviews cleared from this copy, your own stay intact.' : ''
        showToast(`File saved — share it with everyone on the list; each person picks their own name on import.${clearedNote}`)
        resetShareModal()
      }
    } finally {
      setSharing(false)
    }
  }

  async function handleExportResultsJson() {
    setShowExportMenu(false)
    const p = await api.exportResults(projectId)
    if (p) showToast('Results exported as JSON.')
  }

  async function handleExportResultsCsv() {
    setShowExportMenu(false)
    const p = await api.exportResultsCsv(projectId)
    if (p) showToast('Results exported as CSV.')
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
          <span className="text-secondary text-sm">EnIAC</span>
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
          <button className="btn btn-ghost btn-sm" onClick={() => setShowShareModal(true)} title="Save project file to share with teammates">
            <Share2 size={13} /> Share Project
          </button>
          <div ref={exportMenuRef} style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowExportMenu(s => !s)}
              title="Export your coding results — JSON to share with another EnIAC install, or CSV for statistical software"
            >
              <Upload size={13} /> Export Results <ChevronDown size={11} />
            </button>
            {showExportMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 240,
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: 'var(--shadow-md)', padding: 6, zIndex: 1000,
              }}>
                <button
                  onClick={handleExportResultsJson}
                  style={{
                    width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 6,
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Export JSON</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>For importing into another EnIAC install</span>
                </button>
                <button
                  onClick={handleExportResultsCsv}
                  style={{
                    width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 6,
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Export CSV</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>For R, SPSS, Stata, or other statistical software</span>
                </button>
              </div>
            )}
          </div>
          {!isReviewer && (
            <button className="btn btn-ghost btn-sm" onClick={handleImportResults} title="Import another coder's exported results for comparison">
              <Download size={13} /> Import Results
            </button>
          )}
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
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid var(--warning)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--warning)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          No internet — working in local mode. Retrying every 5 minutes.
        </div>
      )}
      {syncError && (
        <div style={{ background: 'var(--danger-light)', borderBottom: '1px solid var(--danger)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--danger)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Sync failed: {syncError}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => setSyncError(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {syncStatus.syncMode === 'local' && syncStatus.syncFolderExists === false && (
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid var(--warning)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--warning)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Sync folder not found — check the path in <button className="btn btn-ghost btn-sm" style={{ color: 'var(--warning)', textDecoration: 'underline', padding: '0 4px' }} onClick={() => navigate(`/project/${projectId}/setup?section=${SETUP_SECTIONS.SYNC}`)}>Setup → Sync</button>
        </div>
      )}
      {syncStatus.syncMode === 'cloud' && syncStatus.tokenExpired && (
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid var(--warning)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--warning)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Cloud connection expired — reconnect in <button className="btn btn-ghost btn-sm" style={{ color: 'var(--warning)', textDecoration: 'underline', padding: '0 4px' }} onClick={() => navigate(`/project/${projectId}/setup?section=${SETUP_SECTIONS.SYNC}`)}>Setup → Sync</button>
        </div>
      )}
      {googleDriveAccessIds.length > 0 && (
        <div style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>New Google Drive review files need access before EnIAC can import them.</span>
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
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid var(--warning)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--warning)', flexWrap: 'wrap' }}>
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
        <div style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent)' }}>
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

            {/* Agreement and Alignment — previously nested as parent/subtab
                since there were two related subtabs to group; now flat,
                independent nav items since Agreement Between Results was
                removed and only one would remain nested. Hidden entirely
                for Reviewers. */}
            {!isReviewer && (
              <>
                <button onClick={() => setActivePage('reliability')}
                  className="btn btn-ghost btn-sm"
                  style={{
                    justifyContent: 'flex-start', width: '100%',
                    fontWeight: activePage === 'reliability' ? 600 : 400,
                    color: activePage === 'reliability' ? 'var(--text)' : 'var(--text-secondary)',
                    background: activePage === 'reliability' ? 'var(--bg-hover, rgba(0,0,0,0.06))' : 'transparent',
                  }}>
                  <Gauge size={13} />
                  Agreement
                </button>
                <button onClick={() => setActivePage('dataviz')}
                  className="btn btn-ghost btn-sm"
                  style={{
                    justifyContent: 'flex-start', width: '100%',
                    fontWeight: activePage === 'dataviz' ? 600 : 400,
                    color: activePage === 'dataviz' ? 'var(--text)' : 'var(--text-secondary)',
                    background: activePage === 'dataviz' ? 'var(--bg-hover, rgba(0,0,0,0.06))' : 'transparent',
                  }}>
                  <LineChart size={13} />
                  Alignment
                </button>
              </>
            )}
          </div>

          {/* Bottom: Settings — hidden for Reviewers */}
          <div style={{ marginTop: 'auto', padding: '8px 6px', borderTop: '1px solid var(--border)' }}>
            {!isReviewer && (
              <button onClick={() => navigate(`/project/${projectId}/setup`)}
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start', width: '100%' }}>
                <Settings size={13} />
                Settings
              </button>
            )}
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>

          {/* Media health warning — shown on all views */}
          {mediaHealth && (mediaHealth.unlinked + mediaHealth.broken) > 0 && (
            <div id="tut-proj-health" style={{ background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span style={{ color: 'var(--warning)', flex: 1 }}>
                {mediaHealth.unlinked + mediaHealth.broken} of {mediaHealth.total} media file{mediaHealth.total !== 1 ? 's' : ''} {mediaHealth.broken > 0 && mediaHealth.unlinked > 0 ? 'are not linked or missing' : mediaHealth.broken > 0 ? 'cannot be found on disk' : 'are not linked on this machine'}.
                {!mediaHealth.hasBaseFolder ? ' Set a base folder in Settings → Media Folder.' : ' Go to Settings → Media Folder to auto-link or manually relink files.'}
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
                  <button className="btn btn-primary btn-sm" onClick={handleAddEncounterWithMedia}>
                    <Plus size={13} /> Add Encounter
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleOpenScanModal} disabled={scanningFolder}>
                    <FolderDown size={13} />
                    Scan Folder
                  </button>
                  <div style={{ position: 'relative' }}>
                    <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input placeholder="Search encounters…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 28, width: 200, height: 32, fontSize: 13 }} />
                    {search && <button style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => setSearch('')}><X size={12} color="var(--text-muted)" /></button>}
                  </div>
                </div>
              </div>
              {filtered.length === 0 ? (
                <div className="empty-state">
                  <FolderOpenIcon />
                  <p>No encounters found</p>
                  {encounters.length === 0 && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={handleAddEncounterWithMedia}>
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
                      <EncounterRow key={enc.id} encounter={enc} expanded={!!expanded[enc.id]} onToggle={() => toggle(enc.id)} mediaTypes={mediaTypes} onRenameEncounter={() => { setRenameEncounterTarget(enc); setRenameInput(enc.name || '') }} onDeleteEncounter={() => setDeleteEncounterTarget(enc)} onRenameMedia={(mf) => { setRenameMediaTarget(mf); setRenameInput(mf.name || '') }} onAddMedia={() => setNewMediaTarget(enc)} onChangeMediaType={handleChangeMediaType} onAddReview={(mf) => setNewReview({ mediaFile: mf })} onOpenReview={(reviewId) => navigate(`/review/${reviewId}`)} onDeleteReview={(r) => setDeleteReviewTarget(r)} onDeleteMedia={(mf) => setDeleteMediaTarget(mf)} onManualLink={handleManualLink} onDropLink={handleDropLink} onOpenRelink={(mf) => setRelinkTarget(mf)} onClearLink={handleClearLink} linkSaving={linkSaving} />
                    ))}
                  </div>
                  <Pagination currentPage={currentPage} totalPages={Math.ceil(filtered.length / PAGE_SIZE)} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
                </>
              )}
            </>
          )}

          {/* ── PROGRESS ── */}
          {activePage === 'progress' && <ProgressView encounters={encounters} mediaTypes={mediaTypes} projectId={projectId} />}

          {/* ── DATA VISUALIZATION ── */}
          {!isReviewer && activePage === 'dataviz' && <DataVizView projectId={projectId} mediaTypes={mediaTypes} />}
          {!isReviewer && activePage === 'reliability' && <QuestionReliabilityView projectId={projectId} showToast={showToast} />}

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
        open={!!deleteMediaTarget}
        onClose={() => setDeleteMediaTarget(null)}
        title="Delete Media File"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteMediaTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDeleteMedia}>Delete</button>
          </>
        }
      >
        <p>Delete <strong>{deleteMediaTarget?.name}</strong>? All reviews, timestamps, and form responses for this media file will be permanently removed.</p>
      </Modal>

      <Modal
        open={!!deleteEncounterTarget}
        onClose={() => setDeleteEncounterTarget(null)}
        title="Delete Encounter"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteEncounterTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDeleteEncounter}>Delete</button>
          </>
        }
      >
        <p>Delete <strong>{deleteEncounterTarget?.name}</strong>? All media files, reviews, timestamps, and form responses for this encounter will be permanently removed.</p>
      </Modal>

      <Modal
        open={showShareModal}
        onClose={resetShareModal}
        title="Share Project"
        footer={
          <>
            <button className="btn btn-secondary" onClick={resetShareModal}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleSaveFile}
              disabled={sharing || shareRecipients.every(r => !r.name.trim())}
            >
              {sharing ? 'Saving…' : 'Save File'}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This saves the project to a single file you can send to everyone on your list — each
          person picks their own name from it when they import, which sets their role automatically.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {shareRecipients.map((recipient, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="form-field" style={{ flex: 1, marginBottom: 0 }}>
                {i === 0 && <label>Name</label>}
                <input
                  placeholder="e.g. Alice Chen"
                  value={recipient.name}
                  onChange={e => updateShareRecipient(i, { name: e.target.value })}
                />
              </div>
              <div className="form-field" style={{ width: 130, marginBottom: 0 }}>
                {i === 0 && <label>Role</label>}
                <select value={recipient.role} onChange={e => updateShareRecipient(i, { role: e.target.value })}>
                  <option value="reviewer">Reviewer</option>
                  <option value="leader">Leader</option>
                </select>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => removeShareRecipient(i)}
                disabled={shareRecipients.length <= 1}
                title="Remove"
                style={{ flexShrink: 0 }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={addShareRecipient} style={{ marginBottom: 14 }}>
          <Plus size={13} /> Add Person
        </button>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
          Reviewers won't see Settings, Agreement/Alignment, or Import Results on their copy of this project.
          Leaders have full access, same as you.
        </p>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={shareClearReviews}
            onChange={e => setShareClearReviews(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Clear all reviews from this copy</strong>
            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
              Recommended when sending to someone who shouldn't see prior answers before reviewing themselves.
              Only affects this exported file — your own reviews stay exactly as they are.
            </span>
          </span>
        </label>
      </Modal>

      <Modal
        open={!!newMediaTarget}
        onClose={() => setNewMediaTarget(null)}
        title="Add Media"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setNewMediaTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreateMediaFile}>
              Choose Video File…
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Add a media slot under <strong>{newMediaTarget?.name}</strong> — drag a video file in
            below, or click "Choose Video File…" to browse for one. Its filename becomes the media
            name automatically; you can rename it afterward if you'd like.
          </p>
          <div
            onDragOver={handleNewMediaDragOver}
            onDragLeave={handleNewMediaDragLeave}
            onDrop={handleNewMediaDrop}
            style={{
              border: isDraggingNewMedia ? '2px dashed var(--accent)' : '2px dashed var(--border)',
              borderRadius: 8, padding: '28px 12px', textAlign: 'center',
              background: isDraggingNewMedia ? 'rgba(59,130,246,0.06)' : 'var(--bg-secondary)',
              transition: 'border-color 0.15s ease, background 0.15s ease',
              fontSize: 13, color: 'var(--text-muted)',
            }}
          >
            {isDraggingNewMedia ? 'Drop the video file to add it' : 'Drag and drop a video file here'}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!relinkTarget}
        onClose={() => setRelinkTarget(null)}
        title="Relink Media"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRelinkTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => { const id = relinkTarget?.id; setRelinkTarget(null); handleManualLink(id) }}>
              Choose File…
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Relink <strong>{relinkTarget?.name}</strong> — drag the actual video file in below, or click
            "Choose File…" to browse for it.
          </p>
          <div
            onDragOver={handleRelinkDragOver}
            onDragLeave={handleRelinkDragLeave}
            onDrop={handleRelinkDrop}
            style={{
              border: isDraggingRelink ? '2px dashed var(--accent)' : '2px dashed var(--border)',
              borderRadius: 8, padding: '28px 12px', textAlign: 'center',
              background: isDraggingRelink ? 'rgba(59,130,246,0.06)' : 'var(--bg-secondary)',
              transition: 'border-color 0.15s ease, background 0.15s ease',
              fontSize: 13, color: 'var(--text-muted)',
            }}
          >
            {isDraggingRelink ? 'Drop the video file to relink it' : 'Drag and drop a video file here'}
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
          <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--danger)' }}>
            {scanResult.error}
          </div>
        ) : (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span><strong>{scanResult.encountersAdded || 0}</strong> encounter{scanResult.encountersAdded === 1 ? '' : 's'} added</span>
            <span><strong>{scanResult.encountersLinked || 0}</strong> existing encounter{scanResult.encountersLinked === 1 ? '' : 's'} matched to folders</span>
            <span><strong>{scanResult.filesAdded || 0}</strong> media file{scanResult.filesAdded === 1 ? '' : 's'} added</span>
            <span><strong>{scanResult.filesLinked || 0}</strong> existing media file{scanResult.filesLinked === 1 ? '' : 's'} linked</span>
            {scanResult.directMediaFiles > 0 && (
              <span style={{ color: 'var(--warning)' }}>{scanResult.directMediaFiles} media file{scanResult.directMediaFiles === 1 ? '' : 's'} were in the top folder. Put files inside encounter subfolders to import them.</span>
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
          <div style={{ display: 'flex', gap: 10, padding: '10px 12px', border: '1px solid var(--warning)', background: 'var(--warning-light)', borderRadius: 8 }}>
            <AlertTriangle size={18} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: 'var(--warning)', lineHeight: 1.55 }}>
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

function EncounterRow({ encounter, expanded, onToggle, mediaTypes, onRenameEncounter, onDeleteEncounter, onRenameMedia, onAddMedia, onChangeMediaType, onAddReview, onOpenReview, onDeleteReview, onDeleteMedia, onManualLink, onDropLink, onOpenRelink, onClearLink, linkSaving }) {
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
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title="Delete encounter"
            style={{ width: 22, height: 22, padding: 0, color: 'var(--danger)' }}
            onClick={e => { e.stopPropagation(); onDeleteEncounter() }}
          >
            <X size={13} />
          </button>
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
              onDeleteMedia={onDeleteMedia}
              onManualLink={onManualLink}
              onDropLink={onDropLink}
              onOpenRelink={onOpenRelink}
              onClearLink={onClearLink}
              onChangeMediaType={onChangeMediaType}
              onRename={() => onRenameMedia(mf)}
              linkSaving={linkSaving}
              isFirst={idx === 0}
              canDelete={(encounter.media || []).length > 1}
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
  if (status === 'missing') return <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--danger)', background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 3, padding: '1px 5px' }}>File missing</span>
  if (status === 'not_applicable') return <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>N/A</span>
  return <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--warning)', background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 3, padding: '1px 5px' }}>Not linked</span>
}

function reopenedReasonLabel(reason) {
  if (reason === 'form_version_changed') return 'Reopened after form update'
  if (reason === 'media_type_version_changed') return 'Reopened after media type update'
  return 'Reopened'
}

function MediaRow({ mediaFile, mediaTypes, onAddReview, onOpenReview, onDeleteReview, onDeleteMedia, onManualLink, onDropLink, onOpenRelink, onClearLink, onChangeMediaType, onRename, linkSaving, isFirst, canDelete }) {
  const Icon = MEDIA_ICONS[mediaFile.file_type] || File
  const required = mediaFile.reviews_required
  const completed = mediaFile.reviews_completed || 0
  const mediaType = mediaTypes.find(t => t.id === mediaFile.media_type_id)
  const status = mediaFile.link_status
  const busy = linkSaving === mediaFile.id
  const [isDragOver, setIsDragOver] = useState(false)
  // Only rows where a link action is already available accept drops —
  // matches which rows show a Link/Relink button in the first place.
  const acceptsDrop = status !== 'not_applicable'

  function handleDragOver(e) {
    if (!acceptsDrop) return
    e.preventDefault()
    setIsDragOver(true)
  }
  function handleDragLeave() {
    setIsDragOver(false)
  }
  function handleDrop(e) {
    if (!acceptsDrop) return
    e.preventDefault()
    setIsDragOver(false)
    // api.getPathForFile wraps Electron's webUtils.getPathForFile — the
    // dropped File object's non-standard .path property was removed in
    // recent Electron versions, so this is the only reliable way to get a
    // dropped file's real local path. Matches the same mechanism the
    // Add Media drop zone already uses.
    const file = e.dataTransfer.files?.[0]
    const filePath = file ? api.getPathForFile(file) : null
    if (filePath) onDropLink(mediaFile.id, filePath)
  }

  return (
    <div
      id={isFirst ? 'tut-proj-mediarow' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        padding: '12px 20px 12px 40px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 8,
        background: isDragOver ? 'var(--accent-light)' : 'transparent',
        outline: isDragOver ? '2px dashed var(--accent)' : 'none',
        outlineOffset: -2,
        transition: 'background 0.1s, outline 0.1s',
      }}
    >
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
          {isDragOver && (
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Drop to relink</span>
          )}
          {/* 'linked' and 'missing' both show "Relink" — re-establishing a
              link either proactively or because it broke is the same action
              from here, so there's no separate "Locate" label anymore. Only
              a never-linked file still says "Link", a genuinely different
              first-time action. Both now open the relink modal (drop zone +
              Choose File…) rather than jumping straight to the native
              picker, matching Add Media's pattern. */}
          {(status === 'linked' || status === 'missing') && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22, flexShrink: 0 }}
              onClick={() => onOpenRelink(mediaFile)} disabled={busy}>
              {busy ? '…' : 'Relink'}
            </button>
          )}
          {status !== 'linked' && status !== 'missing' && status !== 'not_applicable' && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px', height: 22, flexShrink: 0 }}
              onClick={() => onOpenRelink(mediaFile)} disabled={busy}>
              {busy ? '…' : 'Link'}
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
                <span title={reopenedReasonLabel(r.reopened_reason)} style={{ fontSize: 9, fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 3, padding: '0 4px' }}>
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
        {canDelete && (
          <button
            className="btn btn-ghost btn-icon btn-sm"
            style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            title="Delete this media file"
            onClick={() => onDeleteMedia({ id: mediaFile.id, name: mediaFile.name })}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Progress View ─────────────────────────────────────────────────────────────
function ProgressView({ encounters, mediaTypes, projectId }) {
  const [importedSources, setImportedSources] = useState([])

  useEffect(() => {
    if (!projectId) return
    let active = true
    api.getResultsComparisonData(projectId).then(data => {
      if (active) setImportedSources(Array.isArray(data?.imported) ? data.imported : [])
    }).catch(() => { if (active) setImportedSources([]) })
    return () => { active = false }
  }, [projectId])

  const allMedia = encounters.flatMap(e => (e.media || []))
  const allReviews = allMedia.flatMap(m => (m.reviews || []))
  const submitted = allReviews.filter(r => r.status === 'submitted')
  const totalEnc = encounters.length
  const completeEnc = encounters.filter(e => e.completed).length

  // Unified "who finished which media file" picture, combining this
  // project's own submitted reviews with everyone's imported results —
  // e.g. Eva's imported file shows she finished 2 of 3 videos even though
  // she has no review row in this project's own database at all. Keyed by
  // reviewer name + media name (not media file id, since imported rows only
  // ever carry a name — matches how every other cross-install matching in
  // this app already works) and deduplicated, so someone who shows up in
  // BOTH this project's reviews and an imported file for the same media
  // file is counted once, not twice.
  const completionSet = new Map() // `${reviewerName}::${mediaName}` -> true
  for (const media of allMedia) {
    for (const review of (media.reviews || [])) {
      if (review.status !== 'submitted') continue
      completionSet.set(`${review.reviewer_name || 'Unknown'}::${media.name}`, true)
    }
  }
  for (const source of importedSources) {
    for (const row of (source.responses_long || [])) {
      const reviewerName = row.reviewer_name || source.reviewer_name || 'Unknown'
      completionSet.set(`${reviewerName}::${row.media_name}`, true)
    }
  }
  // Precomputed once here rather than re-scanning the full completionSet for
  // every media file in the per-encounter render loop below.
  const completionCountByMediaName = new Map()
  for (const key of completionSet.keys()) {
    const mediaName = key.slice(key.indexOf('::') + 2)
    completionCountByMediaName.set(mediaName, (completionCountByMediaName.get(mediaName) || 0) + 1)
  }

  // Per-reviewer stats — imported completions have no "in progress" concept
  // (an imported results file only ever contains finished, submitted work),
  // so they only ever add to `submitted`, never inflate `total` beyond what
  // was actually completed.
  const reviewerMap = {}
  for (const r of allReviews) {
    const name = r.reviewer_name || 'Unknown'
    if (!reviewerMap[name]) reviewerMap[name] = { total: 0, submitted: 0 }
    reviewerMap[name].total++
    if (r.status === 'submitted') reviewerMap[name].submitted++
  }
  for (const source of importedSources) {
    const seenMediaForSource = new Set()
    for (const row of (source.responses_long || [])) {
      const reviewerName = row.reviewer_name || source.reviewer_name || 'Unknown'
      if (!reviewerMap[reviewerName]) reviewerMap[reviewerName] = { total: 0, submitted: 0 }
      // One imported source can have multiple form_responses rows for the
      // same media file (multi-form or multi-instance) — count each
      // completed media file once per reviewer, not once per row.
      const key = `${reviewerName}::${row.media_name}`
      if (seenMediaForSource.has(key)) continue
      seenMediaForSource.add(key)
      reviewerMap[reviewerName].total++
      reviewerMap[reviewerName].submitted++
    }
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

  // Total distinct (reviewer, media file) completions across BOTH sources,
  // deduplicated — this is the number that actually reflects imported
  // progress; allReviews/submitted above stay as this project's own
  // well-defined metric, so the two aren't conflated into one number that
  // means something different depending on whether imports exist.
  const totalCompletedIncludingImported = completionSet.size

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Progress</h1>
      <p className="text-secondary text-sm" style={{ marginBottom: 28 }}>
        Completion overview across all encounters and reviewers, including anyone whose results were imported.
      </p>

      {/* Top stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        <Stat label="Encounters Complete" value={`${completeEnc}/${totalEnc}`} sub={totalEnc > 0 ? `${Math.round(completeEnc / totalEnc * 100)}%` : '—'} />
        <Stat label="Reviews Submitted" value={submitted.length} sub={`of ${allReviews.length} total`} />
        <Stat label="Active Reviewers" value={reviewers.length} />
        {importedSources.length > 0 && (
          <Stat
            label="Total Completed (incl. imported)"
            value={totalCompletedIncludingImported}
            sub={`${importedSources.length} imported file${importedSources.length === 1 ? '' : 's'}`}
          />
        )}
      </div>

      {/* Overall progress bar */}
      {allReviews.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            <span>Project Completion</span>
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
              // done/total now come from the unified completionSet rather
              // than each media file's own reviews_completed field, which
              // only ever reflects this project's own reviews table — this
              // is what actually pulls imported completions into the
              // per-encounter bars below, not just the top-level stats.
              const total = (enc.media || []).reduce((s, m) => s + (m.reviews_required || 1), 0)
              const done = (enc.media || []).reduce((s, m) => {
                const completedFor = completionCountByMediaName.get(m.name) || 0
                return s + Math.min(completedFor, m.reviews_required || 1)
              }, 0)
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

  // Imported cross-file rows carry a plain media_type_name string instead of
  // any local id or sync_id — match directly by name (e.g. lines up an
  // imported "UCAT" row with this project's own "UCAT" media type).
  if (review?.media_type_name) {
    const byDirectName = mediaTypes.find(type => type.name === review.media_type_name)
    if (byDirectName) return mediaTypeOptionId(byDirectName.id)
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

// Formats a single reviewer's raw answer for display in the answers table
// below each question — handles the value shapes that actually occur across
// question types (dial/vertical_slider arrays, likert_group objects,
// multiselect arrays, plain scalars) without needing per-type branching at
// every call site.
function formatRawAnswerValue(value, rowLabelById = null, arrayLabels = null) {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    // Label each position when the question provides one (e.g. a dial's
    // control_labels) — otherwise a multi-value answer like [1, 2] is
    // meaningless without knowing which number is which distinction.
    // Mirrors how the object branch below already labels sub-items via
    // rowLabelById; arrays previously had no equivalent at all.
    return value.map((v, i) => {
      const label = Array.isArray(arrayLabels) ? arrayLabels[i] : null
      const formatted = formatRawAnswerValue(v, rowLabelById, arrayLabels)
      return label ? `${label}: ${formatted}` : formatted
    }).join(arrayLabels ? '\n' : ', ')
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([k]) => k !== '__na')
    if (entries.length === 0) return '—'
    return entries.map(([k, v]) => `${(rowLabelById && rowLabelById.get(k)) || k}: ${formatRawAnswerValue(v, rowLabelById, arrayLabels)}`).join(', ')
  }
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return String(value)
}

// One question's summary line, with a collapsed-by-default table underneath
// showing exactly what each individual reviewer answered — used by
// Alignment.
function QuestionAgreementRow({ question, rowKey, methodExtra }) {
  // Schema-driven, not hardcoded to specific labels/forms — a question opts
  // into starting expanded via default_expanded on its element (e.g. UCAT's
  // Global Measures and final question), same pattern as agreement_enabled/
  // guide_reverse elsewhere in this schema. Most questions have no such flag
  // and default to collapsed, unchanged from before.
  const [expanded, setExpanded] = useState(!!question.meta?.default_expanded)
  const hasAnswers = Array.isArray(question.rawAnswers) && question.rawAnswers.length > 0
  // likert_group answers are objects keyed by row element ID — translate
  // those into their actual row labels rather than showing raw IDs.
  const rowLabelById = useMemo(() => {
    const items = question.meta?.items
    if (!Array.isArray(items)) return null
    return new Map(items.map(item => [String(item.id), item.label || item.id]))
  }, [question.meta])
  // Dial/vertical_slider answers are arrays with no inherent labels of their
  // own — SDMo's distinction dials, for example, are [1, 2] with no way to
  // tell which number is "Problematic Situations" vs "Endeavor to Improve"
  // without this. control_labels is the schema field that names each
  // position; falls back to null (unlabeled) when a question has no such
  // field, e.g. non-dial arrays like multiselect.
  const arrayLabels = Array.isArray(question.meta?.control_labels) ? question.meta.control_labels : null
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => hasAnswers && setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          width: '100%', padding: '6px 8px', fontSize: 12, background: 'transparent', border: 'none',
          cursor: hasAnswers ? 'pointer' : 'default', textAlign: 'left', font: 'inherit',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {hasAnswers && (expanded ? <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} /> : <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />)}
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }} className="truncate">{question.label}</span>
        </span>
        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {AGREEMENT_METHOD_LABELS[question.method] || question.type}{methodExtra ? ` · ${methodExtra(question)}` : ''} · {Math.round((question.agreement || 0) * 100)}%
        </span>
      </button>
      {expanded && hasAnswers && (
        <div style={{ padding: '0 8px 8px', overflowX: 'auto' }}>
          {rowLabelById ? (
            // Matrix layout: one row per sub-item, one column per reviewer.
            // Lets you scan straight across a single sub-item to see whether
            // everyone agreed on THAT one thing — the actual question this
            // table exists to answer — rather than hunting through a long
            // comma-joined line per reviewer.
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px', borderBottom: '1px solid var(--border)', minWidth: 160, maxWidth: 280 }}>Item</th>
                  {question.rawAnswers.map((a, i) => (
                    <th key={`${rowKey}-head-${a.reviewerName}-${i}`} style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {a.reviewerName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(rowLabelById.entries()).map(([itemId, itemLabel]) => {
                  const disagreement = new Set(question.rawAnswers.map(a => JSON.stringify((a.value || {})[itemId] ?? null))).size > 1
                  return (
                    <tr key={`${rowKey}-item-${itemId}`}>
                      <td style={{ padding: '4px 6px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', maxWidth: 280, overflowWrap: 'break-word' }}>{itemLabel}</td>
                      {question.rawAnswers.map((a, i) => (
                        <td key={`${rowKey}-cell-${itemId}-${i}`} style={{
                          padding: '4px 6px', borderBottom: '1px solid var(--border)',
                          color: disagreement ? 'var(--danger)' : 'var(--text)',
                          fontWeight: disagreement ? 600 : 400,
                        }}>
                          {formatRawAnswerValue((a.value || {})[itemId])}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            // Simple two-column layout for single-value questions — already
            // clear as-is, no matrix needed for one value per reviewer.
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>Reviewer</th>
                  <th style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>Answer</th>
                </tr>
              </thead>
              <tbody>
                {question.rawAnswers.map((a, i) => (
                  <tr key={`${rowKey}-${a.reviewerName}-${i}`}>
                    <td style={{ padding: '4px 6px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>{a.reviewerName}</td>
                    <td style={{ padding: '4px 6px', color: 'var(--text)', borderBottom: '1px solid var(--border)', whiteSpace: 'pre-line' }}>{formatRawAnswerValue(a.value, rowLabelById, arrayLabels)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Alignment View (formerly "Data Visualization") ─────────────────────────────
function DataVizView({ projectId, mediaTypes = [] }) {
  const [agreementRows, setAgreementRows] = useState([])
  const [rawReviews, setRawReviews] = useState([])
  const [importedSources, setImportedSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMediaTypeId, setSelectedMediaTypeId] = useState('')
  const [agreementMode, setAgreementMode] = useState('question')
  const [selectedSectionIds, setSelectedSectionIds] = useState([])
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([])
  // 'form_order' (default) shows questions in the order they appear on the
  // form itself; 'agreement_desc' shows the lowest-agreement questions last,
  // highest first — useful for scanning straight to the weakest questions.
  const [questionSortMode, setQuestionSortMode] = useState('form_order')

  // Sections and Questions are two independent multi-selects that combine
  // by union (see the effectiveQuestionIds effect below) — by design, so you
  // can build up e.g. "all of Section 3, plus this one question from Section
  // 5". But picking an individual question that belongs to an ALREADY
  // selected section is a different intent: narrowing from "the whole
  // section" down to "just this one question" — the union would otherwise
  // silently keep showing every question in that section, since the section
  // selection already covers it and there's no way to subtract from within
  // a section any other way. So: whenever a question is newly checked,
  // drop its parent section from the section filter if it was selected.
  function handleQuestionIdsChange(nextQuestionIds) {
    const newlyAdded = nextQuestionIds.filter(id => !selectedQuestionIds.includes(id))
    if (newlyAdded.length > 0) {
      const sectionIdsToRemove = new Set(
        newlyAdded
          .map(id => questionOptions.questions.find(q => q.id === id)?.sectionId)
          .filter(Boolean)
      )
      if (sectionIdsToRemove.size > 0) {
        setSelectedSectionIds(ids => ids.filter(id => !sectionIdsToRemove.has(id)))
      }
    }
    setSelectedQuestionIds(nextQuestionIds)
  }

  useEffect(() => {
    if (!projectId) return
    let active = true
    async function load() {
      setLoading(true)
      try {
        const [raw, comparisonData] = await Promise.all([
          api.getProjectInterraterAgreementData(projectId),
          api.getResultsComparisonData(projectId),
        ])
        if (!active) return
        setRawReviews(raw || [])
        setImportedSources(comparisonData?.imported || [])
      } catch {
        setRawReviews([])
        setImportedSources([])
        setAgreementRows([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [projectId])

  // Imported results have no local review row at all — synthesize
  // review-shaped objects from them (one per person per media file) so they
  // can flow through the exact same grouping/filtering/agreement logic as
  // this project's own reviews below. Without this, Alignment could
  // only ever show something for projects with their own local reviews,
  // which isn't how importing-only workflows actually use this app.
  const importedPseudoReviews = useMemo(() => {
    const pseudo = []
    for (const source of importedSources) {
      const byMediaAndReviewer = new Map()
      for (const row of (source.responses_long || [])) {
        const key = `${row.media_name}||${row.reviewer_name || source.reviewer_name || source.source_name}`
        if (!byMediaAndReviewer.has(key)) {
          byMediaAndReviewer.set(key, {
            media_name: row.media_name,
            encounter_name: row.encounter_name,
            media_type_name: row.media_type_name || null,
            reviewer_name: row.reviewer_name || source.reviewer_name || source.source_name,
            form_responses: [],
          })
        }
        byMediaAndReviewer.get(key).form_responses.push({
          form_id: row.form_id,
          form_name: row.form_name,
          responses: row.responses,
          form_snapshot: row.form_snapshot,
          instance_key: row.instance_key,
          instance_role: row.instance_role,
          instance_order: row.instance_order,
        })
      }
      pseudo.push(...byMediaAndReviewer.values())
    }
    return pseudo
  }, [importedSources])

  const allReviews = useMemo(() => [...rawReviews, ...importedPseudoReviews], [rawReviews, importedPseudoReviews])

  const mediaTypesWithReviews = useMemo(() => {
    const byId = new Map()
    for (const type of mediaTypes || []) {
      byId.set(mediaTypeOptionId(type.id), { id: mediaTypeOptionId(type.id), name: type.name || 'Media type' })
    }
    for (const review of allReviews || []) {
      const id = agreementMediaTypeIdForReview(review, mediaTypes)
      if (!byId.has(id)) byId.set(id, { id, name: review.media_type_name || (id === 'untyped' ? 'Untyped' : 'Media type') })
    }
    const reviewedIds = new Set((allReviews || []).map(review => agreementMediaTypeIdForReview(review, mediaTypes)))
    return Array.from(byId.values()).filter(type => reviewedIds.has(String(type.id)))
  }, [mediaTypes, allReviews])

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
    return allReviews.filter(review => agreementMediaTypeIdForReview(review, mediaTypes) === String(selectedMediaTypeId))
  }, [mediaTypes, allReviews, selectedMediaTypeId])

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
      const key = review.media_name
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
      // Alignment shows agreement among everyone who rated a file
      // automatically, regardless of instance role (Trainee/Consultant) —
      // the shared engine's default is role-separated, so this explicitly
      // opts out of that split.
      poolAcrossRoles: true,
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
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Alignment</h1>
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
              onChange={handleQuestionIdsChange}
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
          <div style={{ fontSize: 12, color: finalQuestionCount > 0 ? 'var(--text-secondary)' : 'var(--warning)', background: finalQuestionCount > 0 ? 'var(--bg-secondary)' : 'var(--warning-light)', border: `1px solid ${finalQuestionCount > 0 ? 'var(--border)' : 'var(--warning)'}`, borderRadius: 8, padding: '8px 10px' }}>
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
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Order questions by:</span>
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                className="btn btn-sm"
                style={{ borderRadius: 0, background: questionSortMode === 'form_order' ? 'var(--accent)' : 'transparent', color: questionSortMode === 'form_order' ? '#fff' : 'var(--text)' }}
                onClick={() => setQuestionSortMode('form_order')}
              >
                Form order
              </button>
              <button
                className="btn btn-sm"
                style={{ borderRadius: 0, background: questionSortMode === 'agreement_desc' ? 'var(--accent)' : 'transparent', color: questionSortMode === 'agreement_desc' ? '#fff' : 'var(--text)' }}
                onClick={() => setQuestionSortMode('agreement_desc')}
              >
                Agreement, highest first
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {agreementRows.map(row => {
              const orderedQuestions = questionSortMode === 'agreement_desc'
                ? [...row.questions].sort((a, b) => (b.agreement || 0) - (a.agreement || 0))
                : row.questions
              return (
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
                {orderedQuestions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {orderedQuestions.map(question => (
                      <QuestionAgreementRow
                        key={`${row.mediaName}-${question.label}`}
                        rowKey={`${row.mediaName}-${question.label}`}
                        question={question}
                        methodExtra={q => `w${q.weight ?? 1}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comparable form questions were found for this video.</div>
                )}
              </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Agreement View (formerly "Question Reliability") ──────────────────────────
// Pools every submitted review's answer to each opted-in question ACROSS THE
// WHOLE PROJECT (not per media file) and computes one real ICC / Fleiss' kappa /
// weighted kappa per question — separate from the per-file percent agreement
// in DataVizView above, which is untouched by this.
const RELIABILITY_METHODS = new Set(['icc', 'cohen_kappa', 'weighted_kappa', 'percent', 'weighted_fleiss_kappa', 'numeric'])
// `table` questions nest a value per (row, column) — out of scope here.
// `likert_group` questions nest one scalar value per row (per item.id), which
// IS supported: each row is unpacked into its own pooled question below,
// since that's exactly how UCAT's per-dimension ICCs (Table 2 in the paper)
// are structured — one row per dimension inside a single likert_group.
const ROW_UNPACK_TYPES = new Set(['likert_group'])
// dial/vertical_slider with count > 1 (e.g. SDMo's "Evidence of Distinction
// Dials", count: 2) store one array of scalars per response, not an object
// keyed by row id — same "one pooled question per sub-item" idea as
// ROW_UNPACK_TYPES above, but indexed by array position instead of a row id.
const ARRAY_UNPACK_TYPES = new Set(['dial', 'vertical_slider'])
const UNSUPPORTED_COMPOSITE_TYPES = new Set(['table'])

const QUESTION_RELIABILITY_METHOD_LABELS = {
  icc: 'Intraclass correlation (ICC)',
  cohen_kappa: "Cohen's kappa",
  weighted_kappa: 'Weighted kappa',
  percent: 'Percent agreement',
  weighted_fleiss_kappa: "Weighted Fleiss' kappa",
}

// form_snapshot has taken a couple of different shapes across this codebase
// (bare {sections}, or {schema:{sections}}) — same defensive lookup used
// elsewhere for this reason.
function questionReliabilitySchemaSections(formSnapshot) {
  if (!formSnapshot) return []
  if (Array.isArray(formSnapshot?.sections)) return formSnapshot.sections
  if (Array.isArray(formSnapshot?.schema?.sections)) return formSnapshot.schema.sections
  return []
}

function QuestionReliabilityView({ projectId, showToast }) {
  const [loading, setLoading] = useState(true)
  const [rawReviews, setRawReviews] = useState([])
  const [currentForms, setCurrentForms] = useState([])
  const [importedSources, setImportedSources] = useState([])
  const [collapsedAnswerKeys, setCollapsedAnswerKeys] = useState(new Set())
  const [mismatchDismissed, setMismatchDismissed] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [data, forms, comparisonData] = await Promise.all([
        api.getProjectInterraterAgreementData(projectId),
        api.listForms(projectId),
        api.getResultsComparisonData(projectId),
      ])
      setRawReviews(Array.isArray(data) ? data : [])
      setCurrentForms(Array.isArray(forms) ? forms : [])
      setImportedSources(Array.isArray(comparisonData?.imported) ? comparisonData.imported : [])
    } catch {
      setRawReviews([])
      setCurrentForms([])
      setImportedSources([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleRemoveImportedSource(source) {
    if (!window.confirm(`Remove "${source.reviewer_name || source.source_name}"? This deletes the imported file from this project — the original .json is untouched on whoever produced it, so it can be re-imported later if needed.`)) return
    setRemovingId(source.id)
    try {
      await api.deleteImportedResult(source.id)
      showToast?.(`Removed "${source.reviewer_name || source.source_name}".`)
      await load()
    } catch {
      showToast?.('Could not remove that import.', true)
    } finally {
      setRemovingId(null)
    }
  }

  const { results: questions, mismatchWarnings } = useMemo(() => {
    // Only submitted reviews count toward reliability statistics — a
    // still-in-progress review isn't a completed rating yet.
    const submitted = rawReviews.filter(r => r.status === 'submitted')
    const currentFormNames = new Set(currentForms.map(f => f.name))
    const currentFormsByName = new Map(currentForms.map(f => [f.name, f]))
    const currentFormsById = new Map(currentForms.map(f => [String(f.id), f]))

    const questionMap = new Map()
    const warnings = []

    // Registers one value for one pooled question (creating it on first sight).
    // Subject key is now the MEDIA NAME (a string), not the local media_file_id
    // — the only requirement for two ratings to be pooled as "the same
    // encounter" is that they share a media name, whether that rating came
    // from this project's own database or an imported results file from a
    // completely different install. `meta` carries whatever a
    // reliabilityStats function needs (min/max/options).
    function record(key, label, method, meta, subjectKey, value, reviewerName, sourceLabel, sectionTitle, sortIndex) {
      if (value == null || value === '') return
      if (!questionMap.has(key)) {
        questionMap.set(key, { key, label, method, meta, sectionTitle, sortIndex, subjects: new Map(), cells: new Map() })
      }
      const entry = questionMap.get(key)
      const bucket = entry.subjects.get(subjectKey) || []
      bucket.push(value)
      entry.subjects.set(subjectKey, bucket)
      // Parallel to `subjects` above (which stays a plain value array — don't
      // touch it, computeQuestionReliability consumes it exactly as-is).
      // This tracks who gave each value, purely for the answer-table UI —
      // click a question to see exactly what each reviewer answered per
      // encounter, not just the pooled statistic.
      const cellBucket = entry.cells.get(subjectKey) || []
      cellBucket.push({ reviewerName: reviewerName || 'Unknown', sourceLabel: sourceLabel || '', value })
      entry.cells.set(subjectKey, cellBucket)
    }

    // Shared by both own-project reviews and imported rows below — keys
    // questions by FORM NAME (not local form_id, which is meaningless across
    // installs) plus element id. Uses the current live form's schema when a
    // form of that name exists in this project (so turning on ICC applies
    // retroactively to all data, own or imported); falls back to the row's
    // own frozen snapshot only if no such form exists here.
    function processFormResponse(formName, formIdForFallback, formSnapshot, responses, instanceRole, instanceOrder, subjectKey, reviewerName, sourceLabel) {
      const liveForm = currentFormsByName.get(formName) || currentFormsById.get(String(formIdForFallback))
      const schemaSource = liveForm?.schema || formSnapshot
      const sections = questionReliabilitySchemaSections(schemaSource)
      const instanceKeySuffix = instanceRole ? `:${instanceRole}:${instanceOrder}` : ''
      const instanceLabelSuffix = instanceRole ? ` (${instanceRole} ${instanceOrder})` : ''
      // Sort index is the question's actual position in the form — section
      // index times a fixed stride, plus its position within that section
      // (assumes no section has 1000+ elements, comfortably safe). This is
      // what lets the Agreement page order questions the way the form
      // actually presents them instead of alphabetically.
      let sectionIdx = 0
      for (const section of sections) {
        const sectionTitle = section?.title || `Section ${sectionIdx + 1}`
        const elements = section?.elements || []
        let elementIdx = 0
        for (const element of elements) {
          const sortIndex = sectionIdx * 1000 + elementIdx
          elementIdx++
          const method = element?.agreement_method
          if (!RELIABILITY_METHODS.has(method)) continue
          if (UNSUPPORTED_COMPOSITE_TYPES.has(element?.type)) continue

          if (ROW_UNPACK_TYPES.has(element?.type)) {
            // One pooled question PER ROW (e.g. UCAT's "Global Measures" group
            // has 10 rows == 10 dimension-level ICCs), not one for the whole group.
            const groupResponses = responses?.[element.id] || {}
            const rowMeta = { min: 1, max: Number(element.scale) || 5 }
            let rowIdx = 0
            for (const item of (element.items || [])) {
              const key = `${formName}:${element.id}:${item.id}${instanceKeySuffix}`
              const value = groupResponses?.[item.id]
              const label = (element.label ? `${element.label} — ${item.label || item.id}` : (item.label || item.id)) + instanceLabelSuffix
              record(key, label, method, rowMeta, subjectKey, value, reviewerName, sourceLabel, sectionTitle, sortIndex + rowIdx / 1000)
              rowIdx++
            }
            continue
          }

          if (ARRAY_UNPACK_TYPES.has(element?.type)) {
            // One pooled question PER SUB-DIAL (e.g. SDMo's "Evidence of
            // Distinction Dials", count: 2, becomes 2 separate numeric/ICC
            // pooled questions) — array position is the only identifier
            // available, since unlike ROW_UNPACK_TYPES there's no row id to
            // key by. control_labels (if present) name each position; falls
            // back to a generic "Dial N" label otherwise.
            const arrayResponses = Array.isArray(responses?.[element.id]) ? responses[element.id] : []
            const count = Math.min(5, Math.max(1, Number(element.count || 1)))
            const dialMeta = { min: Number(element.min ?? 0), max: Number(element.max ?? 100) }
            for (let idx = 0; idx < count; idx++) {
              const key = `${formName}:${element.id}:${idx}${instanceKeySuffix}`
              const value = arrayResponses[idx]
              const subLabel = element.control_labels?.[idx] || `Dial ${idx + 1}`
              const label = (element.label ? `${element.label} — ${subLabel}` : subLabel) + instanceLabelSuffix
              record(key, label, method, dialMeta, subjectKey, value, reviewerName, sourceLabel, sectionTitle, sortIndex + idx / 1000)
            }
            continue
          }

          const key = `${formName}:${element.id}${instanceKeySuffix}`
          const value = responses?.[element.id]
          record(key, (element.label || element.id) + instanceLabelSuffix, method, element, subjectKey, value, reviewerName, sourceLabel, sectionTitle, sortIndex)
        }
        sectionIdx++
      }
    }

    // Own project's submitted reviews — subject = media name.
    for (const review of submitted) {
      for (const formResponse of (review.form_responses || [])) {
        const formName = formResponse.form_name || currentFormsById.get(String(formResponse.form_id))?.name || null
        if (!formName) continue // form was deleted and no snapshot name to fall back on
        processFormResponse(
          formName, formResponse.form_id, formResponse.form_snapshot, formResponse.responses,
          formResponse.instance_role || null, formResponse.instance_order || 0,
          review.media_name, review.reviewer_name, 'Project'
        )
      }
    }

    // Imported results (from Export/Import Results, potentially a completely
    // different install) — matched purely by media name, exactly like above.
    // Each source's data is grouped by the form name it was recorded against;
    // if that form doesn't match one of THIS project's own forms by name
    // (e.g. an SDMo export imported into a UCAT project), that data is not
    // pooled in at all, and a visible warning is raised instead — silently
    // pooling mismatched forms would produce meaningless numbers.
    for (const source of importedSources) {
      const rowsByForm = new Map()
      for (const row of (source.responses_long || [])) {
        if (!rowsByForm.has(row.form_name)) rowsByForm.set(row.form_name, [])
        rowsByForm.get(row.form_name).push(row)
      }
      for (const [formName, rows] of rowsByForm) {
        if (!formName || !currentFormNames.has(formName)) {
          warnings.push({
            sourceName: source.source_name,
            reviewerName: source.reviewer_name,
            importedFormName: formName || '(unknown)',
            expectedFormNames: Array.from(currentFormNames),
          })
          continue
        }
        for (const row of rows) {
          processFormResponse(
            formName, row.form_id, row.form_snapshot, row.responses,
            row.instance_role || null, row.instance_order || 0,
            row.media_name, row.reviewer_name || source.reviewer_name, source.source_name || 'Imported'
          )
        }
      }
    }

    const results = []
    for (const entry of questionMap.values()) {
      const subjectGroups = Array.from(entry.subjects.values())
      const stat = computeQuestionReliability(entry.method, subjectGroups, entry.meta)
      results.push({
        key: entry.key,
        label: entry.label,
        sectionTitle: entry.sectionTitle || 'Other',
        sortIndex: entry.sortIndex ?? 0,
        // Same schema-driven flag used for Alignment's default-expanded rows
        // (see QuestionAgreementRow) — used here to decide whether the
        // section this question belongs to should start collapsed or open.
        defaultExpanded: !!entry.meta?.default_expanded,
        // Prefer the computed result's own method label over the originally
        // dispatched one — 'numeric' dispatches to computeICC, which
        // self-labels its output 'icc'. Using entry.method here would
        // display "numeric" (not a real label), skip ICC's interpretation
        // bands, and use the wrong subjects-needed threshold below.
        // computeICC returns plain null (not an object) when there isn't
        // enough data, so stat?.method alone wouldn't cover that case —
        // 'numeric' always deterministically means ICC was attempted,
        // whether or not it actually produced a value.
        method: stat?.method || (entry.method === 'numeric' ? 'icc' : entry.method),
        stat,
        subjectsSeen: subjectGroups.length,
        subjectsUsable: subjectGroups.filter(g => g.length >= 2).length,
        // subjectKey -> [{ reviewerName, sourceLabel, value }] — every
        // individual answer behind this pooled statistic, for the
        // click-to-expand answer table. Not consumed by any stats math.
        cells: entry.cells,
      })
    }
    // Form order, not alphabetical — sortIndex already encodes each
    // question's actual position (section index * 1000 + position within
    // it), so this reproduces the form's own section/question ordering.
    results.sort((a, b) => a.sortIndex - b.sortIndex)
    return { results, mismatchWarnings: warnings }
  }, [rawReviews, currentForms, importedSources])

  // Groups are built from the already form-ordered `questions` array, so
  // this just splits it into contiguous runs by section — no re-sorting
  // needed, since sortIndex already guarantees same-section questions sit
  // next to each other.
  const questionGroups = useMemo(() => {
    const groups = []
    for (const q of questions) {
      const last = groups[groups.length - 1]
      if (last && last.sectionTitle === q.sectionTitle) {
        last.items.push(q)
      } else {
        groups.push({ sectionTitle: q.sectionTitle, items: [q] })
      }
    }
    return groups
  }, [questions])

  // Map<sectionTitle, boolean> — only holds entries the user has explicitly
  // clicked. Absence means "use the schema-driven default": a section starts
  // collapsed unless at least one of its questions opts in via
  // default_expanded (same flag Alignment's QuestionAgreementRow uses), e.g.
  // UCAT's Global Measures / final question start open, everything else
  // (Conversation through Future Topics) starts collapsed. Either way, a
  // section stays exactly where the user last left it, clicked or not.
  const [sectionOverrides, setSectionOverrides] = useState(new Map())

  function isSectionCollapsed(group) {
    if (sectionOverrides.has(group.sectionTitle)) return sectionOverrides.get(group.sectionTitle)
    return !group.items.some(q => q.defaultExpanded)
  }

  function toggleSection(group) {
    setSectionOverrides(prev => {
      const next = new Map(prev)
      next.set(group.sectionTitle, !isSectionCollapsed(group))
      return next
    })
  }

  if (loading) return <div className="empty-state"><p>Loading…</p></div>

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Agreement</h1>
        <p className="text-secondary text-sm" style={{ margin: 0 }}>
          For questions set to ICC, Cohen's kappa, or weighted kappa, this pools every rating for that
          question — from this project and from any imported results files — across all encounters that
          share a media name, and computes one reliability statistic. Per-file percentage agreement is
          still shown under Agreement → Alignment.
        </p>
      </div>

      {(rawReviews.some(r => r.status === 'submitted') || importedSources.length > 0) && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16, background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <User size={13} /> Contributing to these numbers
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {/* This project's own reviewers — read-only context, not removable
                here. Deleting a real review is a separate action on the
                encounter itself, with its own confirm and soft-delete
                consequences — not something to fold into this list. */}
            {Array.from(new Set(rawReviews.filter(r => r.status === 'submitted').map(r => r.reviewer_name).filter(Boolean))).map(name => (
              <span key={`own-${name}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 9px', borderRadius: 999, fontSize: 12,
                background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)',
              }}>
                {name}
              </span>
            ))}
            {/* Imported files — each one removable. A hard delete, not a hide
                flag: removing one drops it from every consumer of
                imported_results at once (this page, Alignment, the CSV
                export), with no separate "excluded but present" state to
                keep in sync. The source .json still exists wherever it was
                exported, so this isn't destructive to the underlying data —
                just to this project's copy of it. */}
            {importedSources.map(source => (
              <span key={`imported-${source.id}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 6px 4px 9px', borderRadius: 999, fontSize: 12,
                background: 'var(--accent-light)', border: '1px solid var(--accent)', color: 'var(--accent)',
              }}>
                {source.reviewer_name || source.source_name}
                <button
                  onClick={() => handleRemoveImportedSource(source)}
                  disabled={removingId === source.id}
                  title="Remove this imported file"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 16, height: 16, borderRadius: '50%', border: 'none',
                    background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0,
                    opacity: removingId === source.id ? 0.4 : 0.7,
                  }}
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {mismatchWarnings.length > 0 && !mismatchDismissed && (
        <div style={{ border: '1px solid var(--warning)', background: 'var(--warning-light)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--warning)' }}>Import form mismatch — some imported data was not included</div>
            <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, color: 'var(--warning)' }} onClick={() => setMismatchDismissed(true)}>
              <X size={12} />
            </button>
          </div>
          {mismatchWarnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
              "{w.sourceName}"{w.reviewerName ? ` (${w.reviewerName})` : ''} was recorded against form
              "<strong>{w.importedFormName}</strong>", which doesn't match this project's form
              {w.expectedFormNames.length === 1 ? '' : 's'} ({w.expectedFormNames.join(', ') || 'none'}).
              This data was excluded from the calculations below.
            </div>
          ))}
        </div>
      )}

      {questions.length === 0 ? (
        <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Gauge size={38} style={{ margin: '0 auto 14px', opacity: 0.35 }} />
          <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No questions use these methods yet</p>
          <p style={{ fontSize: 13 }}>
            In the form builder, set a question's agreement method to ICC, Cohen's kappa, or weighted
            kappa to see it appear here. A single reviewer's answers (or one imported file) already
            show up right away — you'll see "—" for the statistic itself until there's a second rating
            to compare against, but the answer is visible.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {questionGroups.map(group => {
            const isCollapsed = isSectionCollapsed(group)
            return (
              <div key={group.sectionTitle}>
                <button
                  onClick={() => toggleSection(group)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 8px',
                    color: 'var(--text)', fontFamily: 'var(--font)',
                  }}
                >
                  <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{group.sectionTitle}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>({group.items.length})</span>
                </button>
                {!isCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {group.items.map(q => {
            const value = q.stat?.value ?? null
            const noVariance = q.stat?.reason === 'no_variance'
            const interpretation = q.method === 'icc'
              ? iccInterpretation(value)
              : q.method === 'percent'
                ? null
                : kappaInterpretation(value)
            const displayValue = value == null ? '—' : q.method === 'percent' ? `${Math.round(value * 100)}%` : value.toFixed(2)
            const isExpanded = !collapsedAnswerKeys.has(q.key)

            // Built only when expanded — no point recomputing this for every
            // collapsed card on every render. Rows are subjects (encounters);
            // columns are every distinct reviewer identity who answered THIS
            // question anywhere. Keyed by reviewerName+sourceLabel together
            // (not name alone) so your own review and an imported file you
            // exported yourself, which could share a display name, land in
            // separate columns instead of silently merging and hiding a real
            // disagreement.
            let tableSubjects = []
            let tableColumns = []
            if (isExpanded) {
              const columnMap = new Map()
              for (const cells of q.cells.values()) {
                for (const cell of cells) {
                  const colKey = `${cell.reviewerName}::${cell.sourceLabel}`
                  if (!columnMap.has(colKey)) columnMap.set(colKey, { key: colKey, reviewerName: cell.reviewerName, sourceLabel: cell.sourceLabel })
                }
              }
              tableColumns = Array.from(columnMap.values()).sort((a, b) => a.reviewerName.localeCompare(b.reviewerName))
              tableSubjects = Array.from(q.cells.entries()).map(([subjectKey, cells]) => {
                const byColumn = new Map(cells.map(c => [`${c.reviewerName}::${c.sourceLabel}`, c.value]))
                return { subjectKey, byColumn }
              }).sort((a, b) => a.subjectKey.localeCompare(b.subjectKey))
            }

            return (
              <div key={q.key} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg)' }}>
                <div
                  onClick={() => setCollapsedAnswerKeys(prev => {
                    const next = new Set(prev)
                    if (isExpanded) next.add(q.key)
                    else next.delete(q.key)
                    return next
                  })}
                  style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {q.label}
                      <ChevronDown size={13} style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{QUESTION_RELIABILITY_METHOD_LABELS[q.method] || q.method}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>
                      {displayValue}
                    </div>
                    {interpretation && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {interpretation.label} <span style={{ opacity: 0.7 }}>({interpretation.source})</span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  {q.subjectsUsable} of {q.subjectsSeen} rated encounter{q.subjectsSeen === 1 ? '' : 's'} had 2+
                  reviewers and count toward this statistic.
                  {/* ICC needs 2+ subjects to define between-subject variance at all;
                      percent agreement and kappa-family methods only need 1+, since
                      they're computed from pooled ratings rather than variance across
                      subjects. */}
                  {!noVariance && q.subjectsUsable < (q.method === 'icc' ? 2 : 1) && ' Not enough data yet for a reliable estimate.'}
                  {noVariance && ` Every rating agreed exactly, with no variation at all — ${q.method === 'icc' ? 'ICC' : 'kappa'} is mathematically undefined in this case, not simply low. This isn\u2019t a data shortage; it will resolve once ratings include some disagreement or a wider mix of values.`}
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', tableLayout: 'fixed' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--text-muted)', fontWeight: 600, overflowWrap: 'break-word' }}>Encounter</th>
                          {tableColumns.map(col => (
                            <th key={col.key} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600, overflowWrap: 'break-word' }}>
                              {col.reviewerName}
                              {col.sourceLabel && col.sourceLabel !== 'Project' && (
                                <span style={{ display: 'block', fontWeight: 400, opacity: 0.7 }}>{col.sourceLabel}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableSubjects.map(row => (
                          <tr key={row.subjectKey} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 8px 6px 0', fontWeight: 500, overflowWrap: 'break-word' }}>{row.subjectKey}</td>
                            {tableColumns.map(col => (
                              <td key={col.key} style={{ padding: '6px 8px', overflowWrap: 'break-word' }}>
                                {formatRawAnswerValue(row.byColumn.get(col.key))}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}