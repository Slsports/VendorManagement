// Which attachments and links in an email are worth saving to the vendor's files, and as what
// (docs/orders-and-mail-plan.md §2). Pure functions, shared by gmail-sync and the tests.

export type FileKind = 'price_list' | 'catalog' | 'specials' | 'order_form' | 'other'

const KIND_WORDS: [FileKind, RegExp][] = [
  ['order_form', /order ?(form|writer|sheet|guide)|\bo\.?w\.?\b|reorder form|booking form/i],
  ['price_list', /price ?(list|sheet|book)|pricing|\bmsrp\b|wholesale (prices|list)|\bprices\b/i],
  ['specials', /special|promo|\bdeal|close ?out|clearance|\bsale\b|discount|show (offer|program)|buy group/i],
  ['catalog', /catalog|catalogue|line ?sheet|lookbook|look book|brochure|collection|new arrivals|\bline ?list/i],
]

/** "Fall 2026 Price List.pdf" + subject → price_list. The file name decides first, then the subject. */
export function guessKind(fileOrText: string, subject: string | null): FileKind {
  const name = fileOrText.replace(/[_\-.]+/g, ' ')
  for (const [kind, re] of KIND_WORDS) if (re.test(name)) return kind
  for (const [kind, re] of KIND_WORDS) if (re.test(subject ?? '')) return kind
  return 'other'
}

const SEASON = /\b(spring|summer|fall|autumn|winter|holiday|christmas)\s*[-/']?\s*(20\d\d|\d\d)\b|\b(20\d\d)\s*(spring|summer|fall|autumn|winter|holiday)\b/i

/** "Fall 2026" from the file name or subject; otherwise the month it arrived ("Oct 2026"). */
export function seasonLabel(text: string, receivedAt: string): string {
  const m = text.replace(/[_]+/g, ' ').match(SEASON)
  if (m) {
    const season = (m[1] ?? m[4])!
    let year = (m[2] ?? m[3])!
    if (year.length === 2) year = `20${year}`
    const s = season.toLowerCase() === 'autumn' ? 'Fall' : season[0]!.toUpperCase() + season.slice(1).toLowerCase()
    return `${s} ${year}`
  }
  const d = new Date(receivedAt)
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'America/Los_Angeles' })
}

const DOC = /\.(pdf|xlsx?|xlsm|csv|numbers|docx?)$/i
const IMAGE = /\.(png|jpe?g|gif|webp|heic)$/i

/**
 * Save this attachment? Documents and real pictures from offers mail; from other mail only when the name
 * says it is a price list, catalog, specials or order form. Signature logos (image001.png, tiny pictures)
 * never; anything over the file limit stays in the email.
 */
export function wantAttachment(a: { file_name: string; size: number | null }, view: 'attention' | 'offers', subject: string | null, maxBytes = 15 * 1024 * 1024): FileKind | null {
  if (a.size && a.size > maxBytes) return null
  const doc = DOC.test(a.file_name)
  const image = IMAGE.test(a.file_name) && !/^(image|img|logo|outlook|signature|banner)[-_ ]?\d*\./i.test(a.file_name) && (a.size ?? 0) >= 100 * 1024
  if (!doc && !image) return null
  const kind = guessKind(a.file_name, view === 'offers' ? subject : null)
  // plain pictures go to Images through the pictures step (itemPicture), never "Other"
  if (image && !doc && kind === 'other') return null
  if (view === 'offers') return kind
  return kind === 'other' ? null : kind
}

export interface FoundLink { url: string; text: string }

/** Every link in an HTML body with its visible text. */
export function extractLinks(html: string): FoundLink[] {
  const out: FoundLink[] = []
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const url = m[1]!.replace(/&amp;/g, '&').trim()
    const text = m[2]!.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (/^https?:\/\//i.test(url)) out.push({ url, text })
  }
  return out
}

const SKIP = /unsubscribe|preferences|view (this|it|email) in|web ?version|privacy|facebook\.|instagram\.|twitter\.|x\.com\/|linkedin\.|youtube\.|tiktok\.|pinterest\.|mailto:|list-manage\.com\/(un|profile)|forward to a friend/i

/** A link worth keeping: a PDF or spreadsheet, or one whose words say catalog, price list, order form or line sheet. */
export function wantLink(l: FoundLink, subject: string | null): FileKind | null {
  if (SKIP.test(l.url) || SKIP.test(l.text)) return null
  const path = l.url.split(/[?#]/)[0]!
  const words = `${l.text} ${decodeURIComponent(path.split('/').pop() ?? '')}`
  const kind = guessKind(words, null)
  if (DOC.test(path)) return kind === 'other' ? guessKind('', subject) : kind
  if (/catalog|catalogue|price ?list|line ?sheet|order ?form|lookbook|look book/i.test(l.text)) return kind === 'other' ? 'catalog' : kind
  return null
}

// ---- order paperwork (Dana, Oct 10) ----
const CONFIRM = /order ?confirm|confirmation|acknowledg|\back\b|sales ?order|\bs\.?o\.? ?#? ?\d|pro ?forma|order ?(receipt|summary)/i
const INVOICE = /invoice|\binv\b|\binv ?#? ?\d|\binv\d/i
const PAPER_FILE = /\.(pdf|png|jpe?g)$/i

const SHEET_FILE = /\.(xlsx|xlsm|xls|csv)$/i
/** Spreadsheets that are lists, not paperwork: price lists, catalogs, order forms and writers, specials, stock (ATS), UPC and
 * cost lists, guides, sales reports. */
const SHEET_NOT_PAPER = /price|catalog|order ?form|special|line ?sheet|inventory|availability|stock|sales|report|program|booking|pre-?season|show|upc|costs?\b|guide|wri?ti?t?er|entry form|\bats\b|flat file|new items|items only|importer|\beof\b|template/i
const NOT_PAPER = /credit|statement|price ?list|catalog|packing|\bbol\b|quote|specials?\b|w-?9|\bcoi\b|certificate|flyer|brochure|line ?sheet|order ?form|lookbook/i

/**
 * A vendor's spreadsheet that may be paperwork (Dana, Oct 15: Panther Martin's rep sent his copy of our order, with his
 * changes, as Excel): not a price list, catalog, order form or report by its name.
 */
export function maybeSheetPaperwork(a: { file_name: string }): boolean {
  return SHEET_FILE.test(a.file_name) && !SHEET_NOT_PAPER.test(a.file_name) && !NOT_PAPER.test(a.file_name)
}

const CREDIT = /credit ?(memo|note)|\bcm ?#? ?\d|\bcredit\b/i
const PAPER_SKIP = /^(image|img|logo|outlook|signature|banner)[-_ ]?\d*\./i

/**
 * A vendor's order confirmation, invoice or credit memo by its file name, then the email subject, then (when allowed) the
 * email's words; PDFs, pictures and order-copy spreadsheets (Oct 15), signature pictures never. Claude reads it afterwards and refiles it if wrong.
 * Credits (Dana, Oct 14: "an invoice filed that is an obvious credit") go to Credits and get no invoice check.
 */
export function paperworkKind(a: { file_name: string; size: number | null }, subject: string | null, body?: string | null): 'confirmation' | 'invoice' | 'credit' | null {
  const sheet = maybeSheetPaperwork(a)
  if ((!PAPER_FILE.test(a.file_name) && !sheet) || PAPER_SKIP.test(a.file_name)) return null
  if (/\.(png|jpe?g)$/i.test(a.file_name) && (a.size ?? 0) < 100 * 1024) return null
  const name = a.file_name.replace(/[_\-.]+/g, ' ')
  if (CREDIT.test(name)) return 'credit'
  // a return authorization or return label is not a bill (WFS "RA2500525.pdf")
  if (/^(ra|rma) ?#? ?\d/i.test(name) || /return (label|authori[sz]ation)/i.test(name)) return null
  if (!maybePaperwork(a) && !sheet) return null
  if (CONFIRM.test(name)) return 'confirmation'
  if (INVOICE.test(name)) return 'invoice'
  if (CREDIT.test(subject ?? '')) return 'credit'
  if (CONFIRM.test(subject ?? '')) return 'confirmation'
  if (INVOICE.test(subject ?? '') && !/statement|past due|reminder/i.test(subject ?? '')) return 'invoice'
  // then the email's own words (Dana, Oct 13: Dom's "S102112.pdf" said "sales order" only in the email), without the
  // earlier mail quoted under it (Oct 14: "credit memo attached" above a quoted "invoice" is a credit)
  const text = ownWords(body ?? '').slice(0, 2000)
  if (/return (label|authori[sz]ation)|\brma\b/i.test(text) && !CONFIRM.test(text) && !INVOICE.test(text)) return null
  if (/credit ?(memo|note)/i.test(text)) return 'credit'
  if (CONFIRM.test(text) && !INVOICE.test(text)) return 'confirmation'
  if (INVOICE.test(text) && !CONFIRM.test(text) && !/statement|past due|reminder/i.test(text)) return 'invoice'
  return null
}

/** The email without the earlier mail quoted under it. */
export function ownWords(text: string): string {
  const m = /\n(?:On .{4,200}wrote:|-{3,} ?Original Message|_{10,}|From: .+\n(?:Sent|Date): )/i.exec(text)
  return (m ? text.slice(0, m.index) : text).trim()
}

/** A file that could be a confirmation or invoice: a PDF or a real picture, not a signature logo, statement, catalog… */
export function maybePaperwork(a: { file_name: string; size: number | null }): boolean {
  if (!PAPER_FILE.test(a.file_name) || PAPER_SKIP.test(a.file_name)) return false
  if (/\.(png|jpe?g)$/i.test(a.file_name) && (a.size ?? 0) < 100 * 1024) return false
  return !NOT_PAPER.test(a.file_name)
}

// ---- item pictures (Dana, Oct 10: "If a vendor sends images of items they would go in that folder") ----
const PICTURE = /\.(png|jpe?g|gif|webp|heic)$/i
const NOT_ITEM = /logo|signature|banner|facebook|instagram|linkedin|twitter|youtube|tiktok|pinterest|icon|spacer|pixel/i

/** A real picture (an item photo, not a signature logo or icon): a picture file of 60 KB to 15 MB. */
export function itemPicture(a: { file_name: string; mime_type?: string | null; size: number | null }): boolean {
  const pic = PICTURE.test(a.file_name) || /^image\/(png|jpe?g|gif|webp|heic)$/i.test(a.mime_type ?? '')
  return pic && !NOT_ITEM.test(a.file_name) && (a.size ?? 0) >= 60 * 1024 && (a.size ?? 0) <= 15 * 1024 * 1024
}

/** "Fall specials – image003.jpg" for the generic names Outlook and phones give pasted pictures. */
export function pictureLabel(fileName: string, subject: string | null): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '')
  const generic = /^(image|img|imag|photo|picture|attachment|unnamed|screenshot)[-_ ]?[\d_ -]*$/i.test(base) || /^\d+$/.test(base)
  const subj = (subject ?? '').replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim()
  return generic && subj ? `${subj.slice(0, 80)} – ${fileName}` : base
}
