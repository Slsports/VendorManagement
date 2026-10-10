import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { splitPdf } from './pdfSplit'

describe('splitting a scanned stack', () => {
  it('makes one PDF per document by page ranges', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 3; i++) doc.addPage()
    const file = new File([(await doc.save()) as BlobPart], 'stack.pdf', { type: 'application/pdf' })
    const parts = await splitPdf(file, [{ first: 1, last: 2 }, { first: 3, last: 3 }])
    expect(parts.map((p) => p.name)).toEqual(['stack p1-2.pdf', 'stack p3.pdf'])
    const pages = await Promise.all(parts.map(async (p) => (await PDFDocument.load(await p.arrayBuffer())).getPageCount()))
    expect(pages).toEqual([2, 1])
  })
})
