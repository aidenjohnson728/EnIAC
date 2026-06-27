import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function TutorialBubble({ targetId, placement = 'bottom', title, body, step, total, onNext, onSkip }) {
  const [rect, setRect] = useState(null)

  useEffect(() => {
    if (!targetId) return
    const el = document.getElementById(targetId)
    if (!el) return
    const update = () => setRect(el.getBoundingClientRect())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [targetId])

  if (!rect) return null

  const W = 296
  const GAP = 12

  // Bubble position
  let top, left
  if (placement === 'bottom') {
    top = rect.bottom + GAP
    left = Math.max(8, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 8))
  } else if (placement === 'top') {
    top = rect.top - GAP - 130 // rough height estimate, repositions after render
    left = Math.max(8, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 8))
  } else if (placement === 'right') {
    top = rect.top + rect.height / 2 - 70
    left = rect.right + GAP
  }

  // Arrow horizontal offset relative to bubble left edge
  const arrowX = Math.max(12, Math.min((rect.left + rect.width / 2) - left - 7, W - 26))

  const accent = '#6366f1'

  return createPortal(
    <>
      {/* Transparent click-away backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
        onClick={onSkip}
      />
      {/* Highlight ring around target */}
      <div style={{
        position: 'fixed',
        top: rect.top - 3, left: rect.left - 3,
        width: rect.width + 6, height: rect.height + 6,
        borderRadius: 8,
        outline: `2px solid ${accent}`,
        outlineOffset: 1,
        pointerEvents: 'none',
        zIndex: 10001,
      }} />
      {/* Bubble */}
      <div style={{
        position: 'fixed',
        top, left, width: W,
        background: accent,
        color: 'white',
        borderRadius: 10,
        padding: '14px 16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
        zIndex: 10002,
        fontFamily: 'var(--font)',
      }}>
        {/* Arrow (points up for bottom placement) */}
        {placement === 'bottom' && (
          <div style={{
            position: 'absolute', top: -7, left: arrowX,
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderBottom: `7px solid ${accent}`,
          }} />
        )}
        {placement === 'top' && (
          <div style={{
            position: 'absolute', bottom: -7, left: arrowX,
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: `7px solid ${accent}`,
          }} />
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
          <button
            onClick={onSkip}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.65)', cursor: 'pointer', padding: 0, lineHeight: 1, marginLeft: 8, flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.55, margin: 0, marginBottom: 14, color: 'rgba(255,255,255,0.88)' }}>{body}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{step} of {total}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onSkip}
              style={{ background: 'rgba(255,255,255,0.14)', border: 'none', color: 'rgba(255,255,255,0.85)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}
            >
              Skip
            </button>
            <button
              onClick={onNext}
              style={{ background: 'white', border: 'none', color: accent, borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
            >
              {step === total ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
