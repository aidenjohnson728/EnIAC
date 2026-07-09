import { useState } from 'react'
import { ChevronLeft, Plus, Trash2, GripVertical } from 'lucide-react'
import { api } from '../../lib/api'
import Modal from '../ui/Modal'

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
const TAG_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16','#a855f7']
function randomTagColor() { return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] }
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
  const [tags, setTags] = useState(mediaType.tags || [])
  const [workspaceTabs, setWorkspaceTabs] = useState(mediaType.workspace_tabs || [])
  const [saving, setSaving] = useState(false)
  const [migrationPreview, setMigrationPreview] = useState(null)
  const [saveError, setSaveError] = useState('')

  async function ensureUnlocked() {
    const unlocked = await api.isProjectUnlocked(projectId)
    if (unlocked) return true
    onLocked?.()
    return false
  }

  function addTag() { setTags(t => [...t, { label: '', color: randomTagColor(), description: '', category: '' }]) }
  function updateTag(i, changes) { setTags(t => t.map((tag, j) => j === i ? { ...tag, ...changes } : tag)) }
  function removeTag(i) { setTags(t => t.filter((_, j) => j !== i)) }

  function addTab(type, refId, label) {
    setWorkspaceTabs(t => [...t, { tab_type: type, ref_id: refId, label }])
  }
  function removeTab(i) { setWorkspaceTabs(t => t.filter((_, j) => j !== i)) }

  async function doSave(scope = 'future') {
    if (!name.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      if (!(await ensureUnlocked())) return
      const savedId = await api.saveMediaType(projectId, {
        id: mediaType.id || undefined,
        name: name.trim(),
        reviews_required: requireCompletion ? reviewsRequired : null,
        allow_custom_tags: true,
        color,
        tags,
        workspace_tabs: workspaceTabs,
      })
      if (scope !== 'future' && savedId) {
        await api.migrateStructureReviews(projectId, { kind: 'mediaType', id: savedId, scope })
      }
      onSave()
    } catch (e) {
      console.error('[MediaTypeEditor] save failed:', e)
      setSaveError(friendlySaveError(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!name.trim()) return
    if (mediaType.id) {
      setSaving(true)
      setSaveError('')
      try {
        if (!(await ensureUnlocked())) return
        const preview = await api.previewStructureMigration(projectId, { kind: 'mediaType', id: mediaType.id, scope: 'all' })
        if ((preview?.total || 0) > 0) {
          setMigrationPreview(preview)
          return
        }
      } catch (e) {
        console.error('[MediaTypeEditor] migration preview failed:', e)
        setSaveError(friendlySaveError(e))
        return
      } finally {
        setSaving(false)
      }
    }
    doSave('future')
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
          {saveError && !migrationPreview && (
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
              <button className="btn btn-secondary btn-sm" onClick={addTag}><Plus size={13} /> Add Tag</button>
            </div>
            {tags.length === 0 ? (
              <p className="text-muted text-sm">No tags defined. Coders will not have tag options for timestamps.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tags.map((tag, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="color" value={tag.color || '#6366f1'}
                      onChange={e => updateTag(i, { color: e.target.value })}
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

      <Modal
        open={!!migrationPreview}
        onClose={() => !saving && setMigrationPreview(null)}
        title="Apply Media Type Changes?"
        size="modal-lg"
        footer={
          <>
            <button className="btn btn-secondary" disabled={saving} onClick={() => setMigrationPreview(null)}>Cancel</button>
            <button className="btn btn-secondary" disabled={saving} onClick={() => doSave('future')}>
              Future Reviews Only
            </button>
            <button className="btn btn-primary" disabled={saving || (migrationPreview?.drafts || 0) === 0} onClick={() => doSave('drafts')}>
              Update Drafts
            </button>
            <button className="btn btn-danger" disabled={saving} onClick={() => doSave('all')}>
              Update All Reviews
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
              This media type is already used by <strong>{migrationPreview.total}</strong> review{migrationPreview.total !== 1 ? 's' : ''}.
              Existing reviews keep their current workspace layout and timestamp tags unless you migrate them.
            </p>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div><strong>{migrationPreview.drafts}</strong> draft review{migrationPreview.drafts !== 1 ? 's' : ''}</div>
              <div><strong>{migrationPreview.submitted}</strong> submitted review{migrationPreview.submitted !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, color: '#991b1b' }}>
              Updating all reviews changes the media type version used to interpret submitted reviews. Use it only when you intentionally want old reviews to follow the new tags and workspace layout.
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
