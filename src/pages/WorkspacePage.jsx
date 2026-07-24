import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Edit2, AlertCircle, Plus, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'
import FormRenderer from '../components/forms/FormRenderer'
import Modal from '../components/ui/Modal'
import PdfViewer from '../components/ui/PdfViewer'

function hydrateWorkspaceSnapshot(snapshot) {
  const formSchemas = {}
  for (const [id, form] of Object.entries(snapshot?.forms || {})) {
    formSchemas[id] = { ...form, schema: form.schema || { sections: [] } }
  }
  const instructions = {}
  for (const [id, instr] of Object.entries(snapshot?.instructions || {})) instructions[id] = instr
  return {
    workspaceTabs: snapshot?.workspace_tabs || [],
    formSchemas,
    instructions,
  }
}

// Groups a review's form_responses by form_id into an ARRAY of instances
// (sorted by role, then creation order) rather than one flat object per form
// — kept identical to ReviewPage.jsx's copy of this logic so the main window
// and pop-out workspace window always agree on the data shape.
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

function reopenedReasonLabel(reason) {
  if (reason === 'form_version_changed') return 'Reopened after form update'
  if (reason === 'media_type_version_changed') return 'Reopened after media type update'
  return 'Reopened'
}

export default function WorkspacePage() {
  const { reviewId } = useParams()

  const [review, setReview] = useState(null)
  const [mediaFile, setMediaFile] = useState(null)
  const [workspaceTabs, setWorkspaceTabs] = useState([])
  const [formSchemas, setFormSchemas] = useState({})
  const [instructions, setInstructions] = useState({})
  const [formInstances, setFormInstances] = useState({}) // { [formId]: [{instance_key, instance_role, instance_order, responses}] }
  const [activeInstanceKey, setActiveInstanceKey] = useState({}) // { [formId]: instance_key }
  const [timestamps, setTimestamps] = useState([])

  const [activeTab, setActiveTab] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showSubmit, setShowSubmit] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])
  const [saveError, setSaveError] = useState(null)

  useEffect(() => { load() }, [reviewId])

  // Single function that refreshes submitted + form data from DB
  function refreshReviewData(id) {
    api.getReview(id).then(rev => {
      if (!rev) return
      setSubmitted(rev.status === 'submitted')
      const byForm = parseFormInstances(rev)
      setFormInstances(byForm)
      setActiveInstanceKey(prev => ({ ...defaultActiveInstances(byForm), ...prev }))
      setTimestamps(rev.timestamps || [])
    })
  }

  // Stay in sync when the main ReviewPage window submits/unsubmits
  useEffect(() => {
    function onReviewUpdated(updatedId) {
      if (String(updatedId) === String(reviewId)) refreshReviewData(reviewId)
    }
    const subId = api.onReviewUpdated(onReviewUpdated)
    return () => api.offReviewUpdated(subId)
  }, [reviewId])

  async function load() {
    setLoading(true)
    const rev = await api.getReview(reviewId)
    if (!rev) { setLoading(false); return }
    setReview(rev)
    setSubmitted(rev.status === 'submitted')
    setTimestamps(rev.timestamps || [])

    const respByForm = parseFormInstances(rev)
    setFormInstances(respByForm)
    setActiveInstanceKey(defaultActiveInstances(respByForm))

    const mf = await api.getMediaFile(rev.media_file_id)
    setMediaFile(mf)
    if (!mf?.encounter_id) { setLoading(false); return }

    const enc = await api.getEncounter(mf.encounter_id)
    if (!enc) { setLoading(false); return }

    if (rev.workspace_snapshot) {
      const frozen = hydrateWorkspaceSnapshot(rev.workspace_snapshot)
      const needsPdfPathPatch = Object.values(frozen.instructions || {}).some(instr => instr?.content_type === 'pdf' && !instr.file_path)
      const liveInstructions = needsPdfPathPatch ? await api.listInstructions(enc.project_id) : []
      setWorkspaceTabs(frozen.workspaceTabs)
      setFormSchemas(frozen.formSchemas)
      setInstructions(patchSnapshotPdfPaths(frozen.instructions, liveInstructions))
      setLoading(false)
      return
    }

    const allTypes = await api.listMediaTypes(enc.project_id)
    const mt = allTypes.find(t => t.id === mf.media_type_id)
    if (!mt) { setLoading(false); return }

    setWorkspaceTabs(mt.workspace_tabs || [])

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
    setLoading(false)
  }

  const saveFormResponse = useCallback(async (formId, instanceKey, responses) => {
    try {
      const instances = formInstances[formId] || []
      const instance = instances.find(i => i.instance_key === instanceKey)
      await api.saveFormResponse(reviewId, {
        form_id: formId,
        instance_key: instanceKey,
        instance_role: instance?.instance_role || null,
        instance_order: instance?.instance_order || 0,
        responses,
      })
      setFormInstances(prev => ({
        ...prev,
        [formId]: (prev[formId] || []).map(i => i.instance_key === instanceKey ? { ...i, responses } : i),
      }))
      setSaveError(null)
      api.notifyReviewUpdate(reviewId).catch(() => {})
    } catch (e) {
      console.error('[WorkspacePage] saveFormResponse failed:', e)
      setSaveError('Save failed — check console for details.')
    }
  }, [reviewId, formInstances])

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
    api.notifyReviewUpdate(reviewId).catch(() => {})
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
    api.notifyReviewUpdate(reviewId).catch(() => {})
  }

  function isRequiredResponseAnswered(value) {
    if (value === 'N/A' || (value && typeof value === 'object' && !Array.isArray(value) && value.__na === true)) return true
    if (value === undefined || value === null || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  }

  function isRequiredElementComplete(el, value) {
    if (el.type === 'checkbox') {
      return value === true || value === 'N/A' || (value && typeof value === 'object' && !Array.isArray(value) && value.__na === true)
    }
    if (el.type === 'likert_group') {
      const items = el.items || []
      if (items.length === 0) return false
      const groupVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
      return items.every(item => isRequiredResponseAnswered(groupVal[item.id]))
    }
    if (el.type === 'table') {
      const rows = el.rows || []
      const columns = el.columns || []
      if (rows.length === 0 || columns.length === 0) return false
      const tableVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
      return rows.every((_, rowIndex) => {
        const rowVal = (tableVal[String(rowIndex)] && typeof tableVal[String(rowIndex)] === 'object') ? tableVal[String(rowIndex)] : {}
        return columns.every(col => isRequiredResponseAnswered(rowVal[col.id]))
      })
    }
    return isRequiredResponseAnswered(value)
  }

  function requiredElementLabel(el, questionNumber) {
    return el.label || `Question ${questionNumber || ''}`.trim()
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
        if (isMultiInstance) errors.push({ tab: tab.label, question: 'Choose a role and fill out this form before submitting.' })
        continue
      }

      for (const instance of instances) {
      const responses = instance.responses || {}
      const instanceLabel = instance.instance_role ? `${instance.instance_role} ${instance.instance_order}` : null
      const tabLabel = instanceLabel ? `${tab.label} — ${instanceLabel}` : tab.label

      // Relaxed completion mode: the form only needs at least one answerable
      // question filled in, regardless of each question's individual `required`
      // flag. Older forms have no `completion_mode` set and keep the original
      // all-required behavior below. Kept identical to ReviewPage.jsx's copy
      // of this logic so the main window and pop-out workspace window always
      // agree on whether a review is submittable.
      if (form.schema.completion_mode === 'at_least_one') {
        // Treat each ROW inside a likert_group/table as its own answerable
        // question, not the whole group — otherwise a required likert_group
        // (which needs every row filled to count as "complete") defeats the
        // entire point of relaxed completion mode. Uses isRequiredResponseAnswered
        // directly (a single value's answered-state) rather than
        // isRequiredElementComplete (which enforces "every row" for groups).
        // Kept identical to ReviewPage.jsx's copy of this fix.
        let hasAnswerable = false
        let anyAnswered = false
        for (const section of form.schema.sections) {
          for (const el of (section.elements || [])) {
            if (el.type === 'text_block') continue
            if (el.type === 'likert_group') {
              const groupVal = (responses[el.id] && typeof responses[el.id] === 'object') ? responses[el.id] : {}
              for (const item of (el.items || [])) {
                hasAnswerable = true
                if (isRequiredResponseAnswered(groupVal[item.id])) anyAnswered = true
              }
              continue
            }
            if (el.type === 'table') {
              const tableVal = (responses[el.id] && typeof responses[el.id] === 'object') ? responses[el.id] : {}
              for (const rowIndex of (el.rows || []).keys()) {
                const rowVal = (tableVal[String(rowIndex)] && typeof tableVal[String(rowIndex)] === 'object') ? tableVal[String(rowIndex)] : {}
                for (const col of (el.columns || [])) {
                  hasAnswerable = true
                  if (isRequiredResponseAnswered(rowVal[col.id])) anyAnswered = true
                }
              }
              continue
            }
            hasAnswerable = true
            if (isRequiredResponseAnswered(responses[el.id])) anyAnswered = true
          }
        }
        if (hasAnswerable && !anyAnswered) {
          errors.push({ tab: tabLabel, question: 'At least one question must be answered' })
        }
        continue
      }

      for (const section of form.schema.sections) {
        for (const [elementIndex, el] of (section.elements || []).entries()) {
          if (!el.required) continue
          const val = responses[el.id]
          const questionNumber = (section.elements || [])
            .slice(0, elementIndex + 1)
            .filter(item => item.type !== 'text_block').length
          if (!isRequiredElementComplete(el, val)) {
            errors.push({ tab: tabLabel, question: requiredElementLabel(el, questionNumber) })
          }
        }
      }
      }
    }
    return errors
  }

  function handleSubmitClick() {
    const errors = getRequiredErrors()
    if (errors.length > 0) setValidationErrors(errors)
    else { setValidationErrors([]); setShowSubmit(true) }
  }

  async function handleSubmit() {
    try {
      await api.submitReview(reviewId, {})
      setSubmitted(true)
      setShowSubmit(false)
      setSaveError(null)
      api.notifyReviewUpdate(reviewId).catch(() => {})
    } catch (e) {
      console.error('[WorkspacePage] submitReview failed:', e)
      setSaveError('Submit failed — check console for details.')
    }
  }

  async function handleUnsubmit() {
    try {
      await api.unsubmitReview(reviewId)
      setSubmitted(false)
      setSaveError(null)
      api.notifyReviewUpdate(reviewId).catch(() => {})
    } catch (e) {
      console.error('[WorkspacePage] unsubmitReview failed:', e)
      setSaveError('Unsubmit failed — check console for details.')
    }
  }

  if (loading) return <div className="empty-state" style={{ height: '100vh' }}><div className="spinner" /></div>
  if (!review) return <div className="empty-state" style={{ height: '100vh' }}><p className="text-sm">Review not found.</p></div>

  const currentTab = workspaceTabs[activeTab]
  const isFormWorkspaceTab = currentTab?.tab_type === 'form'
  const isPdfWorkspaceTab = currentTab?.tab_type === 'instruction' && instructions[currentTab?.ref_id]?.content_type === 'pdf'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-muted)' }}>Workspace</span>
          <span style={{ color: 'var(--border)' }}>·</span>
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
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
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

      {/* Save error banner */}
      {saveError && (
        <div style={{ background: 'var(--danger)', color: '#fff', padding: '6px 16px', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span><AlertCircle size={12} style={{ display: 'inline', marginRight: 6 }} />{saveError}</span>
          <button style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14 }} onClick={() => setSaveError(null)}>✕</button>
        </div>
      )}

      {/* Tab bar */}
      {workspaceTabs.length > 0 && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="tabs" style={{ flex: 1, borderBottom: 'none' }}>
            {workspaceTabs.map((tab, i) => (
              <button key={tab.id} className={`tab-btn ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={isPdfWorkspaceTab
        ? { flex: 1, overflow: 'hidden', padding: 0, width: '100%', minHeight: 0, boxSizing: 'border-box' }
        : isFormWorkspaceTab
          ? { flex: 1, overflow: 'auto', padding: '18px 32px 28px', maxWidth: 1120, width: '100%', margin: '0 auto', boxSizing: 'border-box' }
        : { flex: 1, overflow: 'auto', padding: '24px 32px', maxWidth: 1120, width: '100%', margin: '0 auto', boxSizing: 'border-box' }
      }>
        {currentTab ? (
          currentTab.tab_type === 'form' ? (
            formSchemas[currentTab.ref_id]
              ? (() => {
                  const instances = formInstances[currentTab.ref_id] || []
                  const activeKey = activeInstanceKey[currentTab.ref_id]
                  const activeInstance = instances.find(i => i.instance_key === activeKey) || instances[0]
                  const roles = formSchemas[currentTab.ref_id].schema?.multi_instance_roles
                  const multiInstanceEnabled = Array.isArray(roles) && roles.length > 0
                  if (multiInstanceEnabled && instances.length === 0) {
                    return <FormInstancePrompt roles={roles} onAdd={(role) => addFormInstance(currentTab.ref_id, role)} readOnly={submitted} />
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                      {multiInstanceEnabled && (
                        <FormInstanceSwitcher
                          instances={instances}
                          activeInstanceKey={activeInstance?.instance_key}
                          roles={roles}
                          onSwitch={(key) => setActiveInstanceKey(prev => ({ ...prev, [currentTab.ref_id]: key }))}
                          onAdd={(role) => addFormInstance(currentTab.ref_id, role)}
                          onRemove={(key) => removeFormInstance(currentTab.ref_id, key)}
                          readOnly={submitted}
                        />
                      )}
                      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                        <FormRenderer
                          schema={formSchemas[currentTab.ref_id].schema}
                          responses={activeInstance?.responses || {}}
                          onSave={resp => saveFormResponse(currentTab.ref_id, activeInstance?.instance_key ?? '', resp)}
                          readOnly={submitted}
                          timestamps={timestamps}
                        />
                      </div>
                    </div>
                  )
                })()
              : <div className="empty-state"><p className="text-sm">Form not found.</p></div>
          ) : currentTab.tab_type === 'instruction' ? (
            (() => {
              const instr = instructions[currentTab.ref_id]
              if (!instr) return <div className="empty-state"><p className="text-sm">Instruction not found.</p></div>
              if (instr.content_type === 'pdf') {
                return <PdfInstructionFrame instruction={instr} />
              }
              return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{instr.content || ''}</ReactMarkdown></div>
            })()
          ) : null
        ) : (
          <div className="empty-state"><p className="text-sm">No workspace tabs configured for this media type.</p></div>
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
        <p>Submit your review for <strong>{mediaFile?.name}</strong>? You can still edit it afterwards.</p>
        <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
          Forms filled: {Object.keys(formInstances).length}
        </p>
      </Modal>
    </div>
  )
}

// Lets someone switch between, add, or remove repeatable instances of the
// same form within one review (e.g. "Trainee 1", "Consultant 1") — only
// rendered when the form's schema opts in via multi_instance_roles. Kept
// identical to ReviewPage.jsx's copy of this component.
// Shown instead of the form itself when a multi-instance form has zero
// instances yet — forces choosing a role before any question is reachable,
// so an answer can never end up saved with no role attached. Kept identical
// to ReviewPage.jsx's copy of this component.
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