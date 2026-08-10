import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ChevronLeft, Plus, Maximize2, Minimize2,
  Clock, Trash2, ChevronDown, ChevronUp, CheckCircle2, Maximize, Edit2, AlertCircle,
  Columns2, Rows2, ExternalLink, HelpCircle, Play, Pause, Volume2, VolumeX, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, formatTime } from '../lib/api'
import FormRenderer from '../components/forms/FormRenderer'
import Modal from '../components/ui/Modal'
import useTour from '../components/ui/useTour'
import PdfViewer from '../components/ui/PdfViewer'

const REVIEW_TOUR_STEPS = [
  {
    targetId: 'tut-rev-video',
    placement: 'right',
    title: 'The Video Player',
    body: 'Play, pause, and scrub through the video here. You can drag the divider to resize the video panel, or use the layout button (top-right) to switch between stacked and side-by-side views.',
  },
  {
    targetId: 'tut-rev-timestamp',
    placement: 'bottom',
    title: 'Logging Timestamps',
    body: 'Click "Add Timestamp" to capture the current video position. Then tag it (e.g. Greeting, Question, Empathy) to categorize the moment. Set up keyboard shortcuts in Settings → Keybinds so you never have to pause.',
  },
  {
    targetId: 'tut-rev-workspace',
    placement: 'top',
    title: 'Forms & Instructions',
    body: 'These tabs contain your coding forms and any reference instructions. Fill them out as you watch — everything saves automatically. Switch tabs without losing progress. You can also pop the workspace into a separate window.',
  },
  {
    targetId: 'tut-rev-submit',
    placement: 'bottom',
    title: 'Submitting Your Review',
    body: "Click Submit Review when you're done coding. If sync is configured, EnIAC will share the submitted review automatically in the background; you can still use Sync Now on the project page to pull teammates' latest work.",
  },
]

const SYNC_BASICS_TOUR_STEPS = [
  {
    targetId: 'tut-rev-sync-basics',
    placement: 'top',
    title: 'Sync Basics',
    body: 'This page explains what EnIAC sync shares with teammates, what stays local on each computer, and the habits that prevent duplicate or missing review data.',
  },
]

function normalizeKeybindKey(key) {
  if (!key) return ''
  if (key === ' ') return 'space'
  return String(key).trim().toLowerCase()
}

function isTypingTarget(target) {
  const tag = target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable || target?.getAttribute?.('role') === 'textbox'
}

function resolveKeybindTag(bind, tags) {
  if (!bind) return { tag: null, missing: false }
  const wantsTag = bind.tagId != null || !!bind.tagLabel
  if (!wantsTag) return { tag: null, missing: false }
  const byLabel = bind.tagLabel ? tags.find(tag => tag.label === bind.tagLabel) : null
  if (byLabel) return { tag: byLabel, missing: false }
  const byId = bind.tagId != null ? tags.find(tag => String(tag.id) === String(bind.tagId)) : null
  if (byId) return { tag: byId, missing: false }
  return { tag: null, missing: true }
}

// Groups a review's form_responses by form_id into an ARRAY of instances
// (sorted by role, then creation order) rather than one flat object per
// form — a form can now have more than one response set within the same
// review (e.g. "Trainee 1", "Consultant 1"), each identified by instance_key.
// instance_key === '' is the implicit single/default instance.
function parseFormInstances(rev) {
  const byForm = {}
  for (const fr of (rev.form_responses || [])) {
    if (!byForm[fr.form_id]) byForm[fr.form_id] = []
    byForm[fr.form_id].push({
      instance_key: fr.instance_key || '',
      instance_role: fr.instance_role || null,
      instance_order: fr.instance_order || 0,
      responses: fr.responses || {},
    })
  }
  for (const formId of Object.keys(byForm)) {
    byForm[formId].sort((a, b) => (a.instance_role || '').localeCompare(b.instance_role || '') || a.instance_order - b.instance_order)
  }
  return byForm
}

function defaultActiveInstances(byForm) {
  const active = {}
  for (const [formId, instances] of Object.entries(byForm)) {
    if (instances.length > 0) active[formId] = instances[0].instance_key
  }
  return active
}

function hydrateWorkspaceSnapshot(snapshot) {
  const formSchemas = {}
  for (const [id, form] of Object.entries(snapshot?.forms || {})) {
    formSchemas[id] = { ...form, schema: form.schema || { sections: [] } }
  }
  const instructions = {}
  for (const [id, instr] of Object.entries(snapshot?.instructions || {})) instructions[id] = instr
  return {
    tags: snapshot?.tags || [],
    workspaceTabs: snapshot?.workspace_tabs || [],
    formSchemas,
    instructions,
    mediaTypeName: snapshot?.media_type?.name || null,
  }
}

function patchSnapshotPdfPaths(instructions, liveInstructions = []) {
  const liveById = new Map(liveInstructions.map(instr => [String(instr.id), instr]))
  const liveBySyncId = new Map(liveInstructions.filter(instr => instr.sync_id).map(instr => [instr.sync_id, instr]))
  const liveByName = new Map(liveInstructions.map(instr => [instr.name, instr]))
  return Object.fromEntries(Object.entries(instructions || {}).map(([id, instr]) => {
    if (instr?.content_type !== 'pdf' || instr.file_path) return [id, instr]
    const live = liveById.get(String(instr.id)) || liveById.get(String(id)) || liveBySyncId.get(instr.sync_id) || liveByName.get(instr.name)
    return [id, { ...instr, file_path: live?.file_path || null }]
  }))
}

function PdfInstructionFrame({ instruction }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setUrl(null)
    setError('')
    if (!instruction?.id) {
      setError('PDF file not found for this instruction.')
      return () => { active = false }
    }
    api.getInstructionFileUrl(instruction.id).then(nextUrl => {
      if (!active) return
      if (nextUrl) setUrl(nextUrl)
      else setError('PDF file not found for this instruction.')
    }).catch(() => {
      if (active) setError('PDF file could not be loaded.')
    })
    return () => { active = false }
  }, [instruction?.id])

  if (error) return <div className="empty-state"><p className="text-sm">{error}</p></div>
  if (!url) return <div className="empty-state"><div className="spinner" /></div>
  return <PdfViewer url={url} title={instruction.name} />
}

function tagOptionValue(tag) {
  if (tag?.id != null) return `id:${tag.id}`
  return tag?.label ? `label:${tag.label}` : ''
}

function findTag(tags, value) {
  if (!value) return null
  const raw = String(value)
  if (raw.startsWith('id:')) {
    const id = raw.slice(3)
    return tags.find(t => String(t.id) === id) || null
  }
  if (raw.startsWith('label:')) {
    const label = raw.slice(6)
    return tags.find(t => t.label === label) || null
  }
  return tags.find(t => String(t.id) === raw || t.label === raw) || null
}

function findTimestampTag(tags, ts) {
  if (ts?.tag_id != null) {
    const byId = tags.find(t => String(t.id) === String(ts.tag_id))
    if (byId) return byId
  }
  return ts?.tag_label ? tags.find(t => t.label === ts.tag_label) || null : null
}

function sampleReviewTourKey(reviewId) { return `sdmo_sample_review_tour_started_v1:${reviewId}` }

function reopenedReasonLabel(reason) {
  if (reason === 'form_version_changed') return 'Reopened after form update'
  if (reason === 'media_type_version_changed') return 'Reopened after media type update'
  return 'Reopened'
}

export default function ReviewPage() {
  const { reviewId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const videoRef = useRef(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoHovered, setVideoHovered] = useState(false)
  const [videoControlsFocused, setVideoControlsFocused] = useState(false)
  const [videoPaused, setVideoPaused] = useState(true)
  const [videoMuted, setVideoMuted] = useState(false)

  const [review, setReview] = useState(null)
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaTypeName, setMediaTypeName] = useState(null)
  const [timestamps, setTimestamps] = useState([])
  const [tags, setTags] = useState([])
  const [workspaceTabs, setWorkspaceTabs] = useState([])
  const [formSchemas, setFormSchemas] = useState({})
  const [instructions, setInstructions] = useState({})
  const [allInstructions, setAllInstructions] = useState([])
  const [showSdmoInfo, setShowSdmoInfo] = useState(false)
  const [formInstances, setFormInstances] = useState({}) // { [formId]: [{instance_key, instance_role, instance_order, responses}] }
  const [activeInstanceKey, setActiveInstanceKey] = useState({}) // { [formId]: instance_key }

  const [activeTab, setActiveTab] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tagSelectionTargetId, setTagSelectionTargetId] = useState(null)
  const [videoExpanded, setVideoExpanded] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)
  const [layoutMode, setLayoutMode] = useState('vertical') // 'vertical' | 'horizontal'
  const [tagsPaletteOpen, setTagsPaletteOpen] = useState(false)
  const [sdmoPanelWidth, setSdmoPanelWidth] = useState(240)
  const [sdmoPanelView, setSdmoPanelView] = useState('tags') // 'tags' | 'notes' — SDMo's merged side panel
  const [timestampsPosition, setTimestampsPosition] = useState('side') // 'side' | 'bottom' — independent of layoutMode
  const [splitPct, setSplitPct] = useState(44) // video height% (vertical) or width% (horizontal)
  const [workspaceMinimized, setWorkspaceMinimized] = useState(false)

  const [keybinds, setKeybinds] = useState([])
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoError, setVideoError] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [sampleTourStarted, setSampleTourStarted] = useState(false)
  const [pendingSyncBasicsTour, setPendingSyncBasicsTour] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [validationErrors, setValidationErrors] = useState([])
  const isSampleTour = new URLSearchParams(location.search).get('sampleTour') === '1'
  const tour = useTour(REVIEW_TOUR_STEPS, 'sdmo_tour_review_v1', {
    ready: !loading && !!videoUrl,
    onComplete: () => {
      if (isSampleTour) setPendingSyncBasicsTour(true)
    },
  })
  const syncBasicsTour = useTour(SYNC_BASICS_TOUR_STEPS, null, { ready: !loading && !!videoUrl })
  const [linkModal, setLinkModal] = useState(null) // null | 'not_linked' | 'missing'
  const [linkSaving, setLinkSaving] = useState(false)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [encProjectId, setEncProjectId] = useState(null)

  const splitDragRef = useRef(null)
  const mainAreaRef = useRef(null)
  const outerAreaRef = useRef(null)
  const videoPanelRef = useRef(null)

  useEffect(() => { load() }, [reviewId])

  // SDMo media defaults to the tag palette open — matches its intended
  // click-to-tag workflow. Only sets the default once per loaded review;
  // doesn't fight a manual close afterward.
  useEffect(() => {
    if (mediaTypeName === 'SDMo') setTagsPaletteOpen(true)
  }, [mediaTypeName, reviewId])

  // UCAT media has a fixed layout, not a default: content on the right
  // (video left, form right = layoutMode 'horizontal'), timestamps below.
  // Re-applied every render while viewing UCAT so a stray manual toggle
  // (the buttons are hidden, but state could still be set some other way)
  // can't leave it in an unintended configuration.
  useEffect(() => {
    if (mediaTypeName !== 'UCAT') return
    setLayoutMode('horizontal')
    setTimestampsPosition('bottom')
  }, [mediaTypeName])

  useEffect(() => {
    if (!isSampleTour || sampleTourStarted || loading || !videoUrl) return
    const key = sampleReviewTourKey(reviewId)
    if (localStorage.getItem(key)) {
      setSampleTourStarted(true)
      return
    }
    localStorage.setItem(key, '1')
    setSampleTourStarted(true)
    tour.start()
  }, [isSampleTour, sampleTourStarted, loading, videoUrl, reviewId, tour])

  useEffect(() => {
    if (!pendingSyncBasicsTour || loading || workspaceTabs.length === 0) return
    const idx = workspaceTabs.findIndex(tab => tab.tab_type === 'instruction' && tab.label === 'Sync Basics')
    if (idx < 0) {
      setPendingSyncBasicsTour(false)
      return
    }
    setWorkspaceExpanded(false)
    setWorkspaceMinimized(false)
    setActiveTab(idx)
    setPendingSyncBasicsTour(false)
    setTimeout(() => syncBasicsTour.start(), 100)
  }, [pendingSyncBasicsTour, loading, workspaceTabs, syncBasicsTour])

  function refreshReviewData(id) {
    api.getReview(id).then(rev => {
      if (!rev) return
      setSubmitted(rev.status === 'submitted')
      const byForm = parseFormInstances(rev)
      setFormInstances(byForm)
      setActiveInstanceKey(prev => ({ ...defaultActiveInstances(byForm), ...prev }))
    })
  }

  // Sync with pop-out workspace window
  useEffect(() => {
    function onReviewUpdated(updatedId) {
      if (String(updatedId) === String(reviewId)) refreshReviewData(reviewId)
    }
    function onWorkspaceClosed(closedId) {
      if (String(closedId) === String(reviewId)) setWorkspaceMinimized(false)
      // Data refresh comes via the review:updated event emitted alongside workspace:closed in main.js
    }
    const subReview = api.onReviewUpdated(onReviewUpdated)
    const subWorkspace = api.onWorkspaceClosed(onWorkspaceClosed)
    return () => {
      api.offReviewUpdated(subReview)
      api.offWorkspaceClosed(subWorkspace)
      api.closeWorkspaceWindow(reviewId)
    }
  }, [reviewId])

  // Sync fullscreen state when user exits via Escape
  useEffect(() => {
    async function checkFs() {
      const fs = await api.isFullscreen()
      if (!fs && isFullscreen) { setIsFullscreen(false); setVideoExpanded(false) }
    }
    window.addEventListener('resize', checkFs)
    return () => window.removeEventListener('resize', checkFs)
  }, [isFullscreen])

  async function toggleFullscreen() {
    const entering = !isFullscreen
    setIsFullscreen(entering)
    setVideoExpanded(entering)
    await api.setFullscreen(entering)
  }

  async function handlePopOut() {
    const base = window.location.href.split('#')[0]
    const url = `${base}#/workspace/${reviewId}`
    await api.openWorkspaceWindow(url)
    setWorkspaceMinimized(true)
  }

  // Keybind listener
  useEffect(() => {
    if (submitted || keybinds.length === 0) return
    function onKeyDown(e) {
      if (e.repeat || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const key = normalizeKeybindKey(e.key)
      const bind = keybinds.find(b => normalizeKeybindKey(b.key) === key)
      if (!bind) return
      const { tag, missing } = resolveKeybindTag(bind, tags)
      if (missing) return
      e.preventDefault()
      addTimestampWithTag(tag)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitted, keybinds, tags])

  // Spacebar play/pause
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== ' ') return
      const tag = e.target.tagName
      if (isTypingTarget(e.target) || tag === 'BUTTON') return
      if (!submitted && keybinds.some(bind => normalizeKeybindKey(bind.key) === 'space')) return
      e.preventDefault()
      toggleVideoPlayback()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keybinds, submitted])

  async function load() {
    setLoading(true)
    const rev = await api.getReview(reviewId)
    if (!rev) { navigate(-1); return }
    setReview(rev)
    setSubmitted(rev.status === 'submitted')
    setTimestamps(rev.timestamps || [])
    const byForm = parseFormInstances(rev)
    setFormInstances(byForm)
    setActiveInstanceKey(defaultActiveInstances(byForm))

    const mf = await api.getMediaFile(rev.media_file_id)
    setMediaFile(mf)
    if (!mf?.encounter_id) { setLoading(false); return }

    const [playback, enc] = await Promise.all([
      api.getMediaPlaybackInfo(mf.id),
      api.getEncounter(mf.encounter_id),
    ])
    if (!enc) { setLoading(false); return }
    setEncProjectId(enc.project_id)
    const hasLinkedPlayback = playback?.status === 'linked' && !!playback.url
    setVideoUrl(hasLinkedPlayback ? playback.url : null)
    setVideoError('')

    if (hasLinkedPlayback) {
      setMediaFile(current => current
        ? { ...current, file_type: playback.file_type || current.file_type, resolved_path: playback.resolved_path, link_status: playback.status }
        : current
      )
    } else {
      setMediaFile(current => current
        ? { ...current, file_type: playback?.file_type || current.file_type, resolved_path: playback?.resolved_path || null, link_status: playback?.status || 'not_linked' }
        : current
      )
    }

    // Parallel: project + media types
    const [proj, allTypes] = await Promise.all([
      api.getProject(enc.project_id),
      rev.workspace_snapshot ? Promise.resolve([]) : api.listMediaTypes(enc.project_id),
    ])
    if (proj?.keybinds) setKeybinds(proj.keybinds)

    if (rev.workspace_snapshot) {
      const frozen = hydrateWorkspaceSnapshot(rev.workspace_snapshot)
      const liveInstructions = await api.listInstructions(enc.project_id)
      setTags(frozen.tags)
      setWorkspaceTabs(frozen.workspaceTabs)
      setFormSchemas(frozen.formSchemas)
      setMediaTypeName(frozen.mediaTypeName)
      setInstructions(patchSnapshotPdfPaths(frozen.instructions, liveInstructions))
      setAllInstructions(liveInstructions)
      setLinkModal(hasLinkedPlayback || playback?.status === 'not_applicable' ? null : playback?.status === 'missing' ? 'missing' : 'not_linked')
      setLoading(false)
      return
    }

    const mt = allTypes.find(t => t.id === mf.media_type_id)
    if (!mt) { setLoading(false); return }
    setTags(mt.tags || [])
    setMediaTypeName(mt.name || null)
    setWorkspaceTabs(mt.workspace_tabs || [])

    // Parallel: fetch all workspace tab content at once
    const formTabs = (mt.workspace_tabs || []).filter(t => t.tab_type === 'form')
    const instrTabs = (mt.workspace_tabs || []).filter(t => t.tab_type === 'instruction')
    const [forms, allInstr] = await Promise.all([
      Promise.all(formTabs.map(tab => api.getForm(tab.ref_id))),
      instrTabs.length > 0 ? api.listInstructions(enc.project_id) : Promise.resolve([]),
    ])
    const newFormSchemas = {}
    formTabs.forEach((tab, i) => { if (forms[i]) newFormSchemas[tab.ref_id] = forms[i] })
    setFormSchemas(newFormSchemas)
    const newInstructions = {}
    instrTabs.forEach(tab => {
      const instr = allInstr.find(i => i.id === tab.ref_id)
      if (instr) newInstructions[tab.ref_id] = instr
    })
    setInstructions(newInstructions)
    setAllInstructions(allInstr)

    setLinkModal(hasLinkedPlayback || playback?.status === 'not_applicable' ? null : playback?.status === 'missing' ? 'missing' : 'not_linked')
    setLoading(false)
  }

  function basenameFromPath(filePath) {
    const parts = String(filePath).split(/[\\/]/)
    return parts[parts.length - 1] || filePath
  }

  async function linkFileByPath(filePath) {
    if (!mediaFile || !filePath) return
    setLinkSaving(true)
    try {
      await api.setMediaLink(mediaFile.id, encProjectId, filePath)
      const linkedName = basenameFromPath(filePath)
      if (linkedName && linkedName !== mediaFile.name) {
        await api.renameMediaFile(encProjectId, mediaFile.id, linkedName)
      }
      setLinkModal(null)
      load()
    } finally {
      setLinkSaving(false)
    }
  }

  async function handleLinkFile() {
    if (!mediaFile) return
    setLinkSaving(true)
    const filePath = await api.browseMediaFile(mediaFile.id)
    if (filePath) {
      await linkFileByPath(filePath)
    } else {
      setLinkSaving(false)
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
    if (!isDraggingFile) setIsDraggingFile(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setIsDraggingFile(false)
  }

  function handleFileDrop(e) {
    e.preventDefault()
    setIsDraggingFile(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    // Electron 32+ removed File.path from the renderer for security reasons —
    // webUtils.getPathForFile (exposed via preload) is the current replacement.
    const filePath = api.getPathForFile(file)
    if (filePath) linkFileByPath(filePath)
  }

  // Auto-fits the video panel to the video's own aspect ratio the moment its
  // dimensions become known (right after a video loads), so it displays with
  // no letterboxing initially. Only adjusts splitPct — the one dimension the
  // video panel doesn't already have fixed by the layout (100% width in
  // vertical/SDMo layout, 100% height in horizontal layout) — so a manual
  // resize of the notes/form panel width still factors in correctly, since
  // mainAreaRef's measured size already excludes whatever that panel
  // currently takes up. Clamped to the same [20,75] range as manual
  // dragging; a video far more extreme than that range will still show some
  // letterboxing, same as if it were resized by hand to those limits.
  //
  // For SDMo specifically, the side panel is a second adjustable dimension,
  // not just a fixed input — treating its current width as fixed (as the
  // rest of this function does for every other media type) can leave real
  // letterboxing on screen that a wider or narrower panel would have
  // resolved. So for SDMo, this solves for the panel width and splitPct
  // together: first finds the panel width that would let the video reach
  // full height with no leftover space, clamps that to the panel's own
  // [200,560] range, then recalculates the required height for whatever
  // width the video actually ends up with after that clamp — rather than
  // assuming the ideal panel width was always reachable.
  function autoFitVideoToPanel(videoEl) {
    if (!videoEl?.videoWidth || !videoEl?.videoHeight) return
    const videoAspect = videoEl.videoWidth / videoEl.videoHeight

    if (isSdmoMedia) {
      const outer = outerAreaRef.current
      const mainArea = mainAreaRef.current
      if (!outer || !mainArea) return
      const outerRect = outer.getBoundingClientRect()
      const mainRect = mainArea.getBoundingClientRect()
      if (outerRect.width <= 0 || mainRect.height <= 0) return
      const idealPanelWidth = outerRect.width - mainRect.height * videoAspect
      const panelWidth = Math.min(560, Math.max(200, idealPanelWidth))
      setSdmoPanelWidth(panelWidth)
      const actualVideoWidth = outerRect.width - panelWidth
      const requiredHeight = actualVideoWidth / videoAspect
      const desiredPct = (requiredHeight / mainRect.height) * 100
      setSplitPct(Math.min(75, Math.max(20, desiredPct)))
      return
    }

    const container = mainAreaRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const desiredPct = layoutMode === 'horizontal'
      ? ((rect.height * videoAspect) / rect.width) * 100
      : ((rect.width / videoAspect) / rect.height) * 100
    setSplitPct(Math.min(75, Math.max(20, desiredPct)))
  }

  // --- Drag-to-resize split ---
  function onDividerMouseDown(e) {
    e.preventDefault()
    const container = mainAreaRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const isHoriz = layoutMode === 'horizontal'
    const totalSize = isHoriz ? rect.width : rect.height
    const startPos = isHoriz ? e.clientX : e.clientY
    const startPct = splitPct

    function onMove(ev) {
      const delta = (isHoriz ? ev.clientX : ev.clientY) - startPos
      const deltaPct = (delta / totalSize) * 100
      setSplitPct(Math.min(75, Math.max(20, startPct + deltaPct)))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Same drag-to-resize idea as the video/workspace divider above, but for
  // SDMo's merged Tags/Notes side panel — a fixed-width sidebar rather than a
  // proportional split, so this tracks pixels dragged directly instead of a
  // percentage of the container.
  function onSdmoPanelDividerMouseDown(e) {
    e.preventDefault()
    const startPos = e.clientX
    const startWidth = sdmoPanelWidth

    function onMove(ev) {
      // Panel is on the right edge and its own left border is what's being
      // dragged, so moving the pointer left (negative delta) should widen it.
      const delta = startPos - ev.clientX
      setSdmoPanelWidth(Math.min(560, Math.max(200, startWidth + delta)))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async function addTimestamp() {
    return addTimestampWithTag(null)
  }

  async function addTimestampWithTag(tagRef) {
    if (submitted) return null
    const t = videoRef.current?.currentTime ?? 0
    const tag = tagRef && typeof tagRef === 'object'
      ? tagRef
      : (tagRef != null ? tags.find(tg => tg.id == tagRef) : null)
    const id = await api.saveTimestamp(reviewId, {
      time_seconds: t,
      notes: '',
      tag_id: tag?.id || null,
      tag_label: tag?.label || null,
      tag_color: tag?.color || null,
    })
    const newTs = { id, time_seconds: t, notes: '', tag_id: tag?.id || null, tag_label: tag?.label || null, tag_color: tag?.color || null }
    setTimestamps(ts => [...ts, newTs].sort((a, b) => a.time_seconds - b.time_seconds))
    setTagSelectionTargetId(id)
    setSidebarOpen(true)
  }

  // Tag palette (SDMo layout): left-click tags the current moment and stops
  // there — no follow-up prompt of any kind. Right-click does the same but
  // also opens the timestamps sidebar, since each bubble's note field is
  // already expanded by default — nothing further needs to happen to reach it.
  async function handlePaletteTagClick(tag, { withNote = false } = {}) {
    if (submitted) return
    const t = videoRef.current?.currentTime ?? 0
    const id = await api.saveTimestamp(reviewId, {
      time_seconds: t,
      notes: '',
      tag_id: tag?.id || null,
      tag_label: tag?.label || null,
      tag_color: tag?.color || null,
    })
    const newTs = { id, time_seconds: t, notes: '', tag_id: tag?.id || null, tag_label: tag?.label || null, tag_color: tag?.color || null }
    setTimestamps(ts => [...ts, newTs].sort((a, b) => a.time_seconds - b.time_seconds))
    if (withNote) {
      setSidebarOpen(true)
      setSdmoPanelView('notes')
    }
  }

  async function updateTimestamp(id, changes) {
    if (submitted) return
    if ('tag_id' in changes) {
      const tag = changes.tag_id != null
        ? tags.find(t => t.id == changes.tag_id)
        : (changes.tag_label ? tags.find(t => t.label === changes.tag_label) : null)
      changes.tag_color = tag?.color || null
    }
    await api.updateTimestamp(id, changes)
    setTimestamps(ts => ts.map(t => t.id === id ? { ...t, ...changes } : t))
  }

  async function deleteTimestamp(id) {
    if (submitted) return
    await api.deleteTimestamp(id)
    setTimestamps(ts => ts.filter(t => t.id !== id))
  }

  async function saveFormResponse(formId, instanceKey, responses) {
    if (submitted) return
    const instances = formInstances[formId] || []
    const instance = instances.find(i => i.instance_key === instanceKey)
    await api.saveFormResponse(reviewId, {
      form_id: formId,
      instance_key: instanceKey,
      instance_role: instance?.instance_role || null,
      instance_order: instance?.instance_order || 0,
      responses,
    })
    setFormInstances(prev => {
      const list = prev[formId] || []
      const exists = list.some(i => i.instance_key === instanceKey)
      const next = exists
        ? list.map(i => i.instance_key === instanceKey ? { ...i, responses } : i)
        // First save for this instance (e.g. a brand-new review with nothing
        // saved yet) — .map() alone would have nothing to iterate over and
        // silently drop the update, which is exactly what caused the
        // "resets after the first change" bug. Create the entry instead.
        : [...list, { instance_key: instanceKey, instance_role: instance?.instance_role || null, instance_order: instance?.instance_order || 0, responses }]
      return { ...prev, [formId]: next }
    })
  }

  async function addFormInstance(formId, role) {
    if (submitted || !role) return
    const created = await api.addFormInstance(reviewId, formId, role)
    if (!created?.instance_key) return
    setFormInstances(prev => {
      const next = [...(prev[formId] || []), { ...created, responses: {} }]
      next.sort((a, b) => (a.instance_role || '').localeCompare(b.instance_role || '') || a.instance_order - b.instance_order)
      return { ...prev, [formId]: next }
    })
    setActiveInstanceKey(prev => ({ ...prev, [formId]: created.instance_key }))
  }

  async function removeFormInstance(formId, instanceKey) {
    if (submitted) return
    const instances = formInstances[formId] || []
    if (instances.length <= 1) return // always keep at least one instance for a form tab
    await api.removeFormInstance(reviewId, formId, instanceKey)
    const remaining = instances.filter(i => i.instance_key !== instanceKey)
    setFormInstances(prev => ({ ...prev, [formId]: remaining }))
    setActiveInstanceKey(prev => (
      prev[formId] === instanceKey ? { ...prev, [formId]: remaining[0]?.instance_key } : prev
    ))
  }

  function isResponseAnswered(value) {
    if (value === 'N/A' || (value && typeof value === 'object' && !Array.isArray(value) && value.__na === true)) return true
    if (value === undefined || value === null || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  }

  // Matches FormRenderer.jsx's isElementVisible — a conditionally-hidden
  // question (e.g. SDMo's tag-presence questions when "Did SDM likely
  // occur?" is "No") must never be treated as required-but-unanswered.
  function isElementVisible(el, values) {
    if (!el.visible_if) return true
    const { element_id, equals } = el.visible_if
    return values?.[element_id] === equals
  }

  function isRequiredElementComplete(el, value) {
    if (el.type === 'checkbox') {
      return value === true || value === 'N/A' || (value && typeof value === 'object' && !Array.isArray(value) && value.__na === true)
    }
    if (el.type === 'likert_group') {
      const items = el.items || []
      if (items.length === 0) return false
      const groupVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
      return items.every(item => isResponseAnswered(groupVal[item.id]))
    }
    if (el.type === 'table') {
      const rows = el.rows || []
      const columns = el.columns || []
      if (rows.length === 0 || columns.length === 0) return false
      const tableVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
      return rows.every((_, rowIndex) => {
        const rowVal = (tableVal[String(rowIndex)] && typeof tableVal[String(rowIndex)] === 'object') ? tableVal[String(rowIndex)] : {}
        return columns.every(col => isResponseAnswered(rowVal[col.id]))
      })
    }
    return isResponseAnswered(value)
  }

  function requiredElementLabel(el, questionNumber) {
    if (el.label) return el.label
    return `Question ${questionNumber || ''}`.trim()
  }

  function getRequiredErrors() {
    const errors = []
    for (const tab of workspaceTabs) {
      if (tab.tab_type !== 'form') continue
      const form = formSchemas[tab.ref_id]
      if (!form?.schema?.sections) continue
      const instances = formInstances[tab.ref_id] || []
      const roles = form.schema?.multi_instance_roles
      const isMultiInstance = Array.isArray(roles) && roles.length > 0
      if (instances.length === 0) {
        if (isMultiInstance) {
          errors.push({ tab: tab.label, question: 'Choose a role and fill out this form before submitting.' })
        } else {
          // The form was never opened at all — no form_responses row exists
          // yet. This still needs to be flagged if the form has any required
          // question, otherwise a review could submit with zero saved data
          // and nothing would ever catch it.
          const hasRequiredQuestion = form.schema.sections.some(section =>
            (section.elements || []).some(el => el.required)
          )
          if (hasRequiredQuestion) errors.push({ tab: tab.label, question: 'This form has required questions that haven\u2019t been answered yet.' })
        }
        continue
      }

      for (const instance of instances) {
        const responses = instance.responses || {}
        const instanceLabel = instance.instance_role ? `${instance.instance_role} ${instance.instance_order}` : null
        const tabLabel = instanceLabel ? `${tab.label} — ${instanceLabel}` : tab.label

        // Relaxed completion mode: the form only needs at least one answerable
        // question filled in, regardless of each question's individual
        // `required` flag. Older forms have no `completion_mode` set and keep
        // the standard all-required behavior below. likert_group/table rows
        // are unpacked individually so filling in just one row counts.
        if (form.schema.completion_mode === 'at_least_one') {
          let hasAnswerable = false
          let anyAnswered = false
          for (const section of form.schema.sections) {
            for (const el of (section.elements || [])) {
              if (!isElementVisible(el, responses)) continue
              if (el.type === 'text_block') continue
              if (el.type === 'likert_group') {
                const groupVal = (responses[el.id] && typeof responses[el.id] === 'object') ? responses[el.id] : {}
                for (const item of (el.items || [])) {
                  hasAnswerable = true
                  if (isResponseAnswered(groupVal[item.id])) anyAnswered = true
                }
                continue
              }
              if (el.type === 'table') {
                const tableVal = (responses[el.id] && typeof responses[el.id] === 'object') ? responses[el.id] : {}
                for (const rowIndex of (el.rows || []).keys()) {
                  const rowVal = (tableVal[String(rowIndex)] && typeof tableVal[String(rowIndex)] === 'object') ? tableVal[String(rowIndex)] : {}
                  for (const col of (el.columns || [])) {
                    hasAnswerable = true
                    if (isResponseAnswered(rowVal[col.id])) anyAnswered = true
                  }
                }
                continue
              }
              hasAnswerable = true
              if (isResponseAnswered(responses[el.id])) anyAnswered = true
            }
          }
          if (hasAnswerable && !anyAnswered) {
            errors.push({ tab: tabLabel, question: 'At least one question must be answered' })
          }
          continue
        }

        for (const section of form.schema.sections) {
          for (const [elementIndex, el] of (section.elements || []).entries()) {
            if (!isElementVisible(el, responses)) continue
            if (!el.required) continue
            const val = responses[el.id]
            const questionNumber = (section.elements || [])
              .slice(0, elementIndex + 1)
              .filter(item => item.type !== 'text_block').length
            if (!isRequiredElementComplete(el, val)) errors.push({ tab: tabLabel, question: requiredElementLabel(el, questionNumber) })
          }
        }
      }
    }
    return errors
  }

  function handleSubmitClick() {
    const errors = getRequiredErrors()
    if (errors.length > 0) {
      setValidationErrors(errors)
    } else {
      setValidationErrors([])
      setShowSubmit(true)
    }
  }

  async function handleSubmit() {
    await api.submitReview(reviewId, {})
    setSubmitted(true)
    setShowSubmit(false)
    api.notifyReviewUpdate(reviewId).catch(() => {})
  }

  async function handleUnsubmit() {
    await api.unsubmitReview(reviewId)
    setSubmitted(false)
    api.notifyReviewUpdate(reviewId).catch(() => {})
  }

  function seekTo(sec, { pause = false } = {}) {
    if (videoRef.current) {
      videoRef.current.currentTime = sec
      setVideoCurrentTime(sec)
      if (pause) {
        videoRef.current.pause()
        setVideoPaused(true)
      } else {
        videoRef.current.play()
      }
    }
  }

  function setVideoTime(sec) {
    if (!videoRef.current) return
    const next = Math.min(videoDuration || sec, Math.max(0, sec))
    videoRef.current.currentTime = next
    setVideoCurrentTime(next)
  }

  function toggleVideoPlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play()
    else video.pause()
  }

  function toggleVideoMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setVideoMuted(video.muted)
  }

  const isVideo = mediaFile?.file_type === 'video'

  if (loading) return <div className="empty-state" style={{ height: '100vh' }}><div className="spinner" /></div>

  if (linkModal) {
    const isMissing = linkModal === 'missing'
    return (
      <div
        style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 40 }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
      >
        <div style={{
          maxWidth: 440, width: '100%', background: 'var(--bg-secondary)', borderRadius: 12, padding: 32,
          display: 'flex', flexDirection: 'column', gap: 20,
          border: isDraggingFile ? '2px dashed var(--accent)' : '1px solid var(--border)',
          transition: 'border-color 0.15s ease',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              {isDraggingFile ? 'Drop the file to link it' : (isMissing ? 'File cannot be found' : 'File not linked on this machine')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {isDraggingFile
                ? <>Release to link this file to <strong>{mediaFile?.name}</strong>.</>
                : isMissing
                  ? <>The file <strong>{mediaFile?.name}</strong> was previously linked but cannot be found on disk. It may have been moved or renamed.</>
                  : <>The file <strong>{mediaFile?.name}</strong> hasn't been linked to a local path on this machine yet. Drag and drop the file here, or browse for it below.</>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleLinkFile} disabled={linkSaving}>
              {linkSaving ? 'Opening…' : isMissing ? 'Locate file…' : 'Browse to file…'}
            </button>
            <button className="btn btn-secondary" onClick={() => setLinkModal(null)}>
              Open without video
            </button>
            <button className="btn btn-ghost" onClick={() => navigate(-1)}>
              Go back
            </button>
          </div>
        </div>
      </div>
    )
  }

  const currentTab = workspaceTabs[activeTab]
  const isSyncBasicsTab = currentTab?.tab_type === 'instruction' && currentTab?.label === 'Sync Basics'
  const isFormWorkspaceTab = currentTab?.tab_type === 'form'
  const isPdfWorkspaceTab = currentTab?.tab_type === 'instruction' && instructions[currentTab?.ref_id]?.content_type === 'pdf'
  const currentFormInstances = currentTab?.tab_type === 'form' ? (formInstances[currentTab?.ref_id] || []) : []
  const currentActiveInstanceKey = currentTab?.tab_type === 'form' ? activeInstanceKey[currentTab?.ref_id] : null
  const currentActiveInstance = currentFormInstances.find(i => i.instance_key === currentActiveInstanceKey) || currentFormInstances[0]
  const currentFormRoles = currentTab?.tab_type === 'form' ? formSchemas[currentTab?.ref_id]?.schema?.multi_instance_roles : null
  const hasFormSwitcher = isFormWorkspaceTab && Array.isArray(currentFormRoles) && currentFormRoles.length > 0
  const workspaceContent = (
    <div
      id={isSyncBasicsTab ? 'tut-rev-sync-basics' : undefined}
      style={isPdfWorkspaceTab || hasFormSwitcher ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}
    >
      <WorkspaceTabContent
        tab={currentTab}
        formSchema={currentTab?.tab_type === 'form' ? formSchemas[currentTab?.ref_id] : null}
        instruction={currentTab?.tab_type === 'instruction' ? instructions[currentTab?.ref_id] : null}
        instances={currentFormInstances}
        activeInstanceKey={currentActiveInstance?.instance_key}
        responses={currentActiveInstance?.responses || null}
        onSave={(resp) => saveFormResponse(currentTab.ref_id, currentActiveInstance?.instance_key ?? '', resp)}
        onSwitchInstance={(key) => setActiveInstanceKey(prev => ({ ...prev, [currentTab.ref_id]: key }))}
        onAddInstance={(role) => addFormInstance(currentTab.ref_id, role)}
        onRemoveInstance={(key) => removeFormInstance(currentTab.ref_id, key)}
        readOnly={submitted}
        timestamps={timestamps}
        tags={tags}
      />
    </div>
  )

  const isHoriz = layoutMode === 'horizontal'
  const isSdmoMedia = mediaTypeName === 'SDMo'
  const isUcatMedia = mediaTypeName === 'UCAT'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Top bar */}
      {!videoExpanded && !workspaceExpanded && (
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          WebkitAppRegion: 'drag',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate(-1)}>
              <ChevronLeft size={16} />
            </button>
            <span className="truncate" style={{ fontWeight: 500, fontSize: 13, maxWidth: 300 }}>
              {mediaFile?.name}
            </span>
            {submitted && <span className="badge badge-success"><CheckCircle2 size={10} /> Submitted</span>}
            {!submitted && review?.reopened_at && (
              <span className="badge badge-muted" title={reopenedReasonLabel(review.reopened_reason)} style={{ color: '#b45309', background: '#fffbeb', borderColor: '#fde68a' }}>
                <AlertCircle size={10} /> Reopened
              </span>
            )}
          </div>
          <div id="tut-rev-submit" style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={tour.start} title="Show tutorial">
              <HelpCircle size={15} />
            </button>
            {isSdmoMedia && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSdmoInfo(true)} title="View SDMo reference documents">
                SDMo Info
              </button>
            )}
            {/* Layout toggle */}
            {!isSdmoMedia && !isUcatMedia && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title={isHoriz ? 'Stack video above workspace' : 'Place workspace beside video'}
                onClick={() => setLayoutMode(m => m === 'vertical' ? 'horizontal' : 'vertical')}
              >
                {isHoriz ? <Rows2 size={15} /> : <Columns2 size={15} />}
              </button>
            )}
            {submitted ? (
              <button className="btn btn-secondary btn-sm" onClick={handleUnsubmit}>
                <Edit2 size={13} /> Edit Review
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleSubmitClick}>
                Submit Review
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main area */}
      <div ref={outerAreaRef} style={{ flex: 1, display: 'flex', flexDirection: timestampsPosition === 'bottom' ? 'column' : 'row', overflow: 'hidden' }}>

        {/* Center: video + workspace (with resizable split) */}
        {!workspaceExpanded && (
          <div
            ref={mainAreaRef}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: isHoriz ? 'row' : 'column',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            {/* Video panel */}
            <div
              id="tut-rev-video"
              ref={videoPanelRef}
              style={{
                background: '#000',
                position: 'relative',
                ...(isHoriz
                  ? { width: (videoExpanded || workspaceMinimized) ? '100%' : `${splitPct}%`, height: '100%', flexShrink: videoExpanded || workspaceMinimized ? 0 : 0, flex: workspaceMinimized && !videoExpanded ? 1 : undefined }
                  : { height: videoExpanded ? '100%' : workspaceMinimized ? undefined : `${splitPct}%`, flex: workspaceMinimized && !videoExpanded ? 1 : undefined, width: '100%', flexShrink: 0 }),
              }}
              onMouseEnter={() => setVideoHovered(true)}
              onMouseLeave={() => setVideoHovered(false)}
            >
              {isVideo && videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls={false}
                  onClick={toggleVideoPlayback}
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', cursor: 'pointer' }}
                  onLoadedMetadata={e => { setVideoDuration(e.target.duration); setVideoCurrentTime(e.target.currentTime || 0); setVideoMuted(e.target.muted); autoFitVideoToPanel(e.target) }}
                  onTimeUpdate={e => setVideoCurrentTime(e.target.currentTime)}
                  onPlay={() => setVideoPaused(false)}
                  onPause={() => setVideoPaused(true)}
                  onVolumeChange={e => setVideoMuted(e.target.muted)}
                  onError={() => setVideoError('This file could not be played. It may use a codec Electron cannot decode, or the file may be damaged.')}
                />
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleFileDrop}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10,
                    border: isDraggingFile ? '2px dashed var(--accent)' : '2px dashed transparent',
                    borderRadius: 8, transition: 'border-color 0.15s ease',
                  }}
                >
                  <span style={{ color: '#fff', opacity: 0.4, fontSize: 13 }}>
                    {isDraggingFile ? 'Drop to link this file' : (isVideo ? 'Video not available on this machine' : 'Non-video file — see workspace tabs')}
                  </span>
                  {isVideo && !videoUrl && !isDraggingFile && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleLinkFile}
                      disabled={linkSaving}
                      style={{ opacity: 0.85 }}
                    >
                      {linkSaving ? 'Opening…' : 'Link file…'}
                    </button>
                  )}
                </div>
              )}

              {isVideo && videoError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, pointerEvents: 'none' }}>
                  <div style={{ maxWidth: 460, background: 'rgba(0,0,0,0.72)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>
                    {videoError}
                  </div>
                </div>
              )}

              {isVideo && videoDuration > 0 && (
                <VideoControls
                  timestamps={timestamps}
                  duration={videoDuration}
                  currentTime={videoCurrentTime}
                  paused={videoPaused}
                  muted={videoMuted}
                  tags={tags}
                  visible={videoHovered || videoPaused || videoControlsFocused}
                  onTogglePlay={toggleVideoPlayback}
                  onSeek={setVideoTime}
                  onMarkerSeek={(sec) => seekTo(sec, { pause: true })}
                  onToggleMute={toggleVideoMute}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  onFocusChange={setVideoControlsFocused}
                />
              )}
            </div>

            {/* Drag divider */}
            {!videoExpanded && !workspaceMinimized && (
              <div
                onMouseDown={onDividerMouseDown}
                style={{
                  flexShrink: 0,
                  background: 'var(--border)',
                  cursor: isHoriz ? 'col-resize' : 'row-resize',
                  ...(isHoriz
                    ? { width: 5, height: '100%' }
                    : { height: 5, width: '100%' }),
                  transition: 'background 0.15s',
                  zIndex: 10,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--border)'}
              />
            )}

            {/* Workspace panel */}
            {!videoExpanded && (
              <div style={{
                display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, background: 'var(--bg)',
                ...(workspaceMinimized
                  ? { flexShrink: 0, height: 82 }
                  : { flex: 1, minHeight: 0 }),
                transition: 'height 0.2s ease',
              }}>
                {/* Add Timestamp bar — hidden when minimized */}
                <div id="tut-rev-timestamp" style={{ padding: '7px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={addTimestamp} disabled={submitted}>
                    <Plus size={13} /> Add Timestamp
                  </button>
                  <span className="text-muted text-sm">at current video position</span>
                </div>

                {workspaceTabs.length > 0 ? (
                  <>
                    <div id="tut-rev-workspace" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                      <div className="tabs" style={{ flex: 1, borderBottom: 'none' }}>
                        {workspaceTabs.map((tab, i) => (
                          <button
                            key={tab.id}
                            className={`tab-btn ${activeTab === i ? 'active' : ''}`}
                            onClick={() => { setActiveTab(i); if (workspaceMinimized) setWorkspaceMinimized(false) }}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      {/* Workspace controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title={workspaceMinimized ? 'Restore workspace' : 'Minimize workspace'}
                          onClick={() => setWorkspaceMinimized(m => !m)}
                        >
                          {workspaceMinimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Open workspace in separate window"
                          onClick={handlePopOut}
                        >
                          <ExternalLink size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Expand workspace fullscreen"
                          onClick={() => setWorkspaceExpanded(true)}
                        >
                          <Maximize size={14} />
                        </button>
                      </div>
                    </div>
                    {!workspaceMinimized && (
                      <div style={isPdfWorkspaceTab
                        ? { flex: 1, overflow: 'hidden', padding: 0, minHeight: 0 }
                        : hasFormSwitcher
                          ? { flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }
                        : isFormWorkspaceTab
                          ? { flex: 1, overflow: 'auto', padding: '0 20px 20px' }
                        : { flex: 1, overflow: 'auto', padding: 20 }
                      }>
                        {workspaceContent}
                      </div>
                    )}
                  </>
                ) : (
                  !workspaceMinimized && (
                    <div className="empty-state" style={{ flex: 1 }}>
                      <p className="text-sm">No workspace tabs configured for this media type.</p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* Workspace fullscreen */}
        {workspaceExpanded && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div className="tabs" style={{ flex: 1, borderBottom: 'none' }}>
                {workspaceTabs.map((tab, i) => (
                  <button key={tab.id} className={`tab-btn ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                {submitted ? (
                  <button className="btn btn-secondary btn-sm" onClick={handleUnsubmit}>
                    <Edit2 size={13} /> Edit Review
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={handleSubmitClick}>
                    Submit Review
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setWorkspaceExpanded(false)}>
                  <Minimize2 size={14} /> Restore
                </button>
              </div>
            </div>
            <div style={isPdfWorkspaceTab
              ? { flex: 1, overflow: 'hidden', padding: 0, width: '100%', minHeight: 0 }
              : hasFormSwitcher
                ? { flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 1120, margin: '0 auto' }
              : isFormWorkspaceTab
                ? { flex: 1, overflow: 'auto', padding: '18px 32px 28px', maxWidth: 1120, width: '100%', margin: '0 auto' }
              : { flex: 1, overflow: 'auto', padding: 24, maxWidth: 800, width: '100%', margin: '0 auto' }
            }>
              {workspaceContent}
            </div>
          </div>
        )}

        {isSdmoMedia && !workspaceExpanded && (
          <div style={{ display: 'flex', flexShrink: 0, position: 'relative' }}>
            <button
              onClick={() => setTagsPaletteOpen(o => !o)}
              title={tagsPaletteOpen ? 'Collapse panel' : 'Show tags/notes'}
              style={{
                position: 'absolute', left: -14, top: '50%', transform: 'translateY(-50%)',
                width: 14, height: 44, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRight: 'none', borderRadius: '4px 0 0 4px', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', zIndex: 20, color: 'var(--text-muted)',
                padding: 0, fontSize: 9,
              }}
            >
              {tagsPaletteOpen ? '›' : '‹'}
            </button>
            <div style={{
              width: tagsPaletteOpen ? sdmoPanelWidth : 0, overflow: 'hidden', borderLeft: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', transition: tagsPaletteOpen ? 'none' : 'width 0.2s ease', height: '100%',
              position: 'relative',
            }}>
              {tagsPaletteOpen && (
                <div
                  onMouseDown={onSdmoPanelDividerMouseDown}
                  title="Drag to resize"
                  style={{
                    position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 21,
                  }}
                />
              )}
              <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={sdmoPanelView === 'tags' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                    style={{ fontSize: 12, flex: 1 }}
                    onClick={() => setSdmoPanelView('tags')}
                  >
                    Tags
                  </button>
                  <button
                    className={sdmoPanelView === 'notes' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                    style={{ fontSize: 12, flex: 1 }}
                    onClick={() => setSdmoPanelView('notes')}
                  >
                    Notes {timestamps.length > 0 && `(${timestamps.length})`}
                  </button>
                </div>
                {sdmoPanelView === 'tags' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Click to tag now · Right-click to also add a note
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sdmoPanelView === 'tags' ? (
                  <TagPaletteList
                    tags={tags}
                    timestamps={timestamps}
                    readOnly={submitted}
                    onLeftClick={(tag) => handlePaletteTagClick(tag, { withNote: false })}
                    onRightClick={(tag) => handlePaletteTagClick(tag, { withNote: true })}
                  />
                ) : timestamps.length === 0 ? (
                  <div className="empty-state" style={{ padding: '40px 10px' }}>
                    <Clock size={24} />
                    <p className="text-sm">No timestamps yet.<br />Right-click a tag to add one with a note.</p>
                  </div>
                ) : tagSelectionTargetId != null ? (
                  <TagSelectionPanel
                    key={tagSelectionTargetId}
                    timestamp={timestamps.find(ts => ts.id === tagSelectionTargetId) || null}
                    tags={tags}
                    onSelect={(changes) => {
                      if (tagSelectionTargetId != null) {
                        updateTimestamp(tagSelectionTargetId, changes)
                        setTagSelectionTargetId(null)
                      }
                    }}
                    onBack={() => setTagSelectionTargetId(null)}
                  />
                ) : (
                  timestamps.map(ts => (
                    <TimestampBubble
                      key={ts.id}
                      ts={ts}
                      tags={tags}
                      onSeek={() => seekTo(ts.time_seconds)}
                      onChange={(changes) => updateTimestamp(ts.id, changes)}
                      onDelete={() => deleteTimestamp(ts.id)}
                      onTagClick={() => setTagSelectionTargetId(ts.id)}
                      readOnly={submitted}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sidebar/bottom panel: timestamps (collapsible, position independent of video/form layout) — non-SDMo only; SDMo's is merged into the tags/notes panel above */}
        {!isSdmoMedia && !(videoExpanded || workspaceExpanded) && (
        <div style={{ display: 'flex', flexShrink: 0, position: 'relative', flexDirection: timestampsPosition === 'bottom' ? 'column' : 'row' }}>
          {/* Toggle tab — lives outside overflow:hidden so it's always visible */}
          <button
            onClick={() => setSidebarOpen(s => !s)}
            title={sidebarOpen ? 'Collapse timestamps' : 'Show timestamps'}
            style={timestampsPosition === 'bottom' ? {
              position: 'absolute',
              top: -14,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 44,
              height: 14,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderBottom: 'none',
              borderRadius: '4px 4px 0 0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
              color: 'var(--text-muted)',
              padding: 0,
              fontSize: 9,
            } : {
              position: 'absolute',
              left: -14,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 14,
              height: 44,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRight: 'none',
              borderRadius: '4px 0 0 4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
              color: 'var(--text-muted)',
              padding: 0,
              fontSize: 9,
            }}
          >
            {timestampsPosition === 'bottom' ? (sidebarOpen ? '⌄' : '⌃') : (sidebarOpen ? '›' : '‹')}
          </button>

          <div style={timestampsPosition === 'bottom' ? {
            height: sidebarOpen ? 220 : 0,
            width: '100%',
            overflow: 'hidden',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            transition: 'height 0.2s ease',
          } : {
            width: sidebarOpen ? 280 : 0,
            overflow: 'hidden',
            borderLeft: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            transition: 'width 0.2s ease',
            height: '100%',
          }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Timestamps</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-muted">{timestamps.length}</span>
              {!isUcatMedia && (
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  title={timestampsPosition === 'bottom' ? 'Move timestamps to the side' : 'Move timestamps to the bottom'}
                  onClick={() => setTimestampsPosition(p => p === 'bottom' ? 'side' : 'bottom')}
                >
                  {timestampsPosition === 'bottom' ? <Columns2 size={12} /> : <Rows2 size={12} />}
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {timestamps.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 10px' }}>
                <Clock size={24} />
                <p className="text-sm">No timestamps yet.<br />Click "Add Timestamp" while the video plays.</p>
              </div>
            ) : (
              tagSelectionTargetId != null ? (
                <TagSelectionPanel
                  key={tagSelectionTargetId}
                  timestamp={timestamps.find(ts => ts.id === tagSelectionTargetId) || null}
                  tags={tags}
                  onSelect={(changes) => {
                    if (tagSelectionTargetId != null) {
                      updateTimestamp(tagSelectionTargetId, changes)
                      setTagSelectionTargetId(null)
                    }
                  }}
                  onBack={() => setTagSelectionTargetId(null)}
                />
              ) : (
                timestamps.map(ts => (
                  <TimestampBubble
                    key={ts.id}
                    ts={ts}
                    tags={tags}
                    onSeek={() => seekTo(ts.time_seconds)}
                    onChange={(changes) => updateTimestamp(ts.id, changes)}
                    onDelete={() => deleteTimestamp(ts.id)}
                    onTagClick={() => setTagSelectionTargetId(ts.id)}
                    readOnly={submitted}
                  />
                ))
              )
            )}
          </div>
          </div>
        </div>
        )}
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="modal-overlay" onClick={() => setValidationErrors([])}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={18} color="var(--danger)" />
                <h2>Required questions unanswered</h2>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setValidationErrors([])}><span>✕</span></button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 14 }}>
              Please answer the following required questions before submitting:
            </p>
            <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {validationErrors.map((e, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  <span className="text-secondary">{e.tab} →</span> <strong>{e.question}</strong>
                </li>
              ))}
            </ul>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setValidationErrors([])}>Go back</button>
            </div>
          </div>
        </div>
      )}

      {/* Submit modal */}
      <Modal
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        title="Submit Review"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowSubmit(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit}>Submit</button>
          </>
        }
      >
        <p>Submit your review for <strong>{mediaFile?.name}</strong>? You can still edit it afterwards by clicking "Edit Review".</p>
        <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
          Timestamps: {timestamps.length} · Forms filled: {Object.keys(formInstances).length}
        </p>
      </Modal>

      {showSdmoInfo && (
        <SdmoInfoOverlay allInstructions={allInstructions} onClose={() => setShowSdmoInfo(false)} />
      )}

      {tour.node}
      {syncBasicsTour.node}
    </div>
  )
}

// Full-page reference view for SDMo's two PDF documents — "SDMo Items of
// Inquiry" is no longer a regular workspace tab (removed to reduce clutter
// in the review UI itself), but both documents remain reachable here via the
// "SDMo Items of Inquiry" button. Uses the full project instruction list rather
// than the tab-scoped one, since Items of Inquiry isn't tab-linked anymore.
function SdmoInfoOverlay({ allInstructions, onClose }) {
  const docSlots = [
    { name: 'SDMo Tool', instruction: allInstructions.find(i => i.name === 'SDMo Tool') },
    { name: 'SDMo Items of Inquiry', instruction: allInstructions.find(i => i.name === 'SDMo Items of Inquiry') },
    { name: 'SDMo Conversation Distinctions', instruction: allInstructions.find(i => i.name === 'SDMo Conversation Distinctions') },
  ]
  const [activeDoc, setActiveDoc] = useState(0)
  const current = docSlots[activeDoc]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500, background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14, marginRight: 12 }}>SDMo Reference Documents</span>
          {docSlots.map((slot, i) => (
            <button
              key={slot.name}
              className={activeDoc === i ? 'tab-btn active' : 'tab-btn'}
              onClick={() => setActiveDoc(i)}
              style={!slot.instruction ? { opacity: 0.5 } : undefined}
              title={!slot.instruction ? 'Not found for this project' : undefined}
            >
              {slot.name}{!slot.instruction && ' (not found)'}
            </button>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>
          <X size={13} /> Close
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {!current?.instruction ? (
          <div className="empty-state">
            <p className="text-sm">
              "{current?.name}" could not be found for this project. If this is an existing (not newly
              created) SDMo project, it may need to be re-added under Setup → Instructions.
            </p>
          </div>
        ) : (
          <PdfInstructionFrame instruction={current.instruction} />
        )}
      </div>
    </div>
  )
}

function VideoControls({
  timestamps,
  duration,
  currentTime,
  paused,
  muted,
  tags,
  visible,
  onTogglePlay,
  onSeek,
  onMarkerSeek,
  onToggleMute,
  isFullscreen,
  onToggleFullscreen,
  onFocusChange,
}) {
  const trackRef = useRef(null)
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  function seekFromPointer(e) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    onSeek(pct * duration)
  }

  return (
    <div
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocusChange(false)
      }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '28px 12px 8px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.44) 55%, rgba(0,0,0,0) 100%)',
        color: '#fff',
        pointerEvents: visible ? 'auto' : 'none',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.15s ease, transform 0.15s ease',
        zIndex: 12,
      }}
    >
      {/* Current time, shown above the timeline only while paused */}
      {paused && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 4 }}>
          <span style={{
            fontVariantNumeric: 'tabular-nums', fontSize: 22, fontWeight: 700, color: '#fff',
            background: 'rgba(0,0,0,0.55)', padding: '4px 14px', borderRadius: 7,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}>
            {formatTime(currentTime)}
          </span>
        </div>
      )}

      {/* Seek track */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(currentTime)}
        tabIndex={0}
        onMouseDown={seekFromPointer}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, currentTime - 5)) }
          if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(duration, currentTime + 5)) }
          if (e.key === 'Home') { e.preventDefault(); onSeek(0) }
          if (e.key === 'End') { e.preventDefault(); onSeek(duration) }
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: 16,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {/* Track background + fill */}
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 3,
          transform: 'translateY(-50%)',
          borderRadius: 99,
          background: 'rgba(255,255,255,0.22)',
        }}>
          <div style={{ width: `${progressPct}%`, height: '100%', borderRadius: 99, background: '#fff' }} />
        </div>
        {/* Timestamp markers */}
        {timestamps.map(ts => {
          const tag = findTimestampTag(tags, ts)
          const color = tag?.color || ts.tag_color || '#9ca3af'
          const pct = Math.min(100, Math.max(0, (ts.time_seconds / duration) * 100))
          return (
            <button
              type="button"
              key={ts.id}
              title={`${formatTime(ts.time_seconds)}${ts.tag_label ? ' — ' + ts.tag_label : ''}`}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 10,
                height: 17,
                background: 'transparent',
                border: 'none',
                padding: 0,
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onMarkerSeek(ts.time_seconds) }}
            >
              <span style={{
                width: 3,
                height: 17,
                borderRadius: 99,
                background: color,
              }} />
            </button>
          )
        })}
        {/* Scrub handle */}
        <div style={{
          position: 'absolute',
          left: `${progressPct}%`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          zIndex: 5,
        }} />
      </div>
      {/* Controls row */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className="video-ctrl-btn" onClick={onTogglePlay} title={paused ? 'Play' : 'Pause'}>
          {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
        </button>
        <button type="button" className="video-ctrl-btn" onClick={onToggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, minWidth: 86, color: 'rgba(255,255,255,0.82)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', marginLeft: 2 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="video-ctrl-btn" onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  )
}

function TimestampBubble({ ts, tags, onSeek, onChange, onDelete, onTagClick, readOnly }) {
  const [expanded, setExpanded] = useState(true)
  const tag = findTimestampTag(tags, ts)
  const tagColor = tag?.color || ts.tag_color || null

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderLeft: tagColor ? `3px solid ${tagColor}` : '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'visible',
      flexShrink: 0,
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px 7px 10px' }}>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          style={{ padding: '2px 4px', color: 'var(--accent)', fontFamily: 'monospace', fontSize: 14, fontWeight: 700, flexShrink: 0 }}
          onClick={e => { e.stopPropagation(); onSeek() }}
          title="Seek to timestamp"
        >
          {formatTime(ts.time_seconds)}
        </button>

        {tags.length > 0 && (
          <HoverTooltip inline text={tag?.description || (tag ? 'No description yet' : '')}>
            <button
              disabled={readOnly}
              onClick={() => onTagClick?.()}
              style={{
                fontSize: 13, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
                background: tagColor ? tagColor + '1a' : 'var(--bg-active)',
                color: tagColor || 'var(--text-secondary)',
                border: `1px solid ${tagColor ? tagColor + '44' : 'var(--border)'}`,
                cursor: readOnly ? 'default' : 'pointer',
                fontFamily: 'var(--font)', lineHeight: 1.6, whiteSpace: 'nowrap',
                transition: 'background 0.1s',
              }}
            >
              {tag?.label || 'No tag'}
            </button>
          </HoverTooltip>
        )}

        <div style={{ flex: 1 }} />

        {!readOnly && (
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
        >
          <ChevronDown size={12} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 10px' }}>
          <textarea
            placeholder="Notes…"
            value={ts.notes || ''}
            disabled={readOnly}
            onChange={e => onChange({ notes: e.target.value })}
            rows={2}
            style={{ fontSize: 16, lineHeight: 1.5, resize: 'none', minHeight: 'unset' }}
          />
        </div>
      )}
    </div>
  )
}

// Tag list content for SDMo's merged tags/notes panel — left-click tags the
// current moment and stops there; right-click does the same but also opens
// the notes view, since the (already-expanded-by-default) note field for the
// new timestamp needs to be reachable.
// Custom hover tooltip — replaces the native `title` attribute, which can't
// be resized or sped up (it's rendered by the OS, not the page). Shows after
// a short delay instead of the browser's default ~1s.
function HoverTooltip({ text, children, inline = false }) {
  const [show, setShow] = useState(false)
  const [rect, setRect] = useState(null)
  const timeoutRef = useRef(null)
  const wrapperRef = useRef(null)

  function handleEnter() {
    timeoutRef.current = setTimeout(() => {
      setRect(wrapperRef.current?.getBoundingClientRect() || null)
      setShow(true)
    }, 200)
  }
  function handleLeave() {
    clearTimeout(timeoutRef.current)
    setShow(false)
  }

  return (
    <div ref={wrapperRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave} style={{ position: 'relative', width: inline ? 'auto' : '100%', display: inline ? 'inline-block' : 'block' }}>
      {children}
      {show && text && rect && createPortal(
        <div style={{
          position: 'fixed',
          top: Math.max(4, rect.top - 6),
          right: Math.max(4, window.innerWidth - rect.right),
          transform: 'translateY(-100%)',
          zIndex: 99999,
          background: '#111', color: '#fff', fontSize: 13, fontWeight: 500, padding: '7px 11px',
          borderRadius: 7, maxWidth: 260, width: 'max-content', whiteSpace: 'normal', lineHeight: 1.45,
          boxShadow: '0 4px 14px rgba(0,0,0,0.3)', pointerEvents: 'none',
        }}>
          {text}
        </div>,
        document.body
      )}
    </div>
  )
}

function TagPaletteList({ tags, timestamps = [], onLeftClick, onRightClick, readOnly }) {
  const groupedTags = useMemo(() => {
    const buckets = new Map()
    for (const tagItem of tags) {
      const category = (tagItem.category || '').trim() || 'General'
      if (!buckets.has(category)) buckets.set(category, [])
      buckets.get(category).push(tagItem)
    }
    return Array.from(buckets.entries())
  }, [tags])

  // Same matching logic as FormRenderer's tag_category_presence computation
  // (id primarily, falling back to label) — this needs to stay in sync with
  // that, since it's now the only visible indicator of presence at all; the
  // form question itself no longer renders.
  function categoryHasPresence(category) {
    return timestamps.some(ts => {
      const tag = tags.find(t => String(t.id) === String(ts.tag_id) || (t.label && t.label === ts.tag_label))
      return tag && (tag.category || '').trim() === category
    })
  }

  if (groupedTags.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 2px' }}>No tags are available for this media type yet.</div>
  }

  return (
    <>
      {groupedTags.map(([category, categoryTags]) => {
        const present = categoryHasPresence(category)
        return (
        <div key={category}>
          <div style={{
            padding: '8px 2px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
            display: 'flex', alignItems: 'center', gap: 5,
            color: present ? 'var(--success)' : 'var(--text-muted)',
            transition: 'color 0.15s',
          }}>
            {present && <CheckCircle2 size={12} strokeWidth={2.5} />}
            {category}
          </div>
          {categoryTags.map(t => (
            <HoverTooltip key={tagOptionValue(t)} text={t.description || 'No description yet'}>
              <button
                disabled={readOnly}
                className="dropdown-item"
                onClick={() => onLeftClick(t)}
                onContextMenu={e => { e.preventDefault(); onRightClick(t) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color || '#9ca3af', flexShrink: 0 }} />
                {t.label}
              </button>
            </HoverTooltip>
          ))}
        </div>
        )
      })}
    </>
  )
}

function TagSelectionPanel({ timestamp, tags, onSelect, onBack }) {
  const groupedTags = useMemo(() => {
    const buckets = new Map()
    for (const tagItem of tags) {
      const category = (tagItem.category || '').trim()
      const bucket = category || 'General'
      if (!buckets.has(bucket)) buckets.set(bucket, [])
      buckets.get(bucket).push(tagItem)
    }
    return Array.from(buckets.entries())
  }, [tags])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Choose a tag</div>
          {timestamp && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTime(timestamp.time_seconds)}</div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button>
      </div>
      <button
        className="dropdown-item"
        onClick={() => onSelect({ tag_id: null, tag_label: null, tag_color: null })}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border-strong)', flexShrink: 0 }} />
        No tag
      </button>
      {groupedTags.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 2px' }}>No tags are available for this media type yet.</div>
      ) : (
        groupedTags.map(([category, categoryTags]) => (
          <div key={category}>
            <div style={{ padding: '8px 2px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
              {category}
            </div>
            {categoryTags.map(t => (
              <HoverTooltip key={tagOptionValue(t)} text={t.description || 'No description yet'}>
                <button
                  className="dropdown-item"
                  onClick={() => onSelect({ tag_id: t.id, tag_label: t.label, tag_color: t.color || null })}
                  style={{ width: '100%' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color || '#9ca3af', flexShrink: 0 }} />
                  {t.label}
                </button>
              </HoverTooltip>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function WorkspaceTabContent({ tab, formSchema, instruction, instances = [], activeInstanceKey, responses, onSave, onSwitchInstance, onAddInstance, onRemoveInstance, readOnly, timestamps = [], tags = [] }) {
  if (!tab) return null
  if (tab.tab_type === 'form') {
    if (!formSchema) return <div className="empty-state"><p className="text-sm">Form not found.</p></div>
    const roles = formSchema.schema?.multi_instance_roles
    const multiInstanceEnabled = Array.isArray(roles) && roles.length > 0
    // Strictly require choosing a role before any question can be answered —
    // otherwise it's possible to type answers with no role attached at all,
    // which then can't be matched to Trainee/Consultant in agreement/reliability.
    if (multiInstanceEnabled && instances.length === 0) {
      return <FormInstancePrompt roles={roles} onAdd={onAddInstance} readOnly={readOnly} />
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {multiInstanceEnabled && (
          <FormInstanceSwitcher
            instances={instances}
            activeInstanceKey={activeInstanceKey}
            roles={roles}
            onSwitch={onSwitchInstance}
            onAdd={onAddInstance}
            onRemove={onRemoveInstance}
            readOnly={readOnly}
          />
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: multiInstanceEnabled ? '0 20px 20px' : 0 }}>
          <FormRenderer schema={formSchema.schema} responses={responses || {}} onSave={onSave} readOnly={readOnly} timestamps={timestamps} tags={tags} />
        </div>
      </div>
    )
  }
  if (tab.tab_type === 'instruction') {
    if (instruction?.content_type === 'pdf') {
      return <PdfInstructionFrame instruction={instruction} />
    }
    const content = instruction?.content || ''
    return (
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    )
  }
  return null
}

// Lets someone switch between, add, or remove repeatable instances of the
// same form within one review (e.g. "Trainee 1", "Consultant 1") — only
// rendered when the form's schema opts in via multi_instance_roles.
// Shown instead of the form itself when a multi-instance form has zero
// instances yet — forces choosing a role before any question is reachable,
// so an answer can never end up saved with no role attached.
function FormInstancePrompt({ roles, onAdd, readOnly }) {
  if (readOnly) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <p className="text-sm">No responses were recorded for this form.</p>
      </div>
    )
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 14, padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontWeight: 600, fontSize: 15 }}>Who is this for?</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 320 }}>
        Choose a role before filling out this form.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {roles.map(role => (
          <button key={role} className="btn btn-primary btn-sm" onClick={() => onAdd(role)}>
            {role}
          </button>
        ))}
      </div>
    </div>
  )
}

function FormInstanceSwitcher({ instances, activeInstanceKey, roles, onSwitch, onAdd, onRemove, readOnly }) {
  const [pickingRole, setPickingRole] = useState(false)

  function instanceLabel(instance) {
    return instance.instance_role ? `${instance.instance_role} ${instance.instance_order}` : 'Untitled'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
      borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0,
    }}>
      {instances.map(instance => (
        <div
          key={instance.instance_key}
          role="button"
          tabIndex={0}
          onClick={() => onSwitch(instance.instance_key)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSwitch(instance.instance_key) }}
          className={instance.instance_key === activeInstanceKey ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}
        >
          <span>{instanceLabel(instance)}</span>
          {instance.instance_key === activeInstanceKey && !readOnly && instances.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(instance.instance_key) }}
              title={`Remove ${instanceLabel(instance)}`}
              style={{
                display: 'flex', alignItems: 'center', marginLeft: 2, opacity: 0.75,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPickingRole(p => !p)} title="Add another person">
            <Plus size={13} />
          </button>
          {pickingRole && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30,
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: 4, display: 'flex', flexDirection: 'column', minWidth: 140,
            }}>
              {roles.map(role => (
                <button
                  key={role}
                  className="btn btn-ghost btn-sm"
                  style={{ justifyContent: 'flex-start', fontSize: 12 }}
                  onClick={() => { onAdd(role); setPickingRole(false) }}
                >
                  Add {role}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}