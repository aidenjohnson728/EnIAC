import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '../ui/Modal'
import { api } from '../../lib/api'

export default function NewReviewModal({ mediaFile, projectId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [savedName, setSavedName] = useState(null)
  const [otherNames, setOtherNames] = useState([]) // other names this machine has used

  useEffect(() => {
    // Load per-project name first, fall back to global
    api.getProjectName(projectId).then(n => {
      if (n) { setName(n); setSavedName(n) }
      else api.getAppSettings().then(s => { if (s.reviewer_name) { setName(s.reviewer_name); setSavedName(s.reviewer_name) } })
    })
    // Check if this machine has been used by other reviewers on this project
    api.getMachineReviewNames(projectId).then(names => setOtherNames(names))
  }, [projectId])

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    await api.setProjectName(projectId, name.trim())
    const review = await api.createReview({ media_file_id: mediaFile.id, reviewer_name: name.trim() })
    onCreated(review.id)
  }

  const differentNames = otherNames.filter(n => n !== name.trim() && n !== savedName)

  return (
    <Modal
      open
      onClose={onClose}
      title={`New Review — ${mediaFile.name}`}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!name.trim() || loading}>
            {loading ? 'Starting…' : 'Start Review'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-field">
          <label>Your Name for This Project *</label>
          <input
            autoFocus
            placeholder="Enter your name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <span className="text-muted text-sm" style={{ marginTop: 2 }}>
            {savedName
              ? 'Saved for this project. Use the exact same name on every device.'
              : 'Will be saved as your default name for this project.'}
          </span>
        </div>

        {differentNames.length > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10 }}>
            <AlertTriangle size={15} color="#92400e" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
              This computer already has reviews under <strong>{differentNames.map(n => `"${n}"`).join(', ')}</strong>.
              If you are a <em>different person</em>, your reviews will share a sync file — make sure your coordinator knows both names are from this machine.
              If you are the <em>same person</em>, use the same name as before to keep your reviews matched correctly.
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
