/** Split a scanned PDF into documents by page ranges (1-based, inclusive), in the browser. */
export async function splitPdf(file: File, ranges: { first: number; last: number }[]): Promise<File[]> {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  const pages = src.getPageCount()
  const base = file.name.replace(/\.pdf$/i, '')
  const out: File[] = []
  for (const r of ranges) {
    const first = Math.max(1, Math.min(r.first, pages))
    const last = Math.max(first, Math.min(r.last, pages))
    const doc = await PDFDocument.create()
    const copied = await doc.copyPages(src, Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i))
    copied.forEach((p) => doc.addPage(p))
    const bytes = await doc.save()
    out.push(new File([bytes as BlobPart], `${base} p${first}${last > first ? `-${last}` : ''}.pdf`, { type: 'application/pdf', lastModified: file.lastModified }))
  }
  return out
}
