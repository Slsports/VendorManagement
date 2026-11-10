// The Sno-Park report as a printable PDF (Dana, Nov 10, 2026: "Cat would need to print that form to accompany the check")
// and the packet filed in VMS: the form first, then the photos of the book covers in the order they were added. A copy of
// the State's form OHV 54SP laid out with pdf-lib: the same boxes and numbers as the Excel VMS also makes, plus the Unsold
// box and the declaration the printed form has and the Excel does not. Deno only.
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1'

export interface FormRow { kind: 'day' | 'season'; book_number: string | null; from_permit: number; to_permit: number; qty: number; amount: number; commission: number; due: number }
export interface FormInput {
  seasonLabel: string
  title: string                      // "DECEMBER 2026 SUBMISSION" or "END OF SEASON REPORT"
  kind: 'monthly' | 'final'
  preparedOn: string                 // YYYY-MM-DD
  store: { name: string; address: string; cityStateZip: string; phone: string }
  prices: { day: [number, number]; season: [number, number] }
  day: FormRow[]
  season: FormRow[]
  unsold: { kind: 'day' | 'season'; book_number: string | null; from_permit: number; to_permit: number; qty: number }[]
  totals: { dayQty: number; dayAmount: number; dayCommission: number; dayDue: number; seasonQty: number; seasonAmount: number; seasonCommission: number; seasonDue: number; totalDue: number }
  declaredBy: string | null
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const mdy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y}` }
const BLACK = rgb(0, 0, 0), GREY = rgb(0.45, 0.45, 0.45), LIGHT = rgb(0.93, 0.93, 0.93)

/** The report form, one or two letter pages. */
export async function formPdf(f: FormInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Sno-Park ${f.title} ${f.seasonLabel}`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page = doc.addPage(PageSizes.Letter)
  const W = page.getWidth(), L = 40, R = W - 40
  let y = page.getHeight() - 44
  const text = (s: string, x: number, size = 9, fnt: PDFFont = font, color = BLACK) => page.drawText(s, { x, y, size, font: fnt, color })
  const right = (s: string, xRight: number, size = 9, fnt: PDFFont = font) => page.drawText(s, { x: xRight - fnt.widthOfTextAtSize(s, size), y, size, font: fnt })
  const line = (x1: number, x2: number, yy = y - 3) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: BLACK })
  const newPageIfNeeded = (need: number) => { if (y - need < 60) { page = doc.addPage(PageSizes.Letter); y = page.getHeight() - 44 } }
  const box = (title: string) => {
    newPageIfNeeded(30)
    page.drawRectangle({ x: L, y: y - 4, width: R - L, height: 14, color: LIGHT })
    text(title, L + 6, 8.5, bold)
    y -= 20
  }
  const field = (label: string, value: string, x: number, xEnd: number) => {
    page.drawText(label, { x, y, size: 7, font, color: GREY })
    const lw = font.widthOfTextAtSize(label, 7) + 4
    page.drawText(value, { x: x + lw, y, size: 9, font: bold })
    line(x + lw, xEnd)
  }
  const wrap = (s: string, x: number, xEnd: number, size: number) => {
    let cur = ''
    for (const w of s.split(' ')) {
      const t = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(t, size) > xEnd - x && cur) { text(cur, x, size); y -= size + 3; cur = w } else cur = t
    }
    if (cur) { text(cur, x, size); y -= size + 3 }
  }
  const table = (title: string, rows: FormRow[], price: [number, number], tot: { qty: number; amount: number; commission: number; due: number }, subtotalLabel: string) => {
    const cols = [L, L + 70, L + 140, L + 200, L + 300, L + 410, R]   // from | including | qty | collected | commission | due
    const heads = ['FROM', 'INCLUDING', 'QTY SOLD', `COLLECTED (${money(price[0])} ea)`, `COMMISSION (${money(price[1])} ea)`, `DUE TO STATE (${money(price[0] - price[1])} ea)`]
    newPageIfNeeded(60 + rows.length * 14)
    box(title)
    heads.forEach((h, i) => page.drawText(h, { x: cols[i]! + 3, y, size: 6.5, font: bold, maxWidth: cols[i + 1]! - cols[i]! - 6, lineHeight: 7 }))
    y -= 14
    line(L, R, y + 10)
    const printRow = (vals: string[], fnt: PDFFont = font) => {
      vals.forEach((v, i) => {
        if (i < 2) page.drawText(v, { x: cols[i]! + 3, y, size: 9, font: fnt })
        else page.drawText(v, { x: cols[i + 1]! - 4 - fnt.widthOfTextAtSize(v, 9), y, size: 9, font: fnt })
      })
      line(L, R)
      y -= 14
    }
    for (const r of rows) printRow([String(r.from_permit), String(r.to_permit), String(r.qty), money(r.amount), money(r.commission), money(r.due)])
    if (!rows.length) printRow(['—', '—', '0', money(0), money(0), money(0)])
    page.drawText(subtotalLabel, { x: L + 3, y, size: 8, font: bold })
    const sub = [String(tot.qty), money(tot.amount), money(tot.commission), money(tot.due)]
    sub.forEach((v, i) => page.drawText(v, { x: cols[i + 3]! - 4 - bold.widthOfTextAtSize(v, 9), y, size: 9, font: bold }))
    y -= 10
  }

  // header
  text('STATE OF CALIFORNIA · DEPARTMENT OF PARKS AND RECREATION · OHMVR DIVISION', L, 7.5, font, GREY)
  right(f.seasonLabel, R, 16, bold)
  y -= 16
  text('SNO-PARK VENDOR REPORT OF OPERATIONS', L, 14, bold)
  y -= 13
  text('CALIFORNIA SNO-PARK PERMIT PROGRAM · FORM OHV 54SP (copy made by VMS)', L, 8, font, GREY)
  right(f.title, R, 10, bold)
  y -= 18

  box('VENDOR INFORMATION')
  field('BUSINESS NAME:', f.store.name, L, 300); field('TELEPHONE NUMBER:', f.store.phone, 330, R); y -= 14
  field('MAILING ADDRESS:', f.store.address, L, 300); field('DATE PREPARED:', mdy(f.preparedOn), 330, R); y -= 14
  field('CITY / STATE / ZIP CODE:', f.store.cityStateZip, L, 300); y -= 20

  table('DAY PERMITS SOLD (RANGES)', f.day, f.prices.day, { qty: f.totals.dayQty, amount: f.totals.dayAmount, commission: f.totals.dayCommission, due: f.totals.dayDue }, 'DAY PERMIT SUBTOTALS')
  y -= 10
  table('SEASON PERMITS SOLD (RANGES)', f.season, f.prices.season, { qty: f.totals.seasonQty, amount: f.totals.seasonAmount, commission: f.totals.seasonCommission, due: f.totals.seasonDue }, 'SEASON PERMIT SUBTOTALS')
  y -= 8
  newPageIfNeeded(40)
  page.drawRectangle({ x: L, y: y - 8, width: R - L, height: 20, color: LIGHT })
  text('GRAND TOTAL AMOUNT DUE TO STATE', L + 6, 10, bold)
  right(money(f.totals.totalDue), R - 6, 11, bold)
  y -= 30

  if (f.kind === 'final') {
    newPageIfNeeded(80)
    box('UNSOLD PERMITS RETURNED (END OF SEASON)')
    for (const [label, k] of [['Day-use permits:', 'day'], ['Season permits:', 'season']] as const) {
      const rs = f.unsold.filter((u) => u.kind === k)
      const s = rs.length ? rs.map((u) => `${u.from_permit}-${u.to_permit}${u.book_number ? ` (book ${u.book_number})` : ''}`).join(', ') : 'None'
      const n = rs.reduce((t, u) => t + u.qty, 0)
      newPageIfNeeded(30)
      text(label, L, 9, bold)
      wrap(`${s}${rs.length ? ` · ${n} permit${n === 1 ? '' : 's'}` : ''}`, L + 95, R, 9)
      y -= 6
    }
    y -= 8
  }

  newPageIfNeeded(90)
  box('DECLARATION')
  wrap('I declare under penalty of perjury under the laws of the State of California that the foregoing is true and correct, and that the permits listed above were sold at the authorized price.', L, R, 8.5)
  y -= 14
  field('PRINTED NAME:', f.declaredBy ?? '', L, 260); field('TITLE:', '', 290, R); y -= 22
  field('SIGNATURE:', '', L, 260); field('DATE:', '', 290, R); y -= 22
  box('FOR DEPARTMENT USE ONLY')
  field('CHECK DATE:', '', L, 200); field('CHECK NUMBER:', '', 230, 400); field('AMOUNT:', '', 430, R); y -= 10
  return await doc.save()
}

export interface PacketPart { name: string; mime: string | null; bytes: Uint8Array }

/** The packet: the form, then each cover photo on its own page (a PDF part is appended as is). Parts VMS cannot read are skipped and named. */
export async function packetPdf(form: Uint8Array, parts: PacketPart[]): Promise<{ bytes: Uint8Array; skipped: string[] }> {
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const skipped: string[] = []
  const add = async (pdfBytes: Uint8Array) => {
    const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) out.addPage(p)
  }
  await add(form)
  for (const p of parts) {
    try {
      const isPdf = /pdf/i.test(p.mime ?? '') || /\.pdf$/i.test(p.name) || (p.bytes[0] === 0x25 && p.bytes[1] === 0x50 && p.bytes[2] === 0x44 && p.bytes[3] === 0x46)
      if (isPdf) { await add(p.bytes); continue }
      const isPng = p.bytes[0] === 0x89 && p.bytes[1] === 0x50
      const isJpg = p.bytes[0] === 0xff && p.bytes[1] === 0xd8
      if (!isPng && !isJpg) { skipped.push(p.name); continue }
      const img = isPng ? await out.embedPng(p.bytes) : await out.embedJpg(p.bytes)
      const page: PDFPage = out.addPage(PageSizes.Letter)
      const margin = 36
      const maxW = page.getWidth() - margin * 2, maxH = page.getHeight() - margin * 2 - 14
      const scale = Math.min(maxW / img.width, maxH / img.height)
      const w = img.width * scale, h = img.height * scale
      page.drawImage(img, { x: (page.getWidth() - w) / 2, y: page.getHeight() - margin - h, width: w, height: h })
      page.drawText(p.name, { x: margin, y: margin / 2, size: 7, font, color: GREY })
    } catch {
      skipped.push(p.name)
    }
  }
  return { bytes: await out.save(), skipped }
}
