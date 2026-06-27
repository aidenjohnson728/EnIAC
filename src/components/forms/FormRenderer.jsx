import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Check } from 'lucide-react'

export default function FormRenderer({ schema, responses, onSave, readOnly }) {
  const [values, setValues] = useState(responses || {})
  const [collapsed, setCollapsed] = useState({})

  useEffect(() => { setValues(responses || {}) }, [responses])

  const handleChange = useCallback((qId, val) => {
    setValues(v => {
      const next = { ...v, [qId]: val }
      onSave(next)
      return next
    })
  }, [onSave])

  if (!schema?.sections?.length) {
    return <div className="empty-state"><p className="text-sm">This form has no sections yet.</p></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {schema.sections.map(section => (
        <FormSection
          key={section.id}
          section={section}
          values={values}
          onChange={handleChange}
          collapsed={!!collapsed[section.id]}
          onToggle={() => setCollapsed(c => ({ ...c, [section.id]: !c[section.id] }))}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

function FormSection({ section, values, onChange, collapsed, onToggle, readOnly }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', background: 'var(--bg-secondary)', borderRadius: collapsed ? 10 : '10px 10px 0 0' }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span style={{ fontWeight: 600, fontSize: 14 }}>{section.title || 'Section'}</span>
        {section.description && <span className="text-secondary text-sm">— {section.description}</span>}
      </div>
      {!collapsed && (
        <div style={{ padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {(section.elements || []).map(el => (
            <FormElement key={el.id} el={el} value={values[el.id]} onChange={v => onChange(el.id, v)} readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  )
}

function FormElement({ el, value, onChange, readOnly }) {
  if (el.type === 'text_block') {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.65, padding: '2px 0' }}>
        {el.content}
      </div>
    )
  }

  const label = (
    <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
      <span style={{ fontWeight: 500, fontSize: 14 }}>{el.label}</span>
      {el.required && <span style={{ color: 'var(--danger)', fontSize: 13 }}>*</span>}
    </div>
  )

  if (el.type === 'short_answer') {
    return <div>{label}<input value={value || ''} onChange={e => onChange(e.target.value)} disabled={readOnly} placeholder={el.placeholder || ''} /></div>
  }

  if (el.type === 'paragraph') {
    return <div>{label}<textarea value={value || ''} onChange={e => onChange(e.target.value)} disabled={readOnly} placeholder={el.placeholder || ''} rows={4} /></div>
  }

  if (el.type === 'multiple_choice') {
    return (
      <div>
        {label}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(el.options || []).map(opt => {
            const selected = value === opt
            return (
              <button
                key={opt}
                disabled={readOnly}
                onClick={() => !readOnly && onChange(opt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', border: '1.5px solid',
                  borderColor: selected ? 'var(--accent)' : 'var(--border)',
                  borderRadius: 8, background: selected ? 'var(--accent-light)' : 'var(--bg)',
                  cursor: readOnly ? 'default' : 'pointer', textAlign: 'left',
                  transition: 'all 0.1s', fontFamily: 'var(--font)',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: selected ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.1s',
                }}>
                  {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                </div>
                <span style={{ fontSize: 14, color: selected ? 'var(--accent)' : 'var(--text)', fontWeight: selected ? 500 : 400 }}>{opt}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (el.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div>
        {label}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(el.options || []).map(opt => {
            const isSelected = selected.includes(opt)
            return (
              <button
                key={opt}
                disabled={readOnly}
                onClick={() => {
                  if (readOnly) return
                  const next = isSelected ? selected.filter(x => x !== opt) : [...selected, opt]
                  onChange(next)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', border: '1.5px solid',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  borderRadius: 8, background: isSelected ? 'var(--accent-light)' : 'var(--bg)',
                  cursor: readOnly ? 'default' : 'pointer', textAlign: 'left',
                  transition: 'all 0.1s', fontFamily: 'var(--font)',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.1s',
                }}>
                  {isSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                </div>
                <span style={{ fontSize: 14, color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: isSelected ? 500 : 400 }}>{opt}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (el.type === 'likert') {
    const scale = el.scale || 5
    const points = Array.from({ length: scale }, (_, i) => i + 1)
    return (
      <div>
        {label}
        {(el.low_label || el.high_label) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            <span>{el.low_label}</span><span>{el.high_label}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {points.map(p => (
            <button
              key={p}
              disabled={readOnly}
              onClick={() => !readOnly && onChange(p)}
              style={{
                flex: 1, padding: '8px 4px', border: '1.5px solid',
                borderColor: value === p ? 'var(--accent)' : 'var(--border)',
                borderRadius: 8, background: value === p ? 'var(--accent-light)' : 'var(--bg)',
                color: value === p ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: value === p ? 600 : 400, fontSize: 14, cursor: readOnly ? 'default' : 'pointer',
                transition: 'all 0.1s', fontFamily: 'var(--font)',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (el.type === 'slider') {
    const min = el.min ?? 0
    const max = el.max ?? 100
    const step = el.step ?? 1
    const val = value ?? min
    const pct = ((val - min) / (max - min)) * 100
    return (
      <div>
        {label}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="range" min={min} max={max} step={step}
              value={val}
              onChange={e => !readOnly && onChange(Number(e.target.value))}
              disabled={readOnly}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
          <div style={{
            minWidth: 44, textAlign: 'center', fontWeight: 600, fontSize: 16,
            color: 'var(--accent)', background: 'var(--accent-light)',
            padding: '4px 8px', borderRadius: 6,
          }}>{val}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          <span>{el.low_label || min}</span><span>{el.high_label || max}</span>
        </div>
      </div>
    )
  }

  return null
}
