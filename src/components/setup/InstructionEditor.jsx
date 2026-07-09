import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, Upload, FileText, File } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../lib/api'
import PdfViewer from '../ui/PdfViewer'

export default function InstructionEditor({ projectId, instruction, onSave, onCancel }) {
  const [name, setName] = useState(instruction.name || '')
  const [content, setContent] = useState(instruction.content || '')
  const [contentType, setContentType] = useState(instruction.content_type || 'markdown')
  const [filePath, setFilePath] = useState(instruction.file_path || null)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfError, setPdfError] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let active = true
    setPdfUrl(null)
    setPdfError('')
    if (contentType !== 'pdf' || !filePath) return () => { active = false }
    const loadUrl = instruction.id && filePath === instruction.file_path
      ? api.getInstructionFileUrl(instruction.id)
      : api.getUploadedPdfUrl(projectId, filePath)
    loadUrl.then(url => {
      if (!active) return
      if (url) setPdfUrl(url)
      else setPdfError('PDF file could not be loaded.')
    }).catch(() => {
      if (active) setPdfError('PDF file could not be loaded.')
    })
    return () => { active = false }
  }, [contentType, filePath, instruction.id, projectId])

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    await api.saveInstruction(projectId, {
      id: instruction.id || undefined,
      name: name.trim(),
      content,
      content_type: contentType,
      file_path: filePath || null,
    })
    onSave()
  }

  function handleMdUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setContent(ev.target.result)
      if (!name.trim()) setName(file.name.replace(/\.(md|txt|markdown)$/i, ''))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handlePdfUpload() {
    const path = await api.uploadPdf(projectId)
    if (!path) return
    setFilePath(path)
    if (!name.trim()) {
      const base = path.split('/').pop().replace(/^\d+-/, '').replace(/\.pdf$/i, '')
      setName(base)
    }
  }

  const isPdf = contentType === 'pdf'

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
            placeholder="Instruction page name"
            style={{ fontWeight: 600, fontSize: 14, border: 'none', background: 'transparent', outline: 'none', width: 280, padding: 0 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <button
              className={`btn btn-sm ${!isPdf ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: 0, borderRight: '1px solid var(--border)' }}
              onClick={() => setContentType('markdown')}
            >
              <FileText size={13} /> Markdown
            </button>
            <button
              className={`btn btn-sm ${isPdf ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderRadius: 0 }}
              onClick={() => setContentType('pdf')}
            >
              <File size={13} /> PDF
            </button>
          </div>

          {!isPdf && (
            <>
              <input ref={fileInputRef} type="file" accept=".md,.txt,.markdown" style={{ display: 'none' }} onChange={handleMdUpload} />
              <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} /> Import .md
              </button>
              <button className={`btn btn-sm ${preview ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPreview(p => !p)}>
                {preview ? 'Edit' : 'Preview'}
              </button>
            </>
          )}
          {isPdf && (
            <button className="btn btn-secondary btn-sm" onClick={handlePdfUpload}>
              <Upload size={13} /> {filePath ? 'Replace PDF' : 'Upload PDF'}
            </button>
          )}

          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!name.trim() || saving || (isPdf && !filePath)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {isPdf ? (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {filePath ? (
              pdfUrl ? (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <PdfViewer url={pdfUrl} title={name || 'PDF instruction'} />
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                  <File size={32} color="var(--text-secondary)" />
                  <p style={{ fontWeight: 500, fontSize: 14 }}>{filePath.split('/').pop().replace(/^\d+-/, '')}</p>
                  <p className="text-muted text-sm">{pdfError || 'Loading PDF…'}</p>
                </div>
              )
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                <File size={40} color="var(--text-muted)" />
                <p style={{ fontWeight: 500, fontSize: 14 }}>No PDF uploaded yet</p>
                <p className="text-muted text-sm">Click "Upload PDF" to attach a PDF file</p>
                <button className="btn btn-primary btn-sm" onClick={handlePdfUpload}>
                  <Upload size={13} /> Upload PDF
                </button>
              </div>
            )}
          </div>
        ) : !preview ? (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={`Write instructions in Markdown, or click "Import .md" to upload a file.\n\n# Section Title\n\nInstructions here. You can use **bold**, *italic*, lists, etc.\n\n## Sub-section\n\n- Point 1\n- Point 2`}
            style={{
              flex: 1, resize: 'none', border: 'none', outline: 'none',
              padding: '28px 32px', fontSize: 14, lineHeight: 1.7,
              fontFamily: 'monospace', background: 'var(--bg)',
            }}
          />
        ) : (
          <div className="prose" style={{ flex: 1, overflow: 'auto', padding: '28px 32px', maxWidth: 760 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*Nothing to preview*'}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
