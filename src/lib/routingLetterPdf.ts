import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

// The routing letter, written in VMS (Dana, Nov 12: "when its done Can it be somewhere in vms where I can edit it
// anytime?"). Dana edits the words; VMS draws the PDF the vendors get. Body text: a line starting with "- " is a bullet,
// a blank line starts a new paragraph, **words** are bold, [words](https://…) is a link, and a bare https:// address
// becomes a link too.

export interface LetterSection { heading: string; body: string }
export interface RoutingLetterContent { title: string; subtitle: string; intro: string; sections: LetterSection[]; closing: string; footer: string }

export const DEFAULT_LETTER: RoutingLetterContent = {
  title: 'Freight Routing Instructions',
  subtitle: 'Shaver Lake Sports Inc. · Effective November 2026',
  intro: 'These instructions apply to all open and future purchase orders from Shaver Lake Sports and replace all earlier routing instructions, including those from PartnerShip and Parcel Management Group.',
  sections: [
    {
      heading: '1. Before you ship: check the freight cost',
      body: [
        '- **10% or less of the merchandise cost:** go ahead and ship with your carrier and add the freight to the invoice.',
        '- **Over 10%:** please do not ship. Send us your freight quote and fill out our Shipment Details form at [vms.shaverlakesports.com/ship/new](https://vms.shaverlakesports.com/ship/new) (the link is also in our order email). Trevor, our Inventory & Logistics Specialist, will schedule the shipment, by UPS for boxes or LTL for pallets, and let you know when it will be picked up.',
        '- **Free freight** (you pay the shipping): use the carrier of your choice.',
      ].join('\n'),
    },
    {
      heading: '2. Packing boxes for UPS',
      body: [
        'UPS charges by size as well as weight, so how an order is packed changes what it costs. Please:',
        '- Pack the order in the fewest boxes possible, without going over the carrier\'s size and weight limits.',
        '- Use the smallest box that protects the product. UPS bills the greater of the actual weight or the **dimensional weight** (length × width × height, divided by UPS\'s divisor), so an oversized or half-empty box is billed as if it were heavier.',
        '- Keep each box at **50 lbs or less**. UPS adds an Additional Handling charge to boxes over 50 lbs.',
        '- Avoid long or oversized boxes. UPS adds Additional Handling and Large Package charges based on size.',
        '- UPS\'s own guide: [ups.com › How to avoid additional shipping fees](https://www.ups.com/us/en/support/shipping-support/shipping-dimensions-weight/avoid-additional-shipping-fees.page)',
      ].join('\n'),
    },
    {
      heading: 'Why packing matters to us',
      body: [
        'UPS charges for every box, and it bills by box size as well as weight. A box that isn\'t full is billed as if it were heavier: UPS multiplies length × width × height, divides by 139, and bills whichever is greater, that or the actual weight. An 18" × 18" × 18" box is billed as **42 lbs** even if what\'s inside weighs 15 lbs. Shaver Lake is also on UPS\'s remote-area list, so **every box costs us an extra $16.50** before fuel and fees.',
        '',
        'Two recent orders show what this costs us:',
        '- **23 boxes, some weighing only 1 to 4 lbs, at $31.75 to $37.07 each.** The freight came to $887.48, 70% of the merchandise cost. Packed into a few full boxes, it would have been a fraction of that.',
        '- **13 boxes that weighed 179 lbs were billed as 302 lbs** because of their size. The freight was $1,140.99. Packed into fewer, fuller boxes, the same order would have cost about $780 to $845.',
        '',
        'Please pack our orders in the fewest, fullest boxes possible. When packing doesn\'t follow these instructions, we will ask you to credit the extra freight.',
      ].join('\n'),
    },
    {
      heading: '3. Every shipment',
      body: [
        '- Our PO number on every box, the packing list and the invoice.',
        '- Shaver Lake Sports will not pay freight or handling charges added to an invoice unless agreed in advance.',
        '- Failure to follow these instructions after 10 days from receipt may result in shipping charges being charged back.',
      ].join('\n'),
    },
    {
      heading: '4. Ship to',
      body: '**Shaver Lake Sports**\n41777 Tollhouse Road\nShaver Lake, CA 93664\n\nWe have a forklift on site. **No lift gate is needed.**',
    },
    { heading: '5. Questions', body: 'Please contact Trevor Jenkins, our Inventory & Logistics Specialist, at [orders@shaverlakesports.com](mailto:orders@shaverlakesports.com).' },
  ],
  closing: 'Thank you for helping us keep freight costs down.',
  footer: 'Shaver Lake Sports Inc. · 41777 Tollhouse Road, Shaver Lake, CA 93664 · Mailing: P.O. Box 60, Shaver Lake, CA 93664 · shaverlakesports.com',
}

/** A piece of text with its style. */
export interface Run { text: string; bold?: boolean; url?: string }
export type Block = { kind: 'para'; lines: Run[][] } | { kind: 'bullet'; runs: Run[] } | { kind: 'gap' }

/** **bold**, [words](url) and bare https:// / mailto: addresses. */
export function parseRuns(text: string): Run[] {
  const out: Run[] = []
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)|((?:https?:\/\/)[^\s)]+)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) {
      // bold may hold a link: keep it simple, bold text only
      out.push({ text: m[1], bold: true })
    } else if (m[2] !== undefined) out.push({ text: m[2], url: m[3] })
    else out.push({ text: m[4], url: m[4] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.filter((r) => r.text.length > 0)
}

/** Lines into paragraphs (lines kept as line breaks), bullets and blank-line gaps. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = []
  let para: Run[][] | null = null
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*[-•*]\s+/.test(line)) {
      para = null
      blocks.push({ kind: 'bullet', runs: parseRuns(line.replace(/^\s*[-•*]\s+/, '')) })
    } else if (!line.trim()) {
      para = null
      if (blocks.length && blocks[blocks.length - 1].kind !== 'gap') blocks.push({ kind: 'gap' })
    } else if (para) {
      para.push(parseRuns(line.trim()))
    } else {
      para = [parseRuns(line.trim())]
      blocks.push({ kind: 'para', lines: para })
    }
  }
  while (blocks.length && blocks[blocks.length - 1].kind === 'gap') blocks.pop()
  return blocks
}

const GREEN = rgb(0x2f / 255, 0x6f / 255, 0x4f / 255)
const INK = rgb(0x1c / 255, 0x19 / 255, 0x17 / 255)
const GRAY = rgb(0x57 / 255, 0x53 / 255, 0x4e / 255)
const RULE = rgb(0xd6 / 255, 0xd3 / 255, 0xd1 / 255)
const LINK = rgb(0x1d / 255, 0x4e / 255, 0xd8 / 255)
const BEIGE = rgb(0xf5 / 255, 0xf0 / 255, 0xe6 / 255)

const W = 612
const H = 792
const MX = 54
const TOP = 40
const BOTTOM = 60
const SIZE = 10
const LEAD = 13.2

/** The standard PDF fonts only know Western characters: anything else is swapped for a near one or dropped. */
function safe(font: PDFFont, s: string): string {
  const swaps: Record<string, string> = { '≥': '>=', '≤': '<=', '→': '->', '✓': 'v', ' ': ' ', ' ': ' ', ' ': ' ' }
  let out = ''
  for (const ch of s) {
    const c = swaps[ch] ?? ch
    try { font.encodeText(c); out += c } catch { /* not in the font */ }
  }
  return out
}

interface Word { text: string; bold: boolean; url?: string; space: boolean }

function words(runs: Run[], fonts: { reg: PDFFont; bold: PDFFont }): Word[] {
  const out: Word[] = []
  for (const r of runs) {
    const font = r.bold ? fonts.bold : fonts.reg
    const parts = safe(font, r.text).split(/(\s+)/)
    for (const p of parts) {
      if (!p) continue
      if (/^\s+$/.test(p)) { if (out.length) out[out.length - 1].space = true; continue }
      out.push({ text: p, bold: !!r.bold, url: r.url, space: false })
    }
  }
  return out
}

class Writer {
  page!: PDFPage
  y = 0
  private doc: PDFDocument
  private fonts: { reg: PDFFont; bold: PDFFont }
  private footer: string
  constructor(doc: PDFDocument, fonts: { reg: PDFFont; bold: PDFFont }, footer: string) {
    this.doc = doc
    this.fonts = fonts
    this.footer = footer
    this.newPage()
  }

  newPage() {
    this.page = this.doc.addPage([W, H])
    this.y = H - TOP
    if (this.footer) {
      const f = this.fonts.reg
      const lines = this.wrapPlain(safe(f, this.footer), f, 8, W - 2 * MX)
      let fy = 26 + (lines.length - 1) * 10
      this.page.drawLine({ start: { x: MX, y: fy + 12 }, end: { x: W - MX, y: fy + 12 }, thickness: 0.6, color: RULE })
      for (const l of lines) {
        this.page.drawText(l, { x: (W - f.widthOfTextAtSize(l, 8)) / 2, y: fy, size: 8, font: f, color: GRAY })
        fy -= 10
      }
    }
  }

  need(h: number) { if (this.y - h < BOTTOM) this.newPage() }

  wrapPlain(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = []
    let line = ''
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w } else line = t
    }
    if (line) out.push(line)
    return out
  }

  centered(text: string, size: number, bold: boolean, color = INK) {
    const font = bold ? this.fonts.bold : this.fonts.reg
    for (const l of this.wrapPlain(safe(font, text), font, size, W - 2 * MX)) {
      this.need(size * 1.3)
      this.page.drawText(l, { x: (W - font.widthOfTextAtSize(l, size)) / 2, y: this.y - size, size, font, color })
      this.y -= size * 1.3
    }
  }

  /** Lay out words in lines at x..x+width; draw=false only measures. Returns the lines' count. */
  flow(ws: Word[], x: number, width: number, draw: boolean, size = SIZE): number {
    const lines: Word[][] = []
    let cur: Word[] = []
    let curW = 0
    for (const w of ws) {
      const font = w.bold ? this.fonts.bold : this.fonts.reg
      const ww = font.widthOfTextAtSize(w.text, size)
      const sp = cur.length && cur[cur.length - 1].space ? this.fonts.reg.widthOfTextAtSize(' ', size) : 0
      if (cur.length && curW + sp + ww > width) { lines.push(cur); cur = [w]; curW = ww } else { cur.push(w); curW += sp + ww }
    }
    if (cur.length) lines.push(cur)
    if (draw) {
      for (const line of lines) {
        this.need(LEAD)
        let cx = x
        const base = this.y - size
        // words of the same style go out as one piece of text with real spaces (copy and search work in the PDF)
        const pieces: { text: string; bold: boolean; url?: string; spaceAfter: boolean }[] = []
        for (let i = 0; i < line.length; i++) {
          const w = line[i]
          const prev = pieces[pieces.length - 1]
          const space = w.space && i < line.length - 1
          if (prev && prev.spaceAfter && prev.bold === w.bold && prev.url === w.url) {
            prev.text += ` ${w.text}`
            prev.spaceAfter = space
          } else if (prev && !prev.spaceAfter && prev.bold === w.bold && prev.url === w.url) {
            prev.text += w.text
            prev.spaceAfter = space
          } else pieces.push({ text: w.text, bold: w.bold, url: w.url, spaceAfter: space })
        }
        for (const p of pieces) {
          const font = p.bold ? this.fonts.bold : this.fonts.reg
          const text = p.spaceAfter ? `${p.text} ` : p.text
          const tw = font.widthOfTextAtSize(p.text, size)
          this.page.drawText(text, { x: cx, y: base, size, font, color: p.url ? LINK : INK })
          if (p.url) {
            this.page.drawLine({ start: { x: cx, y: base - 1.2 }, end: { x: cx + tw, y: base - 1.2 }, thickness: 0.5, color: LINK })
            this.link(cx, base - 2, cx + tw, base + size, p.url)
          }
          // a style change (plain → bold or a link) gets a slightly wider gap, so the words never look run together
          cx += font.widthOfTextAtSize(text, size) + (p.spaceAfter ? 1.2 : 0)
        }
        this.y -= LEAD
      }
    }
    return lines.length
  }

  link(x1: number, y1: number, x2: number, y2: number, url: string) {
    const ctx = this.doc.context
    const annot = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [x1, y1, x2, y2], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    }))
    const annots = this.page.node.lookup(PDFName.of('Annots'))
    if (annots && 'push' in annots) (annots as unknown as { push: (r: unknown) => void }).push(annot)
    else this.page.node.set(PDFName.of('Annots'), ctx.obj([annot]))
  }

  intro(text: string) {
    const ws = words(parseRuns(text), this.fonts)
    const width = W - 2 * MX - 24
    const n = this.flow(ws, 0, width, false)
    const h = n * LEAD + 12
    this.need(h + 6)
    this.page.drawRectangle({ x: MX, y: this.y - h, width: W - 2 * MX, height: h, color: BEIGE })
    this.page.drawRectangle({ x: MX, y: this.y - h, width: 3.5, height: h, color: GREEN })
    this.y -= 6
    this.flow(ws, MX + 14, width, true)
    this.y -= 6 + 6
  }

  heading(text: string) {
    this.need(40)
    this.y -= 6
    const f = this.fonts.bold
    this.page.drawText(safe(f, text), { x: MX, y: this.y - 12, size: 12, font: f, color: GREEN })
    this.y -= 16
    this.page.drawLine({ start: { x: MX, y: this.y }, end: { x: W - MX, y: this.y }, thickness: 0.6, color: RULE })
    this.y -= 4
  }

  body(text: string) {
    for (const b of parseBody(text)) {
      if (b.kind === 'gap') { this.y -= 5; continue }
      if (b.kind === 'bullet') {
        const ws = words(b.runs, this.fonts)
        this.need(LEAD)
        this.page.drawText('•', { x: MX + 4, y: this.y - SIZE, size: SIZE, font: this.fonts.reg, color: INK })
        this.flow(ws, MX + 16, W - 2 * MX - 16, true)
        this.y -= 2
      } else {
        for (const line of b.lines) this.flow(words(line, this.fonts), MX, W - 2 * MX, true)
        this.y -= 2
      }
    }
  }
}

/** The letter as a PDF: logo, title, the shaded intro, the sections, the closing and a footer on every page. */
export async function buildRoutingLetterPdf(c: RoutingLetterContent, logoPng: Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(c.title || 'Freight Routing Instructions')
  doc.setAuthor('Shaver Lake Sports Inc.')
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  const w = new Writer(doc, fonts, c.footer)
  if (logoPng) {
    const img = await doc.embedPng(logoPng)
    const lw = 250
    const lh = (img.height / img.width) * lw
    w.page.drawImage(img, { x: (W - lw) / 2, y: w.y - lh, width: lw, height: lh })
    w.y -= lh + 12
  }
  if (c.title.trim()) w.centered(c.title, 19, true)
  if (c.subtitle.trim()) { w.y -= 2; w.centered(c.subtitle, 10, false, GRAY) }
  w.y -= 8
  if (c.intro.trim()) w.intro(c.intro)
  for (const s of c.sections) {
    if (s.heading.trim()) w.heading(s.heading)
    if (s.body.trim()) w.body(s.body)
  }
  if (c.closing.trim()) { w.y -= 8; w.body(c.closing) }
  return doc.save()
}

/** The letter's file name: "Shaver Lake Sports Routing Letter v3.pdf". */
export const routingLetterFileName = (version: number) => `Shaver Lake Sports Routing Letter v${version}.pdf`

/** Content saved on a version, or null when it was an uploaded PDF (or is not the expected shape). */
export function letterContentOf(v: unknown): RoutingLetterContent | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<RoutingLetterContent>
  if (typeof o.title !== 'string' || !Array.isArray(o.sections)) return null
  return {
    title: o.title, subtitle: String(o.subtitle ?? ''), intro: String(o.intro ?? ''), closing: String(o.closing ?? ''), footer: String(o.footer ?? ''),
    sections: o.sections.map((s) => ({ heading: String((s as LetterSection).heading ?? ''), body: String((s as LetterSection).body ?? '') })),
  }
}
