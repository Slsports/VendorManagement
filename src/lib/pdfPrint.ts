const MAX_PAGES = 80

/**
 * The PDF's pages as a printable page (Dana, Nov 9: Print in the viewer). Drawn by VMS like the preview, so it prints the
 * files the browser's own viewer refuses; one picture per sheet of paper, about 190 dpi.
 */
export async function pdfPrintHtml(blob: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
  try {
    const pdf = await task.promise
    const imgs: string[] = []
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
      const page = await pdf.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const view = page.getViewport({ scale: 1600 / Math.min(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(view.width)
      canvas.height = Math.floor(view.height)
      await page.render({ canvas, viewport: view }).promise
      imgs.push(`<img src="${canvas.toDataURL('image/jpeg', 0.92)}" alt="Page ${n}">`)
    }
    return `<style>@page{margin:0.25in}body{margin:0}img{display:block;width:100%;height:auto;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style>${imgs.join('')}`
  } finally {
    void task.destroy()
  }
}
