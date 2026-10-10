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

/**
 * A vendor's order confirmation or invoice by its file name (then the email subject), PDFs and pictures
 * only; signature pictures never. Claude reads it afterwards and refiles it if the name was wrong.
 */
export function paperworkKind(a: { file_name: string; size: number | null }, subject: string | null): 'confirmation' | 'invoice' | null {
  if (!PAPER_FILE.test(a.file_name) || /^(image|img|logo|outlook|signature|banner)[-_ ]?\d*\./i.test(a.file_name)) return null
  if (/\.(png|jpe?g)$/i.test(a.file_name) && (a.size ?? 0) < 100 * 1024) return null
  if (/credit|statement|price ?list|catalog|packing|\bbol\b|quote|specials?\b/i.test(a.file_name)) return null
  const name = a.file_name.replace(/[_\-.]+/g, ' ')
  if (CONFIRM.test(name)) return 'confirmation'
  if (INVOICE.test(name)) return 'invoice'
  if (CONFIRM.test(subject ?? '')) return 'confirmation'
  if (INVOICE.test(subject ?? '') && !/statement|past due|reminder/i.test(subject ?? '')) return 'invoice'
  return null
}
