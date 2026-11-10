// The State's Sno-Park forms filled by VMS (Dana, Nov 10, 2026): the vendor agreement (OHV 56SP) and the permit request
// form (OHV 145SP). Neither PDF has fillable boxes, so the words go onto the page at the places the 2026-2027 forms use
// (measured from Dana's own signed 2026-2027 agreement). A later form laid out differently shows up at once on the draft
// Dana reads before she sends it. Deno only.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'npm:pdf-lib@1.17.1'

export interface AgreementInfo {
  business_name: string; owner: string; fein: string; county_license: string; resale: string
  street: string; city: string; state: string; zip: string; county: string; phone: string; additional_locations: boolean
  public_email: string; website: string; sold_on_website: boolean
  contact: string; contact_title: string; direct_phone: string; direct_email: string
  mailing_street: string; mailing_city: string; mailing_state: string; mailing_zip: string
  package_street: string; package_city: string; package_state: string; package_zip: string
  year_round: boolean; hours: string[]
}

const INK = rgb(0.05, 0.05, 0.25)

/**
 * pdftotext measures from the top-left of the page box; pdf-lib draws from the box's own origin, and the State's PDFs
 * have a box that starts at (-11.96, 11.96). These turn measured positions into drawing positions.
 */
function placer(page: PDFPage) {
  const box = page.getMediaBox()
  return { X: (x: number) => box.x + x, Y: (yTop: number) => box.y + box.height - yTop }
}

/** A PNG or JPEG signature embedded once per document. */
async function embedSignature(doc: PDFDocument, bytes: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes) return null
  try { return bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes) } catch { return null }
}

/** Draw the signature so it fits a box: x, baseline y (pdf coordinates), max width and height. */
function drawSignature(page: PDFPage, img: PDFImage | null, x: number, yTop: number, maxW: number, maxH: number) {
  if (!img) return
  const { X, Y } = placer(page)
  const scale = Math.min(maxW / img.width, maxH / img.height)
  page.drawImage(img, { x: X(x), y: Y(yTop) - 2, width: img.width * scale, height: img.height * scale })
}

const mdy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y}` }

/** Form OHV 56SP, three pages: the store's answers on page 1, the signature block on page 2. */
export async function fillAgreement(blank: Uint8Array, d: { info: AgreementInfo; signedOn: string; signature: Uint8Array | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(blank, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sig = await embedSignature(doc, d.signature)
  const [p1, p2] = doc.getPages()
  if (!p1 || !p2) throw new Error('The agreement form does not have its two pages')
  const i = d.info
  const t = (page: PDFPage, s: string, x: number, yTop: number, size = 10) => { const { X, Y } = placer(page); page.drawText(s, { x: X(x), y: Y(yTop), size, font, color: INK }) }
  // page 1: y is the baseline measured from the top of the page (from the signed form)
  t(p1, i.business_name, 46, 215.5, 12); t(p1, i.owner, 335, 215.5, 11)
  t(p1, i.fein, 46.5, 239); t(p1, i.county_license, 220, 239); t(p1, i.resale, 393.4, 239)
  t(p1, i.street, 47, 262, 11); t(p1, i.city, 278, 262, 11); t(p1, i.state, 392.7, 262, 11); t(p1, i.zip, 451, 262, 11)
  t(p1, i.county, 47, 285, 11); t(p1, i.phone, 161.7, 285, 11)
  t(p1, 'X', i.additional_locations ? 397 : 426, 288.5, 9)
  t(p1, i.public_email, 47, 309); t(p1, i.website, 266.4, 306)
  t(p1, 'X', i.sold_on_website ? 475.5 : 508.5, 311.5, 9)
  t(p1, i.contact, 47, 345.5); t(p1, i.direct_phone, 220, 345.5); t(p1, i.direct_email, 392.7, 345.5)
  t(p1, i.mailing_street, 47, 369, 11); t(p1, i.mailing_city, 277.5, 369, 11); t(p1, i.mailing_state, 392.7, 369, 11); t(p1, i.mailing_zip, 450.3, 369, 11)
  t(p1, i.package_street, 46.5, 392, 11); t(p1, i.package_city, 278, 392, 11); t(p1, i.package_state, 393.4, 392, 11); t(p1, i.package_zip, 451, 392, 11)
  t(p1, 'X', i.year_round ? 274.5 : 310.5, 427, 9)
  const hx = [162.3, 219.9, 277.5, 335.8, 393.4, 451, 508.6]
  i.hours.slice(0, 7).forEach((h, k) => t(p1, h, hx[k]!, 496, 11))
  // page 2: VENDOR APPROVAL
  t(p2, i.business_name, 50, 583, 10)
  drawSignature(p2, sig, 75, 605, 180, 30)
  t(p2, mdy(d.signedOn), 400, 603, 11)
  t(p2, i.contact, 50, 626, 10); t(p2, i.contact_title, 360, 626, 10)
  t(p2, i.direct_phone, 50, 647, 10); t(p2, i.direct_email, 295, 647, 10)
  return await doc.save()
}

export interface OrderInfo { business_name: string; phone: string; street: string; city_state_zip: string; requested_by: string; requested_title: string; approver: string; approver_title: string; approver_phone: string; approver_email: string }

/** Form OHV 145SP: the request half (the State fills the rest when the books ship). */
export async function fillOrderForm(blank: Uint8Array, d: { info: OrderInfo; dayBooks: number; seasonBooks: number; perBook: { day: number; season: number }; prices: { day: [number, number]; season: [number, number] }; requestedOn: string; signature: Uint8Array | null; comment?: string | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(blank, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sig = await embedSignature(doc, d.signature)
  const p = doc.getPages()[0]
  if (!p) throw new Error('The permit request form has no page')
  const { X, Y } = placer(p)
  const t = (s: string, x: number, yTop: number, size = 10, fnt: PDFFont = font) => p.drawText(s, { x: X(x), y: Y(yTop), size, font: fnt, color: INK })
  const right = (s: string, xRight: number, yTop: number, size = 10) => p.drawText(s, { x: X(xRight) - font.widthOfTextAtSize(s, size), y: Y(yTop), size, font, color: INK })
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const i = d.info
  t(i.business_name, 42, 200); t(i.phone, 372, 200)
  t(i.street, 42, 220); t(i.city_state_zip, 372, 220)
  t(i.requested_by, 42, 240); t(i.requested_title, 303, 240); t(mdy(d.requestedOn), 506, 240, 9)
  const row = (books: number, per: number, price: [number, number], yTop: number) => {
    if (!books) return
    const permits = books * per
    right(String(books), 285, yTop); right(String(permits), 358, yTop)
    right(money(permits * price[0]), 420, yTop, 9); right(money(permits * price[1]), 500, yTop, 9); right(money(permits * (price[0] - price[1])), 556, yTop, 9)
  }
  row(d.dayBooks, d.perBook.day, d.prices.day, 309.5)
  row(d.seasonBooks, d.perBook.season, d.prices.season, 329)
  if (d.comment) t(d.comment.slice(0, 110), 42, 372, 9)
  t(i.approver, 42, 423); t(i.approver_title, 373, 423)
  drawSignature(p, sig, 90, 444, 150, 18)
  t(mdy(d.requestedOn), 488, 443, 9)
  t(i.approver_phone, 42, 464); t(i.approver_email, 303, 464)
  return await doc.save()
}
