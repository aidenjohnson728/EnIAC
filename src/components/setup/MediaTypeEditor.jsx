import { useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronUp, Palette, Plus, Trash2, GripVertical } from 'lucide-react'
import { api } from '../../lib/api'

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
const CATEGORY_HUES = [221, 38, 152, 354, 262, 24, 173, 329, 68, 284, 116, 4, 191, 318, 242, 88, 204, 12]
const CATEGORY_VARIANTS = [
  [0, 72, 44], [10, 70, 53], [-10, 74, 36], [16, 64, 61], [-16, 76, 42],
  [5, 56, 32], [-5, 62, 67], [14, 82, 39], [-14, 54, 51], [21, 72, 47],
  [-21, 76, 58], [8, 52, 41], [-8, 84, 31], [18, 60, 69], [-18, 66, 46],
]
function generalTagColor(index) {
  const cycle = Math.floor(index / CATEGORY_HUES.length)
  const hue = (CATEGORY_HUES[index % CATEGORY_HUES.length] + (cycle * 17)) % 360
  return hslToHex(hue, 70, cycle % 2 === 0 ? 44 : 57)
}
function hslToHex(h, s, l) {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
function categoryHue(category, categoryIndex = 0) {
  return CATEGORY_HUES[categoryIndex % CATEGORY_HUES.length]
}
function categoryVariantColor(category, index, categoryIndex = 0) {
  const [offset, saturation, lightness] = CATEGORY_VARIANTS[index % CATEGORY_VARIANTS.length]
  const cycle = Math.floor(index / CATEGORY_VARIANTS.length)
  const hue = (categoryHue(category, categoryIndex) + offset + (cycle * 17)) % 360
  return hslToHex(hue, saturation, lightness)
}
function newTagKey() {
  return `tag-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function withLocalTagKeys(tagList) {
  return tagList.map((tag, index) => ({ ...tag, _localKey: tag._localKey || tag.id || `tag-${index}-${Math.random().toString(36).slice(2)}` }))
}
function tagKey(tag, fallback) { return tag._localKey || tag.id || fallback }
function tagCategoryName(tag) { return (tag.category || '').trim() || 'General' }
function hasExplicitCategory(tag) { return !!(tag.category || '').trim() }
function applyCategoryColors(tagList, options = {}) {
  const keys = options.keys || null
  const categoryIndexes = new Map()
  const categoryCounts = new Map()
  for (const tag of tagList) {
    const category = (tag.category || '').trim()
    if (category && !categoryIndexes.has(category)) categoryIndexes.set(category, categoryIndexes.size)
  }
  return tagList.map((tag, index) => {
    const key = tagKey(tag, index)
    const shouldColor = !keys || keys.has(key)
    const category = (tag.category || '').trim()
    if (!category) {
      return shouldColor ? { ...tag, color: generalTagColor(index) } : tag
    }
    const categoryIndex = categoryCounts.get(category) || 0
    categoryCounts.set(category, categoryIndex + 1)
    return shouldColor ? { ...tag, color: categoryVariantColor(category, categoryIndex, categoryIndexes.get(category) || 0) } : tag
  })
}
function friendlySaveError(e) {
  const msg = e?.message || ''
  if (msg.includes('Project is locked')) return 'Project is locked. Go back to Setup and unlock the project before saving changes.'
  return msg || 'Save failed.'
}

export default function MediaTypeEditor({ projectId, mediaType, forms, instructions, onSave, onCancel, onLocked }) {
  const [name, setName] = useState(mediaType.name || '')
  const [reviewsRequired, setReviewsRequired] = useState(mediaType.reviews_required ?? 1)
  const [requireCompletion, setRequireCompletion] = useState(mediaType.reviews_required != null)
  const [color, setColor] = useState(mediaType.color || '#6366f1')
  const [tags, setTags] = useState(() => withLocalTagKeys(mediaType.tags || []))
  const [workspaceTabs, setWorkspaceTabs] = useState(mediaType.workspace_tabs || [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [manualColorKeys, setManualColorKeys] = useState(() => new Set())
  const categoryGroups = useMemo(() => {
    const groups = []
    const indexes = new Map()
    tags.forEach(tag => {
      const name = tagCategoryName(tag)
      if (!indexes.has(name)) {
        indexes.set(name, groups.length)
        groups.push({ name, count: 0 })
      }
      groups[indexes.get(name)].count += 1
    })
    return groups
  }, [tags])

  async function ensureUnlocked() {
    const unlocked = await api.isProjectUnlocked(projectId)
    if (unlocked) return true
    onLocked?.()
    return false
  }

  function addTag() { setTags(t => [...t, { _localKey: newTagKey(), label: '', color: generalTagColor(t.length), description: '', category: '' }]) }
  function updateTag(i, changes, options = {}) {
    if (options.manualColor) {
      const key = tagKey(tags[i], i)
      setManualColorKeys(keys => new Set([...keys, key]))
    }
    setTags(current => {
      const previousCategory = (current[i]?.category || '').trim()
      const next = current.map((tag, j) => j === i ? { ...tag, ...changes } : tag)
      if (!Object.prototype.hasOwnProperty.call(changes, 'category')) return next
      const key = tagKey(next[i], i)
      if (manualColorKeys.has(key)) return next
      const nextCategory = (next[i]?.category || '').trim()
      const affectedKeys = new Set()
      next.forEach((tag, index) => {
        const currentKey = tagKey(tag, index)
        if (manualColorKeys.has(currentKey)) return
        const category = (tag.category || '').trim()
        if (category === previousCategory || category === nextCategory) affectedKeys.add(currentKey)
      })
      return applyCategoryColors(next, { keys: affectedKeys.size ? affectedKeys : new Set([key]) })
    })
  }
  function removeTag(i) { setTags(t => t.filter((_, j) => j !== i)) }
  function recolorCategorizedTags() {
    setTags(current => applyCategoryColors(current, { keys: new Set(current.filter(hasExplicitCategory).map((tag, index) => tagKey(tag, index))) }))
    setManualColorKeys(keys => {
      const next = new Set(keys)
      tags.forEach((tag, index) => {
        if (hasExplicitCategory(tag)) next.delete(tagKey(tag, index))
      })
      return next
    })
  }
  function moveCategory(categoryName, direction) {
    setTags(current => {
      const groups = []
      const indexes = new Map()
      current.forEach(tag => {
        const name = tagCategoryName(tag)
        if (!indexes.has(name)) {
          indexes.set(name, groups.length)
          groups.push({ name, tags: [] })
        }
        groups[indexes.get(name)].tags.push(tag)
      })
      const index = groups.findIndex(group => group.name === categoryName)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= groups.length) return current
      const reordered = [...groups]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, moved)
      return reordered.flatMap(group => group.tags)
    })
  }

  function addTab(type, refId, label) {
    setWorkspaceTabs(t => [...t, { tab_type: type, ref_id: refId, label }])
  }
  function removeTab(i) { setWorkspaceTabs(t => t.filter((_, j) => j !== i)) }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      if (!(await ensureUnlocked())) return
      await api.saveMediaType(projectId, {
        id: mediaType.id || undefined,
        name: name.trim(),
        reviews_required: requireCompletion ? reviewsRequired : null,
        allow_custom_tags: true,
        color,
        tags,
        workspace_tabs: workspaceTabs,
      })
      onSave()
    } catch (e) {
      console.error('[MediaTypeEditor] save failed:', e)
      setSaveError(friendlySaveError(e))
    } finally {
      setSaving(false)
    }
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
            placeholder="Media type name"
            style={{ fontWeight: 600, fontSize: 14, border: 'none', background: 'transparent', outline: 'none', width: 240, padding: 0 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 28 }}>
          {saveError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', color: '#991b1b', fontSize: 13 }}>
              {saveError}
            </div>
          )}

          {/* Color */}
          <section>
            <h3 style={{ marginBottom: 10 }}>Color</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                    outline: color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2, transition: 'outline 0.1s',
                  }}
                />
              ))}
            </div>
          </section>

          {/* Review requirement */}
          <section>
            <h3 style={{ marginBottom: 10 }}>Review Requirement</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0, cursor: 'pointer', fontWeight: 400 }}>
              <input type="checkbox" checked={requireCompletion} onChange={e => setRequireCompletion(e.target.checked)} />
              <span style={{ fontSize: 13 }}>Require a minimum number of reviews for completion</span>
            </label>
            {requireCompletion && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="number" min={1} max={20} value={reviewsRequired}
                  onChange={e => setReviewsRequired(Number(e.target.value))}
                  style={{ width: 80 }}
                />
                <span className="text-secondary text-sm">reviews required per media file</span>
              </div>
            )}
          </section>

          {/* Timestamp tags */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3>Timestamp Tags</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                {tags.some(hasExplicitCategory) && (
                  <button className="btn btn-secondary btn-sm" onClick={recolorCategorizedTags} title="Assign related colors within each category">
                    <Palette size={13} /> Category Colors
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={addTag}><Plus size={13} /> Add Tag</button>
              </div>
            </div>
            {tags.length === 0 ? (
              <p className="text-muted text-sm">No tags defined. Coders will not have tag options for timestamps.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {categoryGroups.length > 1 && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>Category Order</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>This controls the order categories appear in the timestamp sidebar.</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {categoryGroups.map((group, i) => (
                        <div
                          key={group.name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 8px',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            background: 'var(--bg)',
                          }}
                        >
                          <GripVertical size={14} color="var(--text-muted)" />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{group.name}</span>
                          <span className="badge badge-muted">{group.count} tag{group.count === 1 ? '' : 's'}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => moveCategory(group.name, -1)}
                            disabled={i === 0}
                            title="Move category up"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => moveCategory(group.name, 1)}
                            disabled={i === categoryGroups.length - 1}
                            title="Move category down"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {tags.map((tag, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="color" value={tag.color || '#6366f1'}
                      onChange={e => updateTag(i, { color: e.target.value }, { manualColor: true })}
                      style={{ width: 32, height: 32, padding: 2, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: 'none' }}
                    />
                    <input value={tag.label} onChange={e => updateTag(i, { label: e.target.value })} placeholder="Tag label" style={{ flex: 1 }} />
                    <input value={tag.category || ''} onChange={e => updateTag(i, { category: e.target.value })} placeholder="Category (optional)" style={{ flex: 1.1 }} />
                    <input value={tag.description || ''} onChange={e => updateTag(i, { description: e.target.value })} placeholder="Description (optional)" style={{ flex: 1.8 }} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeTag(i)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Workspace tabs */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3>Workspace Tabs</h3>
            </div>
            <p className="text-secondary text-sm" style={{ marginBottom: 12 }}>
              Add forms and instruction pages as tabs in the review workspace. Coders see these below the video.
            </p>
            {workspaceTabs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {workspaceTabs.map((tab, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <span className={`badge ${tab.tab_type === 'form' ? 'badge-accent' : 'badge-muted'}`}>{tab.tab_type}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{tab.label}</span>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeTab(i)}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="text-secondary text-sm">Add form:</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    const f = forms.find(f => f.id == e.target.value)
                    if (f) { addTab('form', f.id, f.name); e.target.value = '' }
                  }}
                  style={{ fontSize: 13, height: 32 }}
                >
                  <option value="">Choose form…</option>
                  {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="text-secondary text-sm">Add instructions:</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    const ins = instructions.find(i => i.id == e.target.value)
                    if (ins) { addTab('instruction', ins.id, ins.name); e.target.value = '' }
                  }}
                  style={{ fontSize: 13, height: 32 }}
                >
                  <option value="">Choose page…</option>
                  {instructions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
