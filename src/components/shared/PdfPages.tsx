import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui'

const MAX_PAGES = 80

/**
 * A PDF drawn by VMS itself, page by page (Dana, Oct 13: Dom's WFS PDF would not preview, only download). The
 * browser's own PDF viewer refuses some files and some devices inside a page; drawing the pages works everywhere.
 * Falls back to the browser's viewer if the file can't be read this way.
 */
export function PdfPages({ blob, url, name }: { blob: Blob; url: string; name: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading')
  const [more, setMore] = useState(0)

  useEffect(() => {
    let alive = true
    let destroy: (() => void) | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
        destroy = () => void task.destroy()
        const pdf = await task.promise
        const el = box.current
        if (!alive || !el) return
        el.replaceChildren()
        const width = Math.max(320, el.clientWidth - 32)
        const ratio = window.devicePixelRatio || 1
        const count = Math.min(pdf.numPages, MAX_PAGES)
        for (let n = 1; n <= count; n++) {
          const page = await pdf.getPage(n)
          if (!alive) return
          const base = page.getViewport({ scale: 1 })
          const view = page.getViewport({ scale: width / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(view.width * ratio)
          canvas.height = Math.floor(view.height * ratio)
          canvas.style.width = `${Math.floor(view.width)}px`
          canvas.style.maxWidth = '100%'
          canvas.className = 'mx-auto mb-4 block bg-white shadow'
          canvas.setAttribute('aria-label', `${name}, page ${n} of ${pdf.numPages}`)
          canvas.setAttribute('role', 'img')
          el.appendChild(canvas)
          await page.render({ canvas, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise
          if (n === 1 && alive) setState('done')
        }
        if (alive) setMore(Math.max(0, pdf.numPages - count))
      } catch {
        if (alive) setState('failed')
      }
    })()
    return () => { alive = false; destroy?.() }
  }, [blob, name])

  if (state === 'failed') return <iframe title={name} src={url} className="h-full w-full bg-white" />
  return (
    <div className="min-h-full bg-stone-100 p-4">
      {state === 'loading' ? <div className="flex justify-center py-24"><Spinner label="Opening…" className="text-brand" /></div> : null}
      <div ref={box} />
      {more ? <p className="text-center text-xs text-stone-500">Showing the first {MAX_PAGES} pages; {more} more in the download.</p> : null}
    </div>
  )
}
