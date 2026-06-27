import { X } from 'lucide-react'

export default function FilterPanel({ filters, setFilters, mediaTypes, onClose }) {
  function set(key, val) {
    setFilters(f => val ? { ...f, [key]: val } : Object.fromEntries(Object.entries(f).filter(([k]) => k !== key)))
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '16px', marginBottom: 16,
      display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end',
    }}>
      <div className="form-field" style={{ minWidth: 160 }}>
        <label>Completion</label>
        <select value={filters.completion || ''} onChange={e => set('completion', e.target.value)}>
          <option value="">All</option>
          <option value="complete">Complete</option>
          <option value="incomplete">Incomplete</option>
        </select>
      </div>
      <div className="form-field" style={{ minWidth: 180 }}>
        <label>Media Type</label>
        <select value={filters.mediaType || ''} onChange={e => set('mediaType', e.target.value)}>
          <option value="">All types</option>
          {mediaTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignSelf: 'flex-end' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setFilters({})}>Clear</button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={14} /></button>
      </div>
    </div>
  )
}
