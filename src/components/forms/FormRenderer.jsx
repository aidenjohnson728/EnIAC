import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronRight, Check } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const HORIZONTAL_SLIDER_INSET = 8

function resolveMarkdownAsset(src, assets = []) {
  const id = String(src || '').replace(/^\.\/sdmo-image-/, '').replace(/^sdmo-image-/, '')
  return assets.find(asset => asset.id === id)?.dataUrl || src
}

export default function FormRenderer({ schema, responses, onSave, readOnly, timestamps = [] }) {
  const sections = schema?.sections || []
  const manySections = sections.length > 3

  const [values, setValues] = useState(responses || {})
  const [collapsed, setCollapsed] = useState(() => {
    if (!manySections) return {}
    return Object.fromEntries(sections.map(s => [s.id, true]))
  })
  const [activeSection, setActiveSection] = useState(null)
  const sectionRefs = useRef({})

  const valuesRef = useRef(values)
  useEffect(() => {
    const v = responses || {}
    setValues(v)
    valuesRef.current = v
  }, [responses])

  const saveTimerRef = useRef(null)
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  const handleChange = useCallback((qId, val) => {
    const next = { ...valuesRef.current, [qId]: val }
    valuesRef.current = next
    setValues(next)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      onSaveRef.current(next)
    }, 300)
  }, [])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      onSaveRef.current(valuesRef.current)
    }
  }, [])

  function jumpTo(sectionId) {
    setActiveSection(sectionId)
    setCollapsed(c => ({ ...c, [sectionId]: false }))
    setTimeout(() => {
      sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  if (!sections.length) {
    return <div className="empty-state"><p className="text-sm">This form has no sections yet.</p></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Jump bar ─────────────────────────────────────────────────────────── */}
      {sections.length > 1 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--bg)',
          padding: '6px 0 8px',
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '0 0 8px 8px',
            padding: '3px 4px',
            display: 'flex', flexWrap: 'wrap', gap: 2,
          }}>
            {sections.map((section, i) => {
              const { answered, total } = countAnswered(section, values)
              const complete = total > 0 && answered === total
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => jumpTo(section.id)}
                  style={{
                    padding: '4px 9px', borderRadius: 6,
                    fontSize: 11, fontWeight: isActive ? 600 : 500,
                    border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                    background: isActive ? 'var(--bg)' : complete ? 'rgba(34,197,94,0.1)' : 'transparent',
                    color: isActive ? 'var(--accent)' : complete ? 'var(--success, #22c55e)' : 'var(--text-muted)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                    fontFamily: 'var(--font)', transition: 'all 0.12s', whiteSpace: 'nowrap',
                  }}
                >
                  {complete
                    ? <Check size={9} strokeWidth={3.5} />
                    : <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.5 }}>{i + 1}</span>
                  }
                  {section.title || 'Section'}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Sections ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: sections.length > 1 ? 0 : 12 }}>
        {sections.map((section, i) => (
          <FormSection
            key={section.id}
            section={section}
            sectionIndex={i}
            values={values}
            onChange={handleChange}
            collapsed={!!collapsed[section.id]}
            onToggle={() => {
              const opening = !!collapsed[section.id]
              if (opening) setActiveSection(section.id)
              setCollapsed(c => ({ ...c, [section.id]: !c[section.id] }))
            }}
            sectionRef={el => { sectionRefs.current[section.id] = el }}
            readOnly={readOnly}
            timestamps={timestamps}
          />
        ))}
      </div>
    </div>
  )
}

function countAnswered(section, values) {
  const questions = (section.elements || []).filter(el => el.type !== 'text_block')
  const answered = questions.filter(el => isElementAnswered(el, values[el.id]))
  return { answered: answered.length, total: questions.length }
}

function isValueAnswered(value) {
  if (isNA(value)) return true
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function isElementAnswered(el, value) {
  if (el.type === 'checkbox') {
    return value === true || isNA(value)
  }
  if (el.type === 'likert_group') {
    const items = el.items || []
    if (items.length === 0) return false
    const groupVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
    return items.every(item => isValueAnswered(groupVal[item.id]))
  }
  if (el.type === 'table') {
    const rows = el.rows || []
    const columns = el.columns || []
    if (rows.length === 0 || columns.length === 0) return false
    const tableVal = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}
    return rows.every((_, rowIndex) => {
      const rowVal = (tableVal[String(rowIndex)] && typeof tableVal[String(rowIndex)] === 'object') ? tableVal[String(rowIndex)] : {}
      return columns.every(col => isValueAnswered(rowVal[col.id]))
    })
  }
  return isValueAnswered(value)
}

function FormSection({ section, sectionIndex, values, onChange, collapsed, onToggle, sectionRef, readOnly, timestamps }) {
  const { answered, total } = countAnswered(section, values)
  const complete = total > 0 && answered === total

  return (
    <div ref={sectionRef}>
      {/* Section header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px',
          background: complete ? 'rgba(34,197,94,0.07)' : 'var(--bg-secondary)',
          borderRadius: collapsed ? 8 : '8px 8px 0 0',
          cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.25s',
          borderLeft: `3px solid ${complete ? 'var(--success, #22c55e)' : 'var(--accent)'}`,
        }}
      >
        {/* Section number badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
          color: complete ? 'var(--success, #22c55e)' : 'var(--accent)',
          background: complete ? 'rgba(34,197,94,0.12)' : 'var(--accent-light)',
          padding: '2px 6px', borderRadius: 4, flexShrink: 0,
          minWidth: 24, textAlign: 'center',
          transition: 'color 0.25s, background 0.25s',
        }}>
          {String(sectionIndex + 1).padStart(2, '0')}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em' }}>
            {section.title || 'Section'}
          </div>
          {section.description && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.35, marginTop: 2 }}>
              {section.description}
            </div>
          )}
        </div>

        {total > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: complete ? 'var(--success, #22c55e)' : 'var(--text-muted)',
            flexShrink: 0, marginRight: 4,
            transition: 'color 0.25s',
          }}>
            {answered}/{total}
          </span>
        )}

        {collapsed
          ? <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          : <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        }
      </div>

      {/* Section content */}
      <div style={{
        maxHeight: collapsed ? 0 : 9999,
        opacity: collapsed ? 0 : 1,
        overflow: 'hidden',
        transition: 'max-height 0.2s ease, opacity 0.15s ease',
      }}>
        <div style={{
          padding: '12px 12px 4px 26px',
          display: 'flex', flexDirection: 'column', gap: 22,
          borderLeft: `3px solid ${complete ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
          marginLeft: 0,
          transition: 'border-color 0.25s',
        }}>
          {(section.elements || []).map((el, elementIndex) => {
            const questionNumber = (section.elements || [])
              .slice(0, elementIndex + 1)
              .filter(item => item.type !== 'text_block').length
            return (
              <FormElement
                key={el.id}
                el={el}
                questionNumber={questionNumber}
                value={values[el.id]}
                onChange={v => onChange(el.id, v)}
                readOnly={readOnly}
                timestamps={timestamps}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FocusTextarea({ value, onChange, placeholder, disabled, rows = 3 }) {
  const [focused, setFocused] = useState(false)
  return (
    <textarea
      value={value || ''} onChange={onChange} placeholder={placeholder}
      disabled={disabled} rows={rows}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        border: `1.5px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8, padding: '9px 12px', width: '100%', outline: 'none',
        fontSize: 13, fontFamily: 'var(--font)', color: 'var(--text)',
        background: 'var(--bg)', transition: 'border-color 0.15s', resize: 'vertical',
      }}
    />
  )
}

function FocusInput({ value, onChange, placeholder, disabled }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      value={value || ''} onChange={onChange} placeholder={placeholder} disabled={disabled}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        border: `1.5px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8, padding: '9px 12px', background: 'var(--bg)',
        width: '100%', outline: 'none', fontSize: 13,
        fontFamily: 'var(--font)', color: 'var(--text)', transition: 'border-color 0.15s',
      }}
    />
  )
}

function ChoiceButton({ selected, onClick, readOnly, multiSelect, children }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      disabled={readOnly} onClick={onClick}
      onMouseEnter={() => !readOnly && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', textAlign: 'left', padding: '8px 12px',
        border: `1.5px solid ${selected ? 'var(--accent)' : hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 8,
        background: selected ? 'var(--accent-light)' : hovered ? 'var(--bg-secondary)' : 'transparent',
        cursor: readOnly ? 'default' : 'pointer',
        transition: 'border-color 0.12s, background 0.12s', fontFamily: 'var(--font)',
      }}
    >
      <div style={{
        width: 18, height: 18, flexShrink: 0,
        borderRadius: multiSelect ? 4 : '50%',
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: selected ? 'var(--accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.12s, background 0.12s',
      }}>
        {selected && <Check size={10} color="#fff" strokeWidth={3.5} />}
      </div>
      <span style={{
        flex: 1, fontSize: 13, lineHeight: 1.4,
        color: selected ? 'var(--accent)' : 'var(--text)',
        fontWeight: selected ? 600 : 400, transition: 'color 0.12s',
      }}>
        {children}
      </span>
    </button>
  )
}

function SegmentedControl({ options, value, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex' }}>
      {options.map((opt, i) => {
        const selected = value === opt
        const isFirst = i === 0
        const isLast = i === options.length - 1
        return (
          <button
            key={String(opt)} disabled={readOnly}
            onClick={() => !readOnly && onChange(value === opt ? undefined : opt)}
            style={{
              flex: 1, padding: '7px 4px',
              border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: isFirst ? '6px 0 0 6px' : isLast ? '0 6px 6px 0' : 0,
              marginLeft: isFirst ? 0 : -1.5,
              background: selected ? 'var(--accent-light)' : 'transparent',
              color: selected ? 'var(--accent)' : 'var(--text-secondary)',
              fontWeight: selected ? 700 : 400,
              fontSize: typeof opt === 'string' ? 12 : 14,
              cursor: readOnly ? 'default' : 'pointer',
              transition: 'background 0.1s, color 0.1s, border-color 0.1s',
              fontFamily: 'var(--font)', position: 'relative', zIndex: selected ? 1 : 0,
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function RadioDot({ selected, onClick, readOnly }) {
  return (
    <div
      onClick={readOnly ? undefined : onClick}
      style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: selected ? 'var(--accent)' : 'transparent',
        cursor: readOnly ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.1s, background 0.1s',
      }}
    >
      {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
    </div>
  )
}

function questionLabel(el, questionNumber) {
  return el.label || `Question ${questionNumber || ''}`.trim()
}

function controlLabel(el, index, count) {
  const custom = Array.isArray(el.control_labels) ? el.control_labels[index] : ''
  if (custom) return custom
  if (count > 1) return `${el.type === 'dial' ? 'Dial' : 'Slider'} ${index + 1}`
  return el.type === 'dial' ? 'Dial' : 'Slider'
}

function controlEndpointLabel(el, key, index) {
  const arrayKey = key === 'low' ? 'control_low_labels' : 'control_high_labels'
  const sharedKey = key === 'low' ? 'low_label' : 'high_label'
  const custom = Array.isArray(el[arrayKey]) ? el[arrayKey][index] : ''
  return custom || el[sharedKey] || ''
}

function decimalPlaces(value) {
  const text = String(value)
  if (!text.includes('.')) return 0
  return text.split('.')[1].replace(/0+$/, '').length
}

function roundToStep(value, step) {
  const places = Math.min(6, Math.max(decimalPlaces(value), decimalPlaces(step)))
  return Number(value.toFixed(places))
}

function niceTickInterval(span, maxIntervals) {
  const raw = span / maxIntervals
  const power = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / power
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * power
}

function sliderTicks(min, max, step) {
  const safeMin = Number(min)
  const safeMax = Number(max)
  const safeStep = Number(step) > 0 ? Number(step) : 1
  if (!Number.isFinite(safeMin) || !Number.isFinite(safeMax) || safeMax <= safeMin) return [safeMin || 0]

  const span = safeMax - safeMin
  const stepCount = Math.floor(span / safeStep)
  if (stepCount <= 10) {
    const ticks = []
    for (let i = 0; i <= stepCount; i++) ticks.push(roundToStep(safeMin + (safeStep * i), safeStep))
    if (ticks[ticks.length - 1] !== safeMax) ticks.push(safeMax)
    return ticks
  }

  const interval = niceTickInterval(span, 6)
  const ticks = [safeMin]
  let next = safeMin + interval
  while (next < safeMax && ticks.length < 9) {
    ticks.push(roundToStep(next, interval))
    next += interval
  }
  if (ticks[ticks.length - 1] !== safeMax) ticks.push(safeMax)
  return ticks
}

function SliderTicks({ min, max, step, inset = 0 }) {
  const ticks = sliderTicks(min, max, step)
  const span = max - min || 1
  return (
    <div style={{ padding: `0 ${inset}px`, flexShrink: 0 }}>
      <div style={{ position: 'relative', height: 30 }}>
        {ticks.map((tick, i) => {
          const pct = Math.max(0, Math.min(100, ((tick - min) / span) * 100))
          const first = i === 0
          const last = i === ticks.length - 1
          return (
            <div
              key={`${tick}-${i}`}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: 0,
                transform: first ? 'none' : last ? 'translateX(-100%)' : 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: first ? 'flex-start' : last ? 'flex-end' : 'center',
                minWidth: 34,
                pointerEvents: 'none',
              }}
            >
              <span style={{ width: 1, height: 7, background: 'var(--border-strong)', borderRadius: 1 }} />
              <span style={{ marginTop: 3, fontSize: 10, lineHeight: 1, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {tick}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HorizontalSliderInput({ min, max, step, value, disabled, onChange }) {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return (
    <div style={{ padding: `0 ${HORIZONTAL_SLIDER_INSET}px` }}>
      <div style={{ position: 'relative', height: 24 }}>
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 6,
          transform: 'translateY(-50%)',
          borderRadius: 99,
          background: 'var(--bg-active)',
          boxShadow: 'inset 0 0 0 1px var(--border)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          left: 0,
          width: `${pct}%`,
          top: '50%',
          height: 6,
          transform: 'translateY(-50%)',
          borderRadius: 99,
          background: disabled ? 'var(--border-strong)' : 'var(--accent)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          left: `${pct}%`,
          top: '50%',
          width: 14,
          height: 14,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          background: disabled ? 'var(--border-strong)' : 'var(--accent)',
          border: 'none',
          boxShadow: 'none',
          pointerEvents: 'none',
        }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => !disabled && onChange(Number(e.target.value))}
          disabled={disabled}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            padding: 0,
            opacity: 0,
            cursor: disabled ? 'default' : 'pointer',
          }}
        />
      </div>
    </div>
  )
}

function normalizeScaleLabels(labels, min, max) {
  return (labels || [])
    .map(item => {
      const from = Number(item.from ?? item.value ?? min)
      const to = Number(item.to ?? item.from ?? item.value ?? from)
      return {
        from: Math.max(min, Math.min(max, Math.min(from, to))),
        to: Math.max(min, Math.min(max, Math.max(from, to))),
        label: String(item.label || '').trim(),
      }
    })
    .filter(item => item.label)
    .sort((a, b) => a.from - b.from || a.to - b.to)
}

function scaleLabelRangeText(item) {
  return item.from === item.to ? `${item.from}` : `${item.from}-${item.to}`
}

function SliderScaleLabels({ labels, min, max }) {
  const items = normalizeScaleLabels(labels, min, max)
  if (!items.length) return null
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 2,
      paddingTop: 2,
    }}>
      {items.map((item, i) => (
        <div
          key={`${item.from}-${item.to}-${item.label}-${i}`}
          title={`${scaleLabelRangeText(item)} = ${item.label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minWidth: 0,
            maxWidth: '100%',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--bg)',
          }}
        >
          <span style={{
            padding: '3px 7px',
            background: 'var(--bg-active)',
            borderRight: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.3,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}>
            {scaleLabelRangeText(item)}
          </span>
          <span style={{
            padding: '3px 8px',
            color: 'var(--text)',
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function QLabel({ el, questionNumber }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>{questionLabel(el, questionNumber)}</span>
      {el.required && <span style={{ color: 'var(--danger)', marginLeft: 3, fontSize: 12 }}>*</span>}
      {el.description && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 3, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {el.description}
        </div>
      )}
    </div>
  )
}

function isNA(value) {
  return value === 'N/A' || (value && typeof value === 'object' && !Array.isArray(value) && value.__na === true)
}

function NAToggle({ selected, onChange, readOnly, compact = false }) {
  return (
    <button
      disabled={readOnly}
      onClick={() => !readOnly && onChange(selected ? null : 'N/A')}
      style={{
        alignSelf: compact ? 'stretch' : 'flex-start',
        padding: compact ? '4px 8px' : '6px 10px',
        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 6,
        background: selected ? 'var(--accent-light)' : 'transparent',
        color: selected ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: compact ? 12 : 13,
        fontWeight: selected ? 700 : 500,
        cursor: readOnly ? 'default' : 'pointer',
        fontFamily: 'var(--font)',
      }}
    >
      N/A
    </button>
  )
}

function ScaleEndpointLabels({ low, high, min, max, vertical = false, inset = 0 }) {
  const lowText = low || min
  const highText = high || max
  if (vertical) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 132, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.25, minWidth: 42 }}>
        <span style={{ textAlign: 'left' }}>{highText}</span>
        <span style={{ textAlign: 'left' }}>{lowText}</span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.25, padding: `0 ${inset}px` }}>
      <span>{lowText}</span>
      <span style={{ textAlign: 'right' }}>{highText}</span>
    </div>
  )
}

function NumericStepper({ value, min, max, step, disabled, onChange }) {
  function apply(nextValue) {
    if (disabled) return
    const n = Number(nextValue)
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => apply(value - step)}
        className="btn btn-secondary btn-icon btn-sm"
        aria-label="Decrease value"
      >
        -
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={e => apply(e.target.value)}
        style={{
          width: 64, textAlign: 'center', fontWeight: 700, fontSize: 14,
          color: 'var(--accent)', background: 'var(--accent-light)',
          padding: '4px 6px', borderRadius: 6, border: '1.5px solid transparent',
          outline: 'none', fontFamily: 'var(--font)',
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => apply(value + step)}
        className="btn btn-secondary btn-icon btn-sm"
        aria-label="Increase value"
      >
        +
      </button>
    </div>
  )
}

function ControlTitle({ children }) {
  return (
    <div style={{
      width: '100%',
      minHeight: 34,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      fontSize: 13,
      lineHeight: 1.3,
      fontWeight: 700,
      color: 'var(--text)',
      padding: '0 4px',
    }}>
      {children}
    </div>
  )
}

function DialControl({ value, min, max, step, disabled, onChange, label, lowLabel, highLabel, scaleLabels = []}) {
  const safeValue = Number.isFinite(value) ? value : min
  const bounded = Math.min(max, Math.max(min, safeValue))
  const pct = max === min ? 0 : ((bounded - min) / (max - min)) * 100
  const angle = -135 + (pct / 100) * 270
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const arcLength = circumference * 0.75
  const progressLength = arcLength * (pct / 100)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      minWidth: 156,
      maxWidth: 220,
      padding: '12px 14px',
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg)',
    }}>
      <ControlTitle>{label}</ControlTitle>
      <div
        style={{
          cursor: 'default',
          outline: 'none',
          width: 92,
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--bg-secondary)',
        }}
      >
        <svg width="82" height="82" viewBox="0 0 100 100" aria-label={label || 'Dial'}>
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="var(--border-strong)"
            strokeWidth="10"
            fill="none"
            opacity="0.65"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            transform="rotate(135 50 50)"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="var(--accent)"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${progressLength} ${circumference}`}
            transform="rotate(135 50 50)"
          />
          <line x1="50" y1="50" x2="50" y2="18" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" transform={`rotate(${angle} 50 50)`} />
          <circle cx="50" cy="50" r="11" fill="var(--bg)" stroke="var(--accent)" strokeWidth="4" />
        </svg>
      </div>
      <NumericStepper value={bounded} min={min} max={max} step={step} disabled={disabled} onChange={onChange} />
      <div style={{ width: '100%' }}>
        <ScaleEndpointLabels low={lowLabel} high={highLabel} min={min} max={max} />
      </div>
    </div>
  )
}

function VerticalSliderControl({ value, min, max, step, disabled, onChange, label, lowLabel, highLabel }) {
  const safeValue = Number.isFinite(value) ? value : min
  const bounded = Math.min(max, Math.max(min, safeValue))
  const pct = max === min ? 0 : ((bounded - min) / (max - min)) * 100
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      minWidth: 156,
      maxWidth: 220,
      padding: '12px 14px',
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg)',
    }}>
      <ControlTitle>{label}</ControlTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ScaleEndpointLabels low={lowLabel} high={highLabel} min={min} max={max} vertical />
        <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={bounded}
            disabled={disabled}
            onChange={e => onChange(Number(e.target.value))}
            style={{ height: 140, width: 140, transform: 'rotate(-90deg)', accentColor: 'var(--accent)', cursor: disabled ? 'default' : 'pointer' }}
          />
        </div>
      </div>
      <NumericStepper value={bounded} min={min} max={max} step={step} disabled={disabled} onChange={onChange} />
      <div style={{ width: 48, height: 6, borderRadius: 99, background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)` }} />
    </div>
  )
}

function FormElement({ el, questionNumber, value, onChange, readOnly, timestamps = [] }) {
  if (el.type === 'text_block') {
    return (
      <div className="prose form-markdown-block">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={url => url}
          components={{
            img: ({ src, alt }) => <img src={resolveMarkdownAsset(src, el.assets || [])} alt={alt || ''} />,
          }}
        >
          {el.content || ''}
        </ReactMarkdown>
      </div>
    )
  }

  if (el.type === 'checkbox') {
    const checked = value === true
    const na = isNA(value)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: readOnly ? 'default' : 'pointer', opacity: na ? 0.55 : 1 }}
          onClick={() => !readOnly && onChange(checked ? false : true)}>
          <div style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
            border: `2px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: checked ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'border-color 0.1s, background 0.1s',
          }}>
            {checked && <Check size={11} color="#fff" strokeWidth={3} />}
          </div>
          <span style={{ fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>
            Checked
          </span>
        </div>
        {el.has_na && <NAToggle selected={na} onChange={onChange} readOnly={readOnly} />}
      </div>
    )
  }

  if (el.type === 'likert_group') {
    const scale = el.scale || 5
    const points = Array.from({ length: scale }, (_, i) => i + 1)
    const COL_W = 38
    const items = el.items || []
    const groupVal = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {}
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 6, borderBottom: '1.5px solid var(--border)' }}>
          <div style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>{el.low_label ? `1 = ${el.low_label}` : '1'}</div>
          {el.has_na && <div style={{ width: COL_W, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>N/A</div>}
          {points.map(p => <div key={p} style={{ width: COL_W, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>{p}</div>)}
        </div>
        {items.map((item, i) => {
          const itemVal = groupVal[item.id]
          return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '5px 6px', background: i % 2 === 1 ? 'rgba(0,0,0,0.025)' : 'transparent', borderRadius: 4 }}>
              <div style={{ flex: 1, fontSize: 13, paddingRight: 10, lineHeight: 1.4 }}>{item.label || `Statement ${i + 1}`}</div>
              {el.has_na && (
                <div style={{ width: COL_W, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <RadioDot selected={itemVal === 'N/A'} onClick={() => onChange({ ...groupVal, [item.id]: itemVal === 'N/A' ? undefined : 'N/A' })} readOnly={readOnly} />
                </div>
              )}
              {points.map(p => (
                <div key={p} style={{ width: COL_W, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <RadioDot selected={itemVal === p} onClick={() => onChange({ ...groupVal, [item.id]: itemVal === p ? undefined : p })} readOnly={readOnly} />
                </div>
              ))}
            </div>
          )
        })}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
          {el.high_label ? `${scale} = ${el.high_label}` : scale}
        </div>
      </div>
    )
  }

  if (el.type === 'short_answer') {
    const na = isNA(value)
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FocusInput value={na ? '' : value} onChange={e => onChange(e.target.value)} placeholder={el.placeholder || ''} disabled={readOnly || na} />
          {el.has_na && <NAToggle selected={na} onChange={onChange} readOnly={readOnly} />}
        </div>
      </div>
    )
  }

  if (el.type === 'paragraph') {
    const na = isNA(value)
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FocusTextarea value={na ? '' : value} onChange={e => onChange(e.target.value)} placeholder={el.placeholder || ''} disabled={readOnly || na} />
          {el.has_na && <NAToggle selected={na} onChange={onChange} readOnly={readOnly} />}
        </div>
      </div>
    )
  }

  if (el.type === 'multiple_choice') {
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(el.options || []).map((opt, i) => {
            const optionValue = opt || `Option ${i + 1}`
            return (
              <ChoiceButton key={`${i}:${opt}`} selected={value === optionValue} onClick={() => !readOnly && onChange(value === optionValue ? null : optionValue)} readOnly={readOnly} multiSelect={false}>{optionValue}</ChoiceButton>
            )
          })}
          {el.has_na && (
            <ChoiceButton selected={isNA(value)} onClick={() => !readOnly && onChange(isNA(value) ? null : 'N/A')} readOnly={readOnly} multiSelect={false}>N/A</ChoiceButton>
          )}
        </div>
      </div>
    )
  }

  if (el.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    const na = isNA(value)
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(el.options || []).map((opt, i) => {
            const optionValue = opt || `Option ${i + 1}`
            return (
              <ChoiceButton key={`${i}:${opt}`} selected={!na && selected.includes(optionValue)}
                onClick={() => { if (readOnly) return; const isSel = selected.includes(optionValue); onChange(isSel ? selected.filter(x => x !== optionValue) : [...selected, optionValue]) }}
                readOnly={readOnly} multiSelect={true}>{optionValue}
              </ChoiceButton>
            )
          })}
          {el.has_na && (
            <ChoiceButton selected={na} onClick={() => !readOnly && onChange(na ? [] : 'N/A')} readOnly={readOnly} multiSelect={false}>N/A</ChoiceButton>
          )}
        </div>
      </div>
    )
  }

  if (el.type === 'rating') {
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(el.options || []).map((opt, i) => {
            const optionValue = opt || `Option ${i + 1}`
            const selected = value === optionValue
            return (
              <button key={`${i}:${opt}`} disabled={readOnly} onClick={() => !readOnly && onChange(selected ? null : optionValue)}
                style={{
                  padding: '5px 12px', border: '1.5px solid',
                  borderColor: selected ? 'var(--accent)' : 'var(--border)', borderRadius: 20,
                  background: selected ? 'var(--accent-light)' : 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--text)',
                  fontSize: 13, fontWeight: selected ? 600 : 400, cursor: readOnly ? 'default' : 'pointer',
                  transition: 'border-color 0.1s, background 0.1s, color 0.1s', fontFamily: 'var(--font)',
                }}>{optionValue}</button>
            )
          })}
          {el.has_na && (
            <button disabled={readOnly} onClick={() => !readOnly && onChange(isNA(value) ? null : 'N/A')}
              style={{
                padding: '5px 12px', border: '1.5px solid',
                borderColor: isNA(value) ? 'var(--accent)' : 'var(--border)', borderRadius: 20,
                background: isNA(value) ? 'var(--accent-light)' : 'transparent',
                color: isNA(value) ? 'var(--accent)' : 'var(--text)',
                fontSize: 13, fontWeight: isNA(value) ? 600 : 400, cursor: readOnly ? 'default' : 'pointer',
                transition: 'border-color 0.1s, background 0.1s, color 0.1s', fontFamily: 'var(--font)',
              }}>N/A</button>
          )}
        </div>
      </div>
    )
  }

  if (el.type === 'likert') {
    const scale = el.scale || 5
    const points = Array.from({ length: scale }, (_, i) => i + 1)
    const allOptions = el.has_na ? ['N/A', ...points] : points
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ marginBottom: 7 }}>
          <ScaleEndpointLabels low={el.low_label} high={el.high_label} min={1} max={scale} />
        </div>
        <SegmentedControl options={allOptions} value={value} onChange={onChange} readOnly={readOnly} />
      </div>
    )
  }

  if (el.type === 'slider') {
    const min = el.min ?? 0
    const max = el.max ?? 100
    const step = el.step ?? 1
    const na = isNA(value)
    const val = na ? min : (value ?? min)
    const bounded = Math.min(max, Math.max(min, Number(val)))
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, opacity: na ? 0.55 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <ScaleEndpointLabels low={el.low_label} high={el.high_label} min={min} max={max} inset={HORIZONTAL_SLIDER_INSET} />
              <HorizontalSliderInput
                min={min}
                max={max}
                step={step}
                value={bounded}
                disabled={readOnly || na}
                onChange={onChange}
              />
              <SliderTicks min={min} max={max} step={step} inset={HORIZONTAL_SLIDER_INSET} />
              <SliderScaleLabels labels={el.scale_labels} min={min} max={max} />
            </div>
            <NumericStepper
              value={bounded}
              min={min}
              max={max}
              step={step}
              disabled={readOnly || na}
              onChange={onChange}
            />
          </div>
        </div>
        {el.has_na && <div style={{ marginTop: 6 }}><NAToggle selected={na} onChange={onChange} readOnly={readOnly} /></div>}
      </div>
    )
  }

  if (el.type === 'dial' || el.type === 'vertical_slider') {
    const min = el.min ?? 0
    const max = el.max ?? 100
    const step = el.step ?? 1
    const count = Math.min(5, Math.max(1, Number(el.count || 1)))
    const na = isNA(value)
    const values = Array.isArray(value) ? value : Array(count).fill(null)

    function updateAt(index, nextValue) {
      if (readOnly || na) return
      const next = Array.from({ length: count }, (_, i) => {
        if (Array.isArray(value) && i < value.length) return value[i]
        return null
      })
      next[index] = Math.min(max, Math.max(min, Number(nextValue)))
      onChange(next)
    }

    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start', opacity: na ? 0.55 : 1 }}>
          {Array.from({ length: count }, (_, idx) => {
            const current = values[idx]
            const safeCurrent = Number.isFinite(current) ? current : min
            const label = controlLabel(el, idx, count)
            const lowLabel = controlEndpointLabel(el, 'low', idx)
            const highLabel = controlEndpointLabel(el, 'high', idx)
            return el.type === 'dial' ? (
              <DialControl
                key={`${el.id}-${idx}`}
                value={safeCurrent}
                min={min}
                max={max}
                step={step}
                disabled={readOnly || na}
                onChange={next => updateAt(idx, next)}
                label={label}
                lowLabel={lowLabel}
                highLabel={highLabel}
                scaleLabels={el.scale_labels}
              />
            ) : (
              <VerticalSliderControl
                key={`${el.id}-${idx}`}
                value={safeCurrent}
                min={min}
                max={max}
                step={step}
                disabled={readOnly || na}
                onChange={next => updateAt(idx, next)}
                label={label}
                lowLabel={lowLabel}
                highLabel={highLabel}
              />
            )
          })}
        </div>
        {el.has_na && <div style={{ marginTop: 8 }}><NAToggle selected={na} onChange={onChange} readOnly={readOnly} /></div>}
      </div>
    )
  }

  if (el.type === 'timestamp_select') {
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <TimestampSelectInput timestamps={timestamps} value={value} onChange={onChange} readOnly={readOnly} allowNA={!!el.has_na} />
      </div>
    )
  }

  if (el.type === 'table') {
    const rows = el.rows || []
    const columns = el.columns || []
    const tableVal = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {}
    return (
      <div>
        <QLabel el={el} questionNumber={questionNumber} />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, fontFamily: 'var(--font)' }}>
            <thead>
              <tr>
                <th style={thStyle} />
                {columns.map((col, colIndex) => (
                  <th key={col.id} style={{ ...thStyle, minWidth: col.type === 'timestamp_select' ? 190 : 100 }}>
                    {col.label || `Column ${colIndex + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((rowLabel, ri) => {
                const rowVal = (tableVal[String(ri)] && typeof tableVal[String(ri)] === 'object') ? tableVal[String(ri)] : {}
                return (
                  <tr key={ri}>
                    <td style={rowHeaderStyle}>{rowLabel || `Row ${ri + 1}`}</td>
                    {columns.map(col => (
                      <td key={col.id} style={{ padding: '4px 6px', border: '1px solid var(--border)', verticalAlign: 'middle' }}>
                        <TableCell
                          col={col}
                          value={rowVal[col.id]}
                          onChange={v => onChange({ ...tableVal, [String(ri)]: { ...rowVal, [col.id]: v } })}
                          readOnly={readOnly}
                          timestamps={timestamps}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return null
}

const thStyle = {
  padding: '5px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
}

const rowHeaderStyle = {
  padding: '5px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
}

function TimestampSelectInput({ timestamps, value, onChange, readOnly, compact = false, allowNA = false }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function fmtTs(ts) {
    const m = Math.floor(ts.time_seconds / 60)
    const s = String(Math.floor(ts.time_seconds % 60)).padStart(2, '0')
    return `${m}:${s}`
  }

  function displayText() {
    if (isNA(value)) return 'N/A'
    if (!value || typeof value !== 'object') return compact ? '—' : 'Select timestamp…'
    const time = fmtTs(value)
    return value.tag_label ? `${time} — ${value.tag_label}` : time
  }

  const filtered = timestamps.filter(ts => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      fmtTs(ts).includes(q) ||
      (ts.tag_label || '').toLowerCase().includes(q) ||
      (ts.description || '').toLowerCase().includes(q) ||
      (ts.notes || '').toLowerCase().includes(q)
    )
  })

  function timestampSelectionKey(ts) {
    if (!ts || typeof ts !== 'object') return ''
    if (ts.id != null) return `id:${ts.id}`
    return `${ts.time_seconds ?? ''}:${ts.tag_label || ''}`
  }

  const selectedKey = timestampSelectionKey(value)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        disabled={readOnly}
        onClick={() => !readOnly && setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          padding: compact ? '4px 8px' : '7px 12px',
          border: `1.5px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: compact ? 4 : 8,
          background: 'var(--bg)',
          color: (isNA(value) || (value && typeof value === 'object')) ? 'var(--text)' : 'var(--text-muted)',
          fontSize: compact ? 12 : 13,
          cursor: readOnly ? 'default' : 'pointer',
          fontFamily: 'var(--font)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayText()}
        </span>
        <ChevronDown size={compact ? 11 : 13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 9999,
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow-lg)',
          marginTop: 3, maxHeight: 260, display: 'flex', flexDirection: 'column',
          minWidth: compact ? 240 : '100%',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by time, tag, notes…"
              style={{
                width: '100%', fontSize: 12, padding: '4px 8px',
                border: '1px solid var(--border)', borderRadius: 5,
                background: 'var(--bg-secondary)', outline: 'none',
                fontFamily: 'var(--font)', color: 'var(--text)', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {value && typeof value === 'object' && (
              <button
                className="dropdown-item"
                style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}
                onClick={() => { onChange(null); setOpen(false); setSearch('') }}
              >
                Clear selection
              </button>
            )}
            {allowNA && (
              <button
                className="dropdown-item"
                style={{
                  fontSize: 12,
                  background: isNA(value) ? 'var(--accent-light)' : undefined,
                  color: isNA(value) ? 'var(--accent)' : undefined,
                  fontWeight: isNA(value) ? 600 : undefined,
                }}
                onClick={() => { onChange(isNA(value) ? null : 'N/A'); setOpen(false); setSearch('') }}
              >
                N/A
              </button>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                {timestamps.length === 0 ? 'No timestamps logged yet' : 'No timestamps match'}
              </div>
            ) : filtered.map(ts => {
              const isSelected = selectedKey && selectedKey === timestampSelectionKey(ts)
              return (
                <button
                  key={ts.id != null ? ts.id : ts.time_seconds}
                  className="dropdown-item"
                  style={{
                    fontSize: 12,
                    background: isSelected ? 'var(--accent-light)' : undefined,
                    color: isSelected ? 'var(--accent)' : undefined,
                    fontWeight: isSelected ? 600 : undefined,
                    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                  }}
                  onClick={() => {
                    onChange({
                      id: ts.id ?? null,
                      time_seconds: ts.time_seconds,
                      tag_id: ts.tag_id ?? null,
                      tag_label: ts.tag_label || null,
                      tag_color: ts.tag_color || null,
                      notes: ts.notes || '',
                    })
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>
                    {fmtTs(ts)}
                  </span>
                  {ts.tag_label && (
                    <span style={{ background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 3, padding: '1px 5px', fontSize: 11, flexShrink: 0 }}>
                      {ts.tag_label}
                    </span>
                  )}
                  {(ts.description || ts.notes) && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {ts.description || ts.notes}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function TableCell({ col, value, onChange, readOnly, timestamps }) {
  const na = isNA(value)
  const cellInputStyle = {
    width: '100%', padding: '4px 6px', fontSize: 12,
    border: '1px solid var(--border)', borderRadius: 4,
    background: 'var(--bg)', color: 'var(--text)',
    fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box',
  }
  if (col.type === 'number') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          type="number"
          value={na ? '' : (value ?? '')}
          disabled={readOnly || na}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          style={cellInputStyle}
        />
        {col.has_na && <NAToggle selected={na} onChange={onChange} readOnly={readOnly} compact />}
      </div>
    )
  }
  if (col.type === 'select') {
    return (
      <select
        value={na ? 'N/A' : (value || '')}
        disabled={readOnly}
        onChange={e => onChange(e.target.value || null)}
        style={{ ...cellInputStyle, color: value ? 'var(--text)' : 'var(--text-muted)' }}
      >
        <option value="">—</option>
        {(col.options || []).map((opt, i) => {
          const optionValue = opt || `Option ${i + 1}`
          return <option key={`${i}:${opt}`} value={optionValue}>{optionValue}</option>
        })}
        {col.has_na && <option value="N/A">N/A</option>}
      </select>
    )
  }
  if (col.type === 'checkbox') {
    const checked = value === true
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          type="button"
          disabled={readOnly || na}
          onClick={() => !readOnly && !na && onChange(checked ? false : true)}
          style={{
            ...cellInputStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 30,
            cursor: readOnly || na ? 'default' : 'pointer',
            background: checked ? 'var(--accent-light)' : 'var(--bg)',
          }}
        >
          <span style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `2px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: checked ? 'var(--accent)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {checked && <Check size={11} color="#fff" strokeWidth={3} />}
          </span>
        </button>
        {col.has_na && <NAToggle selected={na} onChange={onChange} readOnly={readOnly} compact />}
      </div>
    )
  }
  if (col.type === 'timestamp_select') {
    return (
      <TimestampSelectInput timestamps={timestamps} value={value} onChange={onChange} readOnly={readOnly} compact allowNA={!!col.has_na} />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        type="text"
        value={na ? '' : (value || '')}
        disabled={readOnly || na}
        onChange={e => onChange(e.target.value || null)}
        style={cellInputStyle}
      />
      {col.has_na && <NAToggle selected={na} onChange={onChange} readOnly={readOnly} compact />}
    </div>
  )
}
