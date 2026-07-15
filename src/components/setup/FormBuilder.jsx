import React, { useState } from 'react'
import { ChevronLeft, Plus, Trash2, ChevronDown, ChevronRight, Copy, ImagePlus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../lib/api'
import { AGREEMENT_METHOD_LABELS, defaultAgreementEnabledForType, defaultAgreementMethodForType } from '../../lib/interraterAgreement.mjs'
import Modal from '../ui/Modal'

const ELEMENT_TYPES = [
  { type: 'short_answer', label: 'Short text' },
  { type: 'paragraph', label: 'Long text' },
  { type: 'multiple_choice', label: 'Choose one' },
  { type: 'multiselect', label: 'Choose multiple' },
  { type: 'likert', label: 'Likert Scale' },
  { type: 'likert_group', label: 'Likert Group' },
  { type: 'rating', label: 'Labeled rating' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'slider', label: 'Slider' },
  { type: 'dial', label: 'Dial' },
  { type: 'vertical_slider', label: 'Vertical Slider' },
  { type: 'timestamp_select', label: 'Timestamp picker' },
  { type: 'table', label: 'Grid / table' },
]

const TABLE_COL_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'select', label: 'Dropdown' },
  { type: 'timestamp_select', label: 'Timestamp' },
]

const LIKERT_SCALE_POINTS = [3, 4, 5, 6, 7, 8, 9, 10]

const DEFAULT_QUESTION_WEIGHT_BY_TYPE = {
  table: 0.6,
}

function agreementMethodOptionsForType(type) {
  if (type === 'multiple_choice' || type === 'checkbox') return ['auto', 'percent', 'cohen_kappa']
  if (type === 'likert' || type === 'rating') return ['auto', 'ordinal', 'weighted_kappa', 'percent']
  if (type === 'likert_group') return ['auto', 'item_group', 'weighted_kappa']
  if (type === 'multiselect') return ['auto', 'set_overlap', 'percent']
  if (type === 'slider' || type === 'dial' || type === 'vertical_slider') return ['auto', 'numeric']
  if (type === 'timestamp_select') return ['auto', 'timestamp']
  if (type === 'short_answer' || type === 'paragraph') return ['auto', 'exact_text']
  if (type === 'table') return ['auto', 'item_group']
  return ['auto', 'percent']
}

function agreementWarningForElement(el, enabled, method) {
  if (!enabled) return ''
  const resolved = method === 'auto' ? defaultAgreementMethodForType(el.type) : method
  if ((el.type === 'short_answer' || el.type === 'paragraph') && resolved === 'exact_text') {
    return 'Text agreement uses exact normalized matches only. Most teams leave text questions excluded.'
  }
  if ((resolved === 'cohen_kappa' || resolved === 'weighted_kappa') && el.type !== 'likert_group') {
    return 'Kappa-style methods are most interpretable with exactly two reviewers.'
  }
  if (el.type === 'likert_group' && resolved === 'weighted_kappa') {
    return 'Weighted kappa is calculated per statement, then averaged across the group.'
  }
  return ''
}

function newId() { return `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
function friendlySaveError(e) {
  const msg = e?.message || ''
  if (msg.includes('Project is locked')) return 'Project is locked. Go back to Setup and unlock the project before saving changes.'
  return msg || 'Save failed.'
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}

function assetMarkdownSrc(id) {
  return `./sdmo-image-${id}`
}

function resolveMarkdownAsset(src, assets = []) {
  const id = String(src || '').replace(/^\.\/sdmo-image-/, '').replace(/^sdmo-image-/, '')
  return assets.find(asset => asset.id === id)?.dataUrl || src
}

function shortenMarkdownImageDataUrls(markdown, assets = []) {
  const addedAssets = []
  const next = String(markdown || '').replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g, (match, alt, dataUrl) => {
    const existing = assets.find(asset => asset.dataUrl === dataUrl) || addedAssets.find(asset => asset.dataUrl === dataUrl)
    if (existing) return `![${alt}](${assetMarkdownSrc(existing.id)})`
    const id = newId()
    addedAssets.push({ id, name: alt || 'image', dataUrl })
    return `![${alt || 'image'}](${assetMarkdownSrc(id)})`
  })
  return { content: next, addedAssets }
}

export default function FormBuilder({ projectId, form, onSave, onCancel, onLocked }) {
  const [name, setName] = useState(form.name || '')
  const [sections, setSections] = useState(form.schema?.sections || [])
  const [collapsed, setCollapsed] = useState({})
  const [saving, setSaving] = useState(false)
  const [migrationPreview, setMigrationPreview] = useState(null)
  const [saveError, setSaveError] = useState('')

  async function ensureUnlocked() {
    const unlocked = await api.isProjectUnlocked(projectId)
    if (unlocked) return true
    onLocked?.()
    return false
  }

  function addSection() {
    setSections(s => [...s, { id: newId(), title: 'New Section', description: '', elements: [] }])
  }

  function updateSection(id, changes) {
    setSections(s => s.map(sec => sec.id === id ? { ...sec, ...changes } : sec))
  }

  function removeSection(id) {
    setSections(s => s.filter(sec => sec.id !== id))
  }

  function duplicateSection(sec) {
    const copy = JSON.parse(JSON.stringify(sec))
    copy.id = newId()
    copy.title = sec.title + ' (copy)'
    copy.elements = copy.elements.map(el => ({ ...el, id: newId(), global_agreement_question: false }))
    setSections(s => [...s, copy])
  }

  function addElement(sectionId, type) {
    const el = makeElement(type)
    setSections(s => s.map(sec => sec.id === sectionId ? { ...sec, elements: [...sec.elements, el] } : sec))
  }

  function updateElement(sectionId, elId, changes) {
    setSections(s => s.map(sec => {
      if (changes.global_agreement_question === true) {
        return {
          ...sec,
          elements: sec.elements.map(el => {
            if (sec.id === sectionId && el.id === elId) return { ...el, ...changes }
            if (el.global_agreement_question === true) return { ...el, global_agreement_question: false }
            return el
          }),
        }
      }
      if (sec.id !== sectionId) return sec
      return { ...sec, elements: sec.elements.map(el => el.id === elId ? { ...el, ...changes } : el) }
    }))
  }

  function removeElement(sectionId, elId) {
    setSections(s => s.map(sec => {
      if (sec.id !== sectionId) return sec
      return { ...sec, elements: sec.elements.filter(el => el.id !== elId) }
    }))
  }

  async function doSave() {
    if (!name.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      if (!(await ensureUnlocked())) return
      const savedId = await api.saveForm(projectId, { id: form.id || undefined, name: name.trim(), schema: { sections } })
      onSave()
    } catch (e) {
      console.error('[FormBuilder] save failed:', e)
      setSaveError(friendlySaveError(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!name.trim()) return
    if (form.id) {
      setSaving(true)
      setSaveError('')
      try {
        if (!(await ensureUnlocked())) return
        const preview = await api.previewStructureMigration(projectId, { kind: 'form', id: form.id, scope: 'all' })
        if ((preview?.total || 0) > 0) {
          setMigrationPreview(preview)
          return
        }
      } catch (e) {
        console.error('[FormBuilder] migration preview failed:', e)
        setSaveError(friendlySaveError(e))
        return
      } finally {
        setSaving(false)
      }
    }
    doSave()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onCancel}><ChevronLeft size={16} /></button>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Form name"
            style={{ fontWeight: 600, fontSize: 14, border: 'none', background: 'transparent', outline: 'none', width: 240, padding: 0 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save Form'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '28px 0' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {saveError && !migrationPreview && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', color: '#991b1b', fontSize: 13 }}>
              {saveError}
            </div>
          )}
          {sections.map(sec => (
            <SectionEditor
              key={sec.id}
              section={sec}
              collapsed={!!collapsed[sec.id]}
              onToggle={() => setCollapsed(c => ({ ...c, [sec.id]: !c[sec.id] }))}
              onChange={(changes) => updateSection(sec.id, changes)}
              onRemove={() => removeSection(sec.id)}
              onDuplicate={() => duplicateSection(sec)}
              onAddElement={(type) => addElement(sec.id, type)}
              onUpdateElement={(elId, changes) => updateElement(sec.id, elId, changes)}
              onRemoveElement={(elId) => removeElement(sec.id, elId)}
            />
          ))}
          <button className="btn btn-secondary" onClick={addSection} style={{ alignSelf: 'flex-start' }}>
            <Plus size={14} /> Add Section
          </button>
        </div>
      </div>

      <Modal
        open={!!migrationPreview}
        onClose={() => !saving && setMigrationPreview(null)}
        title="Apply Form Changes?"
        size="modal-lg"
        footer={
          <>
            <button className="btn btn-secondary" disabled={saving} onClick={() => setMigrationPreview(null)}>Cancel</button>
            <button className={(migrationPreview?.submitted || 0) > 0 ? 'btn btn-danger' : 'btn btn-primary'} disabled={saving} onClick={doSave}>
              {saving ? 'Saving…' : (migrationPreview?.submitted || 0) > 0 ? 'Save and Reopen Reviews' : 'Save and Apply'}
            </button>
          </>
        }
      >
        {migrationPreview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.5 }}>
            {saveError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10, color: '#991b1b' }}>
                {saveError}
              </div>
            )}
            <p style={{ margin: 0 }}>
              This form is already used by <strong>{migrationPreview.total}</strong> review{migrationPreview.total !== 1 ? 's' : ''}.
              Saving will apply the latest form to every matching review.
            </p>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div><strong>{migrationPreview.drafts}</strong> draft review{migrationPreview.drafts !== 1 ? 's' : ''}</div>
              <div><strong>{migrationPreview.submitted}</strong> submitted review{migrationPreview.submitted !== 1 ? 's' : ''}</div>
            </div>
            {(migrationPreview.submitted || 0) > 0 ? (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, color: '#991b1b' }}>
                Submitted reviews will be reopened as drafts. Existing answers are preserved by question ID where possible.
              </div>
            ) : (
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, color: 'var(--text-secondary)' }}>
                Existing draft answers are preserved by question ID where possible.
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function SectionEditor({ section, collapsed, onToggle, onChange, onRemove, onDuplicate, onAddElement, onUpdateElement, onRemoveElement }) {
  const [showAddEl, setShowAddEl] = useState(false)
  const dropdownRef = React.useRef(null)

  React.useEffect(() => {
    if (!showAddEl) return
    const handler = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowAddEl(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAddEl])

  return (
    <section style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onToggle}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <input
          value={section.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="Section title"
          style={{ flex: 1, fontWeight: 700, fontSize: 15, border: 'none', background: 'transparent', outline: 'none', padding: 0, boxShadow: 'none' }}
        />
        <button className="btn btn-ghost btn-icon btn-sm" title="Duplicate section" onClick={onDuplicate}><Copy size={13} /></button>
        <button className="btn btn-ghost btn-icon btn-sm" title="Remove section" onClick={onRemove}><Trash2 size={13} /></button>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 0 0 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={section.description || ''}
            onChange={e => onChange({ description: e.target.value })}
            placeholder="Section description (optional)"
            rows={2}
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              border: 'none',
              background: 'transparent',
              padding: '2px 0 8px',
              boxShadow: 'none',
              resize: 'vertical',
              minHeight: 42,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          />

          {section.elements.map((el, elementIndex) => {
            const questionNumber = (section.elements || [])
              .slice(0, elementIndex + 1)
              .filter(item => item.type !== 'text_block').length
            return (
              <ElementEditor
                key={el.id}
                el={el}
                questionNumber={questionNumber}
                onChange={changes => onUpdateElement(el.id, changes)}
                onRemove={() => onRemoveElement(el.id)}
              />
            )
          })}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddEl(s => !s)}>
                <Plus size={13} /> Add Question
              </button>
              {showAddEl && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 9999,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 8, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', minWidth: 180, marginTop: 4,
                }}>
                  {ELEMENT_TYPES.map(et => (
                    <button key={et.type} className="dropdown-item" onClick={() => { onAddElement(et.type); setShowAddEl(false) }}>
                      {et.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onAddElement('text_block')}>
              <ImagePlus size={13} /> Add Instructions / Image
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function questionShapeBadge(el) {
  if (el.type === 'multiple_choice' || el.type === 'multiselect' || el.type === 'rating') {
    const count = (el.options || []).filter(Boolean).length
    return count > 0 ? { label: `${count} option${count === 1 ? '' : 's'}`, tone: 'muted' } : null
  }
  if (el.type === 'likert') return { label: `${el.scale || 5} pt`, tone: 'muted' }
  if (el.type === 'likert_group') {
    const count = (el.items || []).filter(item => item.label).length || (el.items || []).length
    return { label: `${count} statement${count === 1 ? '' : 's'}`, tone: 'muted' }
  }
  if (el.type === 'table') {
    const rowCount = (el.rows || []).length
    const colCount = (el.columns || []).length
    return { label: `${rowCount}x${colCount}`, tone: 'muted' }
  }
  if (el.type === 'slider' || el.type === 'dial' || el.type === 'vertical_slider') {
    return (el.count || 1) > 1 ? { label: `${el.count} controls`, tone: 'muted' } : null
  }
  return null
}

function QuestionBadge({ tone = 'muted', children }) {
  const tones = {
    muted: { background: 'var(--bg-active)', color: 'var(--text-secondary)' },
    accent: { background: 'var(--accent-light)', color: 'var(--accent)' },
    success: { background: 'var(--success-light)', color: 'var(--success)' },
    warning: { background: 'var(--warning-light)', color: 'var(--warning)' },
  }
  return (
    <span style={{
      ...tones[tone],
      display: 'inline-flex',
      alignItems: 'center',
      height: 20,
      padding: '0 7px',
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      lineHeight: 1,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function controlLabelFallback(type, index, count) {
  if (count > 1) return `${type === 'dial' ? 'Dial' : 'Slider'} ${index + 1}`
  return type === 'dial' ? 'Dial' : 'Slider'
}

function ElementEditor({ el, questionNumber, onChange, onRemove }) {
  const [open, setOpen] = useState(() => !el.label && !(el.type === 'text_block' && el.content))
  const [agrOpen, setAgrOpen] = useState(false)
  const typeLabel = el.type === 'text_block' ? 'Instructions / image' : ELEMENT_TYPES.find(t => t.type === el.type)?.label
  const labelText = el.type === 'text_block'
    ? (el.content ? el.content.replace(/[#*_`[\]()!]/g, '').trim().split('\n').find(Boolean) : '')
    : el.label
  const summaryText = labelText || (el.type === 'text_block' ? 'Instructions / image block' : `Question ${questionNumber || ''}`.trim())
  const summaryAgrEnabled = el.type !== 'text_block' && (el.agreement_enabled ?? defaultAgreementEnabledForType(el.type))
  const summaryBadges = [
    { label: typeLabel || 'Question', tone: 'muted' },
    el.required ? { label: 'Required', tone: 'accent' } : null,
    el.has_na ? { label: 'N/A', tone: 'muted' } : null,
    summaryAgrEnabled ? { label: 'Agreement', tone: 'success' } : null,
    el.global_agreement_question ? { label: 'Final eval', tone: 'warning' } : null,
    questionShapeBadge(el),
  ].filter(Boolean)
  const shellStyle = {
    borderRadius: 8,
    background: open ? 'var(--bg-secondary)' : 'transparent',
    boxShadow: open ? 'inset 0 0 0 1px var(--border)' : 'none',
    transition: 'background 0.12s, box-shadow 0.12s',
  }

  function SummaryRow({ children }) {
    return (
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Expand question"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 10px', border: 'none', background: 'transparent',
          borderRadius: 8, cursor: 'pointer', textAlign: 'left',
          fontFamily: 'var(--font)', color: 'var(--text)',
        }}
      >
        {children}
      </button>
    )
  }

  if (!open) {
    return (
      <div style={shellStyle}>
        <SummaryRow>
          <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: el.label || el.content ? 'var(--border-strong)' : 'var(--warning)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: labelText ? 'var(--text)' : 'var(--text-muted)' }}>
            {summaryText}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {summaryBadges.map(badge => (
              <QuestionBadge key={badge.label} tone={badge.tone}>{badge.label}</QuestionBadge>
            ))}
          </span>
        </SummaryRow>
      </div>
    )
  }

  if (el.type === 'text_block') {
    return (
      <div style={{ ...shellStyle, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 0 12px' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Text / Image Block</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-ghost btn-sm" title="Collapse question" onClick={() => setOpen(false)}><ChevronDown size={13} /> Collapse</button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onRemove}><Trash2 size={12} /></button>
          </div>
        </div>
        <div style={{ padding: 12 }}>
          <MarkdownBlockEditor
            value={el.content || ''}
            assets={el.assets || []}
            onChange={changes => onChange(changes)}
          />
        </div>
      </div>
    )
  }

  const agrEnabled = summaryAgrEnabled
  const agrOptions = agreementMethodOptionsForType(el.type)
  const agrMethod = agrOptions.includes(el.agreement_method) ? el.agreement_method : 'auto'
  const resolvedAgrMethod = agrMethod === 'auto' ? defaultAgreementMethodForType(el.type) : agrMethod
  const agrSummary = agrEnabled ? (AGREEMENT_METHOD_LABELS[resolvedAgrMethod] || resolvedAgrMethod) : 'Excluded'

  const hasTypeContent =
    el.type === 'multiple_choice' || el.type === 'multiselect' || el.type === 'rating' ||
    el.type === 'likert' || el.type === 'likert_group' ||
    el.type === 'slider' || el.type === 'dial' || el.type === 'vertical_slider' ||
    el.type === 'short_answer' || el.type === 'paragraph' || el.type === 'table'

  return (
    <div style={{ ...shellStyle, overflow: 'hidden' }}>
      {/* Label + compact properties bar */}
      <div style={{ padding: '12px 12px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <input
          value={el.label || ''}
          onChange={e => onChange({ label: e.target.value })}
          placeholder={
            el.type === 'likert_group' ? 'Group header (optional)' :
            `Question ${questionNumber || ''}`.trim()
          }
          style={{ fontWeight: 500 }}
        />
        <textarea
          value={el.description || ''}
          onChange={e => onChange({ description: e.target.value })}
          placeholder="Question description (optional)"
          rows={2}
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            minHeight: 42,
            lineHeight: 1.45,
            resize: 'vertical',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge badge-muted" style={{ fontSize: 10 }}>{typeLabel}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', marginBottom: 0 }}>
            <input type="checkbox" checked={!!el.required} onChange={e => onChange({ required: e.target.checked })} />
            Required
          </label>
          {el.type !== 'table' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', marginBottom: 0 }}>
              <input type="checkbox" checked={!!el.has_na} onChange={e => onChange({ has_na: e.target.checked })} />
              N/A
            </label>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" title="Collapse question" onClick={() => setOpen(false)}><ChevronDown size={13} /> Collapse</button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onRemove}><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Type-specific controls */}
      {hasTypeContent && (
        <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(el.type === 'multiple_choice' || el.type === 'multiselect' || el.type === 'rating') && (
            <OptionsEditor options={el.options || []} onChange={opts => onChange({ options: opts })} />
          )}

          {el.type === 'likert' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="form-field" style={{ flex: '0 0 84px' }}>
                <label>Points</label>
                <select value={el.scale || 5} onChange={e => onChange({ scale: Number(e.target.value) })} style={{ height: 32, fontSize: 13 }}>
                  {LIKERT_SCALE_POINTS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label>← Low end</label>
                <input value={el.low_label || ''} onChange={e => onChange({ low_label: e.target.value })} placeholder="e.g. Strongly Disagree" style={{ height: 32, fontSize: 13 }} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label>High end →</label>
                <input value={el.high_label || ''} onChange={e => onChange({ high_label: e.target.value })} placeholder="e.g. Strongly Agree" style={{ height: 32, fontSize: 13 }} />
              </div>
            </div>
          )}

          {el.type === 'likert_group' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Scale</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div className="form-field" style={{ flex: '0 0 84px' }}>
                    <label>Points</label>
                    <select value={el.scale || 5} onChange={e => onChange({ scale: Number(e.target.value) })} style={{ height: 32, fontSize: 13 }}>
                      {LIKERT_SCALE_POINTS.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label>← Low end</label>
                    <input value={el.low_label || ''} onChange={e => onChange({ low_label: e.target.value })} placeholder="e.g. Strongly Disagree" style={{ height: 32, fontSize: 13 }} />
                  </div>
                  <div className="form-field" style={{ flex: 1 }}>
                    <label>High end →</label>
                    <input value={el.high_label || ''} onChange={e => onChange({ high_label: e.target.value })} placeholder="e.g. Strongly Agree" style={{ height: 32, fontSize: 13 }} />
                  </div>
                </div>
              </div>
              <LikertGroupItemsEditor items={el.items || []} onChange={items => onChange({ items })} />
            </div>
          )}

          {(el.type === 'slider' || el.type === 'dial' || el.type === 'vertical_slider') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['min','Min',0],['max','Max',100],['step','Step',1]].map(([key,lbl,def]) => (
                  <div key={key} className="form-field" style={{ flex: 1 }}>
                    <label>{lbl}</label>
                    <input type="number" value={el[key] ?? def} onChange={e => onChange({ [key]: Number(e.target.value) })} style={{ height: 32, fontSize: 13 }} />
                  </div>
                ))}
                <div className="form-field" style={{ flex: 1 }}>
                  <label title="How many independent controls to show"># Controls</label>
                  <input type="number" min={1} max={5} value={el.count ?? 1} onChange={e => onChange({ count: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} style={{ height: 32, fontSize: 13 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label>← Low end</label>
                  <input value={el.low_label || ''} onChange={e => onChange({ low_label: e.target.value })} placeholder="e.g. Low" style={{ height: 32, fontSize: 13 }} />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label>High end →</label>
                  <input value={el.high_label || ''} onChange={e => onChange({ high_label: e.target.value })} placeholder="e.g. High" style={{ height: 32, fontSize: 13 }} />
                </div>
              </div>
              {el.type === 'slider' && (
                <SliderScaleLabelsEditor
                  labels={el.scale_labels || []}
                  min={el.min ?? 0}
                  max={el.max ?? 100}
                  step={el.step ?? 1}
                  onChange={scaleLabels => onChange({ scale_labels: scaleLabels })}
                />
              )}
              {(el.count || 1) > 1 && (
                <ControlSettingsEditor
                  type={el.type}
                  count={Math.min(5, Math.max(1, Number(el.count || 1)))}
                  labels={el.control_labels || []}
                  lowLabels={el.control_low_labels || []}
                  highLabels={el.control_high_labels || []}
                  sharedLowLabel={el.low_label || ''}
                  sharedHighLabel={el.high_label || ''}
                  onChange={changes => onChange(changes)}
                />
              )}
            </div>
          )}

          {(el.type === 'short_answer' || el.type === 'paragraph') && (
            <input value={el.placeholder || ''} onChange={e => onChange({ placeholder: e.target.value })} placeholder="Placeholder text (optional)" style={{ fontSize: 13 }} />
          )}

          {el.type === 'table' && (
            <TableEditor
              rows={el.rows || []}
              columns={el.columns || []}
              onRowsChange={rows => onChange({ rows })}
              onColumnsChange={columns => onChange({ columns })}
            />
          )}
        </div>
      )}

      {/* Agreement — collapsible */}
      <div>
        <button
          onClick={() => setAgrOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px 9px', fontSize: 12, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--text-secondary)', textAlign: 'left',
          }}
        >
          {agrOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span style={{ fontWeight: 500 }}>Agreement</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>· {agrSummary}</span>
        </button>
        {agrOpen && (
          <div style={{ padding: '0 12px 12px' }}>
            <AgreementSettingsEditor el={el} onChange={onChange} />
          </div>
        )}
      </div>
    </div>
  )
}

function AgreementSettingsEditor({ el, onChange }) {
  const enabled = el.agreement_enabled ?? defaultAgreementEnabledForType(el.type)
  const options = agreementMethodOptionsForType(el.type)
  const method = options.includes(el.agreement_method) ? el.agreement_method : 'auto'
  const weight = el.agreement_weight ?? DEFAULT_QUESTION_WEIGHT_BY_TYPE[el.type] ?? 1
  const warning = agreementWarningForElement(el, enabled, method)
  const canBeFinalEvaluation = el.type !== 'text_block'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 0 }}>
        <input
          type="checkbox"
          checked={!!enabled}
          onChange={e => onChange({ agreement_enabled: e.target.checked })}
        />
        Include in agreement
      </label>
      {enabled && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 88px', gap: 8 }}>
          <div className="form-field" style={{ margin: 0 }}>
            <label>Method</label>
            <select
              value={method}
              onChange={e => onChange({ agreement_method: e.target.value })}
              style={{ height: 32, fontSize: 12 }}
            >
              {options.map(option => (
                <option key={option} value={option}>{AGREEMENT_METHOD_LABELS[option] || option}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label>Weight</label>
            <input
              type="number"
              min="0"
              max="3"
              step="0.1"
              value={weight}
              onChange={e => onChange({ agreement_weight: Number(e.target.value) || 0 })}
              style={{ height: 32, fontSize: 12 }}
            />
          </div>
        </div>
      )}
      {canBeFinalEvaluation && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, cursor: 'pointer', marginBottom: 0, lineHeight: 1.35 }}>
          <input
            type="checkbox"
            checked={el.global_agreement_question === true}
            onChange={e => onChange({ global_agreement_question: e.target.checked })}
            style={{ marginTop: 2 }}
          />
          <span>
            <strong>Use as final evaluation question</strong>
            <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 400 }}>
              Used for Final Evaluation Agreement in data visualization.
            </span>
          </span>
        </label>
      )}
      {warning && (
        <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 5, padding: '6px 8px', lineHeight: 1.4 }}>
          {warning}
        </div>
      )}
    </div>
  )
}

function MarkdownBlockEditor({ value, assets, onChange }) {
  const textareaRef = React.useRef(null)
  const fileInputRef = React.useRef(null)
  const [imageError, setImageError] = useState('')

  React.useEffect(() => {
    if (!value.includes('data:image/')) return
    const shortened = shortenMarkdownImageDataUrls(value, assets)
    if (shortened.addedAssets.length === 0 && shortened.content === value) return
    onChange({ content: shortened.content, assets: [...assets, ...shortened.addedAssets] })
  }, [value, assets, onChange])

  function insertMarkdown(markdown, extraChanges = {}) {
    const textarea = textareaRef.current
    if (!textarea) {
      onChange({ ...extraChanges, content: `${value || ''}${markdown}` })
      return
    }
    const currentValue = textarea.value
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const prefix = currentValue.slice(0, start)
    const suffix = currentValue.slice(end)
    const needsLeadingBreak = prefix && !prefix.endsWith('\n') ? '\n' : ''
    const needsTrailingBreak = suffix && !suffix.startsWith('\n') ? '\n' : ''
    const next = `${prefix}${needsLeadingBreak}${markdown}${needsTrailingBreak}${suffix}`
    const cursor = prefix.length + needsLeadingBreak.length + markdown.length
    onChange({ ...extraChanges, content: next })
    textarea.value = next
    textarea.setSelectionRange(cursor, cursor)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  async function insertImageFile(file) {
    if (!file) return
    if (!file.type?.startsWith('image/')) {
      setImageError('Only image files can be added here.')
      return
    }
    setImageError('')
    try {
      const dataUrl = await fileToDataUrl(file)
      const safeName = (file.name || 'pasted-image').replace(/[\]\n\r]/g, ' ').trim() || 'image'
      const id = newId()
      insertMarkdown(`![${safeName}](${assetMarkdownSrc(id)})`, {
        assets: [...assets, { id, name: safeName, dataUrl }],
      })
    } catch (e) {
      console.error('[FormBuilder] image insert failed:', e)
      setImageError('Could not add that image.')
    }
  }

  async function handlePaste(e) {
    const imageItem = Array.from(e.clipboardData?.items || []).find(item => item.type?.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    await insertImageFile(imageItem.getAsFile())
  }

  async function handleFiles(files) {
    const imageFiles = Array.from(files || []).filter(file => file.type?.startsWith('image/'))
    if (imageFiles.length === 0) {
      if ((files || []).length > 0) setImageError('Only image files can be added here.')
      return
    }
    setImageError('')
    try {
      const addedAssets = []
      const markdown = []
      for (const file of imageFiles) {
        const dataUrl = await fileToDataUrl(file)
        const safeName = (file.name || 'uploaded-image').replace(/[\]\n\r]/g, ' ').trim() || 'image'
        const id = newId()
        addedAssets.push({ id, name: safeName, dataUrl })
        markdown.push(`![${safeName}](${assetMarkdownSrc(id)})`)
      }
      insertMarkdown(markdown.join('\n'), { assets: [...assets, ...addedAssets] })
    } catch (e) {
      console.error('[FormBuilder] image insert failed:', e)
      setImageError('Could not add one of those images.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => {
          const shortened = shortenMarkdownImageDataUrls(e.target.value, assets)
          onChange({
            content: shortened.content,
            ...(shortened.addedAssets.length > 0 ? { assets: [...assets, ...shortened.addedAssets] } : {}),
          })
        }}
        onPaste={handlePaste}
        placeholder="Write markdown. Paste or upload images to insert them here."
        rows={5}
        style={{ fontSize: 13, minHeight: 130 }}
      />
      <div
        className="prose markdown-live-preview"
        style={{
          minHeight: 120,
          padding: 12,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg-secondary)',
          fontSize: 13,
        }}
      >
        {value ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={url => url}
            components={{
              img: ({ src, alt }) => <img src={resolveMarkdownAsset(src, assets)} alt={alt || ''} />,
            }}
          >
            {value}
          </ReactMarkdown>
        ) : (
          <span className="text-muted">Live preview</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus size={13} /> Upload Image
        </button>
        <span className="text-secondary text-sm" style={{ textAlign: 'right' }}>
          Supports markdown plus pasted or uploaded images.
        </span>
      </div>
      {imageError && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{imageError}</div>}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={e => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
        style={{ display: 'none' }}
      />
    </div>
  )
}

function OptionsEditor({ options, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {options.map((opt, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input value={opt} onChange={e => { const o = [...options]; o[i] = e.target.value; onChange(o) }} style={{ fontSize: 13 }} />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(options.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange([...options, ''])} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
        <Plus size={12} /> Add Option
      </button>
    </div>
  )
}

function SliderScaleLabelsEditor({ labels, min, max, step, onChange }) {
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : 100
  const safeStep = Number(step) > 0 ? Number(step) : 1
  const rows = (labels || []).map(row => ({
    from: row.from ?? row.value ?? safeMin,
    to: row.to ?? row.from ?? row.value ?? row.from ?? safeMin,
    label: row.label || '',
  }))

  function updateRow(index, changes) {
    onChange(rows.map((row, i) => i === index ? { ...row, ...changes } : row))
  }

  function addRow() {
    const last = rows[rows.length - 1]
    const nextFrom = last ? Math.min(safeMax, Number(last.to ?? last.from ?? safeMin) + safeStep) : safeMin
    onChange([...rows, { from: nextFrom, to: nextFrom, label: '' }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Scale meaning labels
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
          Optional. Use ranges for longer meanings, e.g. 2-3 = Probably not.
        </div>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '76px 76px minmax(150px, 1fr) 28px', gap: 6, alignItems: 'center' }}>
          <input
            type="number"
            min={safeMin}
            max={safeMax}
            step={safeStep}
            value={row.from}
            onChange={e => updateRow(i, { from: Number(e.target.value) })}
            aria-label="Scale label from"
            style={{ height: 32, fontSize: 13 }}
          />
          <input
            type="number"
            min={safeMin}
            max={safeMax}
            step={safeStep}
            value={row.to}
            onChange={e => updateRow(i, { to: Number(e.target.value) })}
            aria-label="Scale label to"
            style={{ height: 32, fontSize: 13 }}
          />
          <input
            value={row.label}
            onChange={e => updateRow(i, { label: e.target.value })}
            placeholder={i === 0 ? 'Definitely not' : 'Meaning'}
            style={{ height: 32, fontSize: 13 }}
          />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Remove scale label">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={addRow} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
        <Plus size={12} /> Add Meaning
      </button>
    </div>
  )
}

function ControlSettingsEditor({ type, count, labels, lowLabels, highLabels, sharedLowLabel, sharedHighLabel, onChange }) {
  const safeLabels = Array.from({ length: count }, (_, i) => labels[i] || '')
  const safeLowLabels = Array.from({ length: count }, (_, i) => lowLabels[i] || '')
  const safeHighLabels = Array.from({ length: count }, (_, i) => highLabels[i] || '')

  function updateArray(key, values, index, value) {
    const next = [...values]
    next[index] = value
    onChange({ [key]: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Per-control labels
      </span>
      {safeLabels.map((label, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '20px minmax(160px, 1.8fr) minmax(90px, 1fr) minmax(90px, 1fr)', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{i + 1}.</span>
          <input
            value={label}
            onChange={e => {
              const next = [...safeLabels]
              next[i] = e.target.value
              onChange({ control_labels: next })
            }}
            placeholder={`${controlLabelFallback(type, i, count)} statement`}
            style={{ fontSize: 13, height: 32 }}
          />
          <input
            value={safeLowLabels[i]}
            onChange={e => updateArray('control_low_labels', safeLowLabels, i, e.target.value)}
            placeholder={sharedLowLabel || 'Low end'}
            style={{ fontSize: 13, height: 32 }}
          />
          <input
            value={safeHighLabels[i]}
            onChange={e => updateArray('control_high_labels', safeHighLabels, i, e.target.value)}
            placeholder={sharedHighLabel || 'High end'}
            style={{ fontSize: 13, height: 32 }}
          />
        </div>
      ))}
    </div>
  )
}

function TableEditor({ rows, columns, onRowsChange, onColumnsChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16, alignItems: 'start' }}>
      {/* Rows */}
      <div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>Rows</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 4 }}>
              <input
                value={row}
                onChange={e => { const r = [...rows]; r[i] = e.target.value; onRowsChange(r) }}
                style={{ flex: 1, fontSize: 13 }}
              />
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => onRowsChange([...rows, `Row ${rows.length + 1}`])} style={{ alignSelf: 'flex-start', fontSize: 12, marginTop: 2 }}>
            <Plus size={12} /> Add Row
          </button>
        </div>
      </div>

      {/* Columns */}
      <div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>Columns</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {columns.map((col, i) => (
            <div key={col.id} style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input
                  value={col.label}
                  onChange={e => { const c = columns.map((cc, j) => j === i ? { ...cc, label: e.target.value } : cc); onColumnsChange(c) }}
                  placeholder="Header"
                  style={{ flex: 1, fontSize: 13 }}
                />
                <select
                  value={col.type}
                  onChange={e => { const c = columns.map((cc, j) => j === i ? { ...cc, type: e.target.value, options: undefined } : cc); onColumnsChange(c) }}
                  style={{ height: 30, fontSize: 12, width: 96, flexShrink: 0 }}
                >
                  {TABLE_COL_TYPES.map(ct => <option key={ct.type} value={ct.type}>{ct.label}</option>)}
                </select>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onColumnsChange(columns.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={!!col.has_na}
                  onChange={e => { const c = columns.map((cc, j) => j === i ? { ...cc, has_na: e.target.checked } : cc); onColumnsChange(c) }}
                />
                N/A option
              </label>
              {col.type === 'select' && (
                <OptionsEditor options={col.options || []} onChange={opts => { const c = columns.map((cc, j) => j === i ? { ...cc, options: opts } : cc); onColumnsChange(c) }} />
              )}
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => onColumnsChange([...columns, { id: newId(), label: `Column ${columns.length + 1}`, type: 'text', has_na: false }])} style={{ alignSelf: 'flex-start', fontSize: 12, marginTop: 2 }}>
            <Plus size={12} /> Add Column
          </button>
        </div>
      </div>
    </div>
  )
}

function LikertGroupItemsEditor({ items, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Statements</span>
      {items.map((item, i) => (
        <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 18, textAlign: 'right' }}>{i + 1}.</span>
          <input
            value={item.label || ''}
            onChange={e => { const arr = items.map((it, j) => j === i ? { ...it, label: e.target.value } : it); onChange(arr) }}
            placeholder="Statement text"
            style={{ flex: 1, fontSize: 13 }}
          />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange([...items, { id: newId(), label: '' }])} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
        <Plus size={12} /> Add Statement
      </button>
    </div>
  )
}

function makeElement(type) {
  const agreement = {
    agreement_enabled: defaultAgreementEnabledForType(type),
    agreement_weight: DEFAULT_QUESTION_WEIGHT_BY_TYPE[type] ?? 1,
    agreement_method: 'auto',
  }
  const base = { id: newId(), type, label: '', description: '', required: false, has_na: false, ...agreement }
  if (type === 'multiple_choice' || type === 'multiselect') return { ...base, options: ['Option 1', 'Option 2'] }
  if (type === 'rating') return { ...base, options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'] }
  if (type === 'likert') return { ...base, scale: 5, low_label: '', high_label: '', has_na: false }
  if (type === 'likert_group') return { id: newId(), type: 'likert_group', label: '', description: '', required: false, scale: 5, low_label: '', high_label: '', has_na: false, items: [{ id: newId(), label: '' }], ...agreement }
  if (type === 'checkbox') return { id: newId(), type: 'checkbox', label: '', required: false, has_na: false, ...agreement }
  if (type === 'slider' || type === 'dial' || type === 'vertical_slider') return { ...base, min: 1, max: 100, step: 1, count: 1, low_label: '', high_label: '', scale_labels: [], control_labels: [], control_low_labels: [], control_high_labels: [] }
  if (type === 'text_block') return { id: newId(), type: 'text_block', content: '', assets: [] }
  if (type === 'timestamp_select') return base
  if (type === 'table') return { ...base, has_na: false, rows: ['Row 1', 'Row 2'], columns: [{ id: newId(), label: 'Column 1', type: 'text', has_na: false }] }
  return base
}
