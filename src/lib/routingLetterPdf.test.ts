import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { DEFAULT_LETTER, buildRoutingLetterPdf, letterContentOf, parseBody, parseRuns } from './routingLetterPdf'

describe('routing letter text', () => {
  it('reads bold, links and bare addresses', () => {
    expect(parseRuns('a **b** [c](https://x.com/y) d https://e.com')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', url: 'https://x.com/y' }, { text: ' d ' }, { text: 'https://e.com', url: 'https://e.com' },
    ])
    expect(parseRuns('[orders@x.com](mailto:orders@x.com)')).toEqual([{ text: 'orders@x.com', url: 'mailto:orders@x.com' }])
  })

  it('splits bullets, paragraphs and gaps', () => {
    const b = parseBody('Intro line\nsecond line\n\n- one\n- **two**\n\n\nEnd')
    expect(b.map((x) => x.kind)).toEqual(['para', 'gap', 'bullet', 'bullet', 'gap', 'para'])
    expect(b[0].kind === 'para' && b[0].lines.length).toBe(2)
  })

  it('reads saved content back, and nothing from an uploaded PDF', () => {
    expect(letterContentOf(DEFAULT_LETTER)?.sections.length).toBe(DEFAULT_LETTER.sections.length)
    expect(letterContentOf(null)).toBeNull()
    expect(letterContentOf({ foo: 1 })).toBeNull()
  })

  it('draws the default letter on one page', async () => {
    const logo = new Uint8Array(readFileSync('public/brand/sls/email-logo@2x.png'))
    const bytes = await buildRoutingLetterPdf(DEFAULT_LETTER, logo)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeLessThanOrEqual(2)
    if (process.env.ROUTING_LETTER_OUT) writeFileSync(process.env.ROUTING_LETTER_OUT, bytes)
  })

  it('drops characters the PDF fonts cannot draw instead of failing', async () => {
    const bytes = await buildRoutingLetterPdf({ ...DEFAULT_LETTER, intro: 'Freight ≥ 10% 😀 → quote' }, null)
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('matches the sending side (gmail-send draws each order\'s copy with its own form link)', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/lib/routingLetterPdf.ts'), 'utf8').split('\n').slice(1).join('\n')
    const fn = readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/routingLetterPdf.ts'), 'utf8').split('\n').slice(1).join('\n')
    expect(app).toBe(fn)
  })
})
