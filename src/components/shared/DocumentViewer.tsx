import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, X } from 'lucide-react'
import { docType, saveBlob } from '@/lib/viewer'
import { cn, errorMessage } from '@/lib/utils'
import { Button, Spinner } from '@/components/ui'

export interface ViewerDoc {
  name: string
  mime?: string | null
  /** The file's bytes (a stored document, an email attachment). */
  load: () => Promise<Blob>
}

type Shown =
  | { kind: 'pdf' | 'image'; url: string }
  | { kind: 'sheet'; sheets: { name: string; rows: string[][]; more: number }[] }
  | { kind: 'word'; html: string }
  | { kind: 'text'; text: string }
  | { kind: 'other' }

const MAX_ROWS = 1000

/**
 * Look at a document without downloading it (Dana, Oct 8): PDFs and pictures as they are, spreadsheets as
 * tables with a tab per sheet, Word (.docx) as a page. Nothing leaves VMS to be shown. Download is there
 * for keeping a copy; anything the viewer cannot show (an old .doc) offers the download instead.
 */
export function DocumentViewer({ doc, onClose }: { doc: ViewerDoc; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState(0)

  useEffect(() => {
    let url: string | null = null
    let alive = true
    void (async () => {
      try {
        const b = await doc.load()
        if (!alive) return
        setBlob(b)
        const kind = docType(doc.name, doc.mime ?? b.type)
        if (kind === 'pdf' || kind === 'image') {
          url = URL.createObjectURL(kind === 'pdf' ? new Blob([b], { type: 'application/pdf' }) : b)
          setShown({ kind, url })
        } else if (kind === 'sheet') {
          const XLSX = await import('xlsx')
          const book = XLSX.read(await b.arrayBuffer(), { type: 'array', cellDates: true })
          setShown({
            kind, sheets: book.SheetNames.map((name) => {
              const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw: false, blankrows: false, defval: '' })
              return { name, rows: rows.slice(0, MAX_ROWS).map((r) => r.map((c) => String(c ?? ''))), more: Math.max(0, rows.length - MAX_ROWS) }
            }),
          })
        } else if (kind === 'word') {
          const mammoth = await import('mammoth')
          const res = await mammoth.convertToHtml({ arrayBuffer: await b.arrayBuffer() })
          setShown({ kind, html: res.value })
        } else if (kind === 'text') {
          setShown({ kind, text: await b.text() })
        } else {
          setShown({ kind: 'other' })
        }
      } catch (err) {
        if (alive) setError(errorMessage(err))
      }
    })()
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [doc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let body: ReactNode
  if (error) body = <p className="p-6 text-sm text-red-700">Could not open this file: {error}</p>
  else if (!shown) body = <div className="flex justify-center py-24"><Spinner label="Opening…" className="text-brand" /></div>
  else if (shown.kind === 'pdf') body = <iframe title={doc.name} src={shown.url} className="h-full w-full bg-white" />
  else if (shown.kind === 'image') body = <div className="flex min-h-full items-center justify-center bg-stone-100 p-4"><img src={shown.url} alt={doc.name} className="max-h-full max-w-full object-contain" /></div>
  else if (shown.kind === 'word') {
    // Shown in a sandbox with no scripts: the document is data, never code.
    body = <iframe title={doc.name} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-full w-full bg-white"
      srcDoc={`<base target="_blank"><style>body{font:15px/1.5 system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:1.5rem;color:#1c1917}table{border-collapse:collapse}td,th{border:1px solid #d6d3d1;padding:4px 8px}img{max-width:100%}</style>${shown.html}`} />
  } else if (shown.kind === 'text') body = <pre className="whitespace-pre-wrap break-words p-4 text-sm text-stone-800">{shown.text}</pre>
  else if (shown.kind === 'sheet') {
    const sheet = shown.sheets[tab] ?? shown.sheets[0]
    body = (
      <div className="flex h-full flex-col">
        {shown.sheets.length > 1 ? (
          <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-1 overflow-x-auto border-b border-stone-200 bg-stone-50 px-2 pt-2">
            {shown.sheets.map((s, i) => (
              <button key={s.name} type="button" role="tab" aria-selected={i === tab} onClick={() => setTab(i)}
                className={cn('whitespace-nowrap rounded-t-lg px-3 py-1.5 text-sm', i === tab ? 'bg-white font-semibold text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{s.name}</button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {sheet && sheet.rows.length ? (
            <table className="border-collapse text-xs">
              <tbody>
                {sheet.rows.map((r, i) => (
                  <tr key={i} className={i === 0 ? 'bg-stone-50 font-semibold' : ''}>
                    {r.map((c, j) => <td key={j} className="whitespace-nowrap border border-stone-200 px-2 py-1 text-stone-800">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-6 text-sm text-stone-500">This sheet is empty.</p>}
          {sheet?.more ? <p className="p-3 text-xs text-stone-500">Showing the first {MAX_ROWS} rows; {sheet.more} more in the download.</p> : null}
        </div>
      </div>
    )
  } else {
    body = (
      <div className="p-6 text-sm text-stone-700">
        <p>VMS can't show this kind of file. Download it to open it on your computer.</p>
        {blob ? <Button className="mt-3" onClick={() => saveBlob(blob, doc.name)} leftIcon={<Download className="size-4" aria-hidden="true" />}>Download</Button> : null}
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-900/50 sm:p-4" role="dialog" aria-modal="true" aria-label={doc.name}>
      <div className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900">{doc.name}</h2>
          {shown && (shown.kind === 'pdf' || shown.kind === 'image') ? (
            <a href={shown.url} target="_blank" rel="noreferrer" className="hidden rounded-md p-1.5 text-stone-500 hover:bg-stone-100 sm:inline-flex" title="Open in a new tab"><ExternalLink className="size-5" aria-hidden="true" /><span className="sr-only">Open in a new tab</span></a>
          ) : null}
          <Button size="sm" variant="secondary" disabled={!blob} onClick={() => blob && saveBlob(blob, doc.name)} leftIcon={<Download className="size-4" aria-hidden="true" />}>Download</Button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      </div>
    </div>,
    document.body,
  )
}
