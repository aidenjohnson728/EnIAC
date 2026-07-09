import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const FIT_WIDTH_RATIO = 0.92
const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5]

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function PdfPage({ pdf, pageNumber, zoom, availableWidth, registerPage }) {
  const canvasRef = useRef(null)
  const pageRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    registerPage(pageNumber, pageRef.current)
    return () => registerPage(pageNumber, null)
  }, [pageNumber, registerPage])

  useEffect(() => {
    let cancelled = false
    let renderTask = null

    async function render() {
      setError('')
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const naturalViewport = page.getViewport({ scale: 1 })
        const scale = zoom === 'fit'
          ? clamp((availableWidth * FIT_WIDTH_RATIO) / naturalViewport.width, MIN_ZOOM, MAX_ZOOM)
          : zoom
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return

        const outputScale = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setError('Page could not be rendered.')
        }
      }
    }

    render()
    return () => {
      cancelled = true
      if (renderTask) renderTask.cancel()
    }
  }, [pdf, pageNumber, zoom, availableWidth])

  return (
    <div
      ref={pageRef}
      data-page-number={pageNumber}
      style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}
    >
      {error ? (
        <div className="empty-state" style={{ minHeight: 240, width: '100%' }}>
          <p className="text-sm">{error}</p>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            maxWidth: 'none',
            background: '#fff',
            boxShadow: '0 1px 6px rgba(15, 23, 42, 0.08)',
          }}
        />
      )}
    </div>
  )
}

export default function PdfViewer({ url, title = 'PDF' }) {
  const scrollRef = useRef(null)
  const pageRefs = useRef(new Map())
  const [pdf, setPdf] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [firstPageWidth, setFirstPageWidth] = useState(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [editingPageInput, setEditingPageInput] = useState(false)
  const [zoom, setZoom] = useState('fit')
  const [zoomInput, setZoomInput] = useState('100')
  const [editingZoomInput, setEditingZoomInput] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let task = null
    setPdf(null)
    setPageCount(0)
    setFirstPageWidth(null)
    setError('')
    setCurrentPage(1)
    setPageInput('1')
    setEditingPageInput(false)
    setZoom('fit')
    setZoomInput('100')
    setEditingZoomInput(false)

    if (!url) {
      setError('PDF file not found.')
      return () => { active = false }
    }

    import('pdfjs-dist').then(pdfjsLib => {
      if (!active) return
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
      task = pdfjsLib.getDocument(url)
      return task.promise
    }).then(async doc => {
      if (!active || !doc) return
      setPdf(doc)
      setPageCount(doc.numPages)
      try {
        const firstPage = await doc.getPage(1)
        if (active) setFirstPageWidth(firstPage.getViewport({ scale: 1 }).width)
      } catch {
        if (active) setFirstPageWidth(null)
      }
    }).catch(() => {
      if (active) setError('PDF file could not be loaded.')
    })

    return () => {
      active = false
      if (task) task.destroy()
    }
  }, [url])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const updateWidth = () => setContainerWidth(el.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pdf])

  const availablePageWidth = useMemo(() => {
    return Math.max(220, containerWidth - 16)
  }, [containerWidth])

  const fitZoomPercent = useMemo(() => {
    if (!firstPageWidth) return 100
    return Math.round(clamp((availablePageWidth * FIT_WIDTH_RATIO) / firstPageWidth, MIN_ZOOM, MAX_ZOOM) * 100)
  }, [availablePageWidth, firstPageWidth])

  const registerPage = useCallback((pageNumber, node) => {
    if (node) pageRefs.current.set(pageNumber, node)
    else pageRefs.current.delete(pageNumber)
  }, [])

  const goToPage = useCallback((pageNumber) => {
    const next = clamp(Number(pageNumber) || 1, 1, pageCount || 1)
    const scrollEl = scrollRef.current
    const pageEl = pageRefs.current.get(next)
    setCurrentPage(next)
    setPageInput(String(next))
    setEditingPageInput(false)
    if (scrollEl && pageEl) {
      scrollEl.scrollTo({ top: pageEl.offsetTop - 6, behavior: 'smooth' })
    }
  }, [pageCount])

  function handleScroll() {
    const el = scrollRef.current
    if (!el || pageRefs.current.size === 0) return
    const containerRect = el.getBoundingClientRect()
    const targetY = containerRect.top + 36
    let visible = 1
    for (const [pageNumber, node] of Array.from(pageRefs.current.entries()).sort((a, b) => a[0] - b[0])) {
      const rect = node.getBoundingClientRect()
      if (rect.top <= targetY && rect.bottom > targetY) {
        visible = pageNumber
        break
      }
      if (rect.top < targetY) visible = pageNumber
    }
    if (visible !== currentPage) {
      setCurrentPage(visible)
      if (!editingPageInput) setPageInput(String(visible))
    }
  }

  function stepZoom(direction) {
    if (zoom === 'fit') {
      const next = direction > 0 ? 1 : 0.75
      setZoom(next)
      setZoomInput(String(Math.round(next * 100)))
      return
    }
    const idx = ZOOM_STEPS.findIndex(step => step >= zoom)
    const base = idx < 0 ? ZOOM_STEPS.length - 1 : idx
    const next = ZOOM_STEPS[clamp(base + direction, 0, ZOOM_STEPS.length - 1)]
    setZoom(next)
    setZoomInput(String(Math.round(next * 100)))
  }

  function setFitZoom() {
    setZoom('fit')
    setZoomInput(String(fitZoomPercent))
    setEditingZoomInput(false)
  }

  function commitZoomInput(value) {
    const percent = clamp(Number(value) || 100, Math.round(MIN_ZOOM * 100), Math.round(MAX_ZOOM * 100))
    setZoom(percent / 100)
    setZoomInput(String(percent))
    setEditingZoomInput(false)
  }

  if (error) {
    return <div className="empty-state" style={{ minHeight: 360 }}><p className="text-sm">{error}</p></div>
  }

  if (!pdf) {
    return <div className="empty-state" style={{ minHeight: 360 }}><div className="spinner" /></div>
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: 40,
          padding: '6px 10px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-secondary)' }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button className="btn btn-ghost btn-icon btn-sm" title="Previous page" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page</span>
          <input
            value={pageInput}
            onFocus={e => {
              setEditingPageInput(true)
              e.currentTarget.select()
            }}
            onChange={e => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => goToPage(pageInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            aria-label="Page number"
            style={{ width: 42, height: 28, textAlign: 'center', fontSize: 12, padding: '0 4px' }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 52 }}>of {pageCount}</span>
          <button className="btn btn-ghost btn-icon btn-sm" title="Next page" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount}>
            <ChevronRight size={14} />
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
          <button className="btn btn-ghost btn-icon btn-sm" title="Zoom out" onClick={() => stepZoom(-1)}>
            <Minus size={14} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              value={editingZoomInput ? zoomInput : zoom === 'fit' ? String(fitZoomPercent) : zoomInput}
              onFocus={e => {
                setEditingZoomInput(true)
                setZoomInput(zoom === 'fit' ? String(fitZoomPercent) : zoomInput)
                e.currentTarget.select()
              }}
              onChange={e => setZoomInput(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => commitZoomInput(zoomInput)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              aria-label="Zoom percentage"
              title={`Zoom percentage (${Math.round(MIN_ZOOM * 100)}-${Math.round(MAX_ZOOM * 100)}%)`}
              style={{ width: 46, height: 28, textAlign: 'center', fontSize: 12, padding: '0 4px' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
          </div>
          <button
            className={`btn btn-sm ${zoom === 'fit' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ height: 28, fontSize: 12, padding: '0 8px' }}
            title="Fit width"
            onClick={setFitZoom}
          >
            Fit
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" title="Zoom in" onClick={() => stepZoom(1)}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 8px 28px' }}
      >
        {containerWidth > 0 ? (
          Array.from({ length: pageCount }, (_, i) => (
            <PdfPage
              key={i + 1}
              pdf={pdf}
              pageNumber={i + 1}
              zoom={zoom}
              availableWidth={availablePageWidth}
              registerPage={registerPage}
            />
          ))
        ) : (
          <div className="empty-state" style={{ minHeight: 360 }}><div className="spinner" /></div>
        )}
      </div>
    </div>
  )
}
