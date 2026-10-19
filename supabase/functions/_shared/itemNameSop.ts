// Trevor's SOP-INV-001-NC (Item Naming Conventions, Oct 18, 2026): the check every LS item name goes through, and the
// fixes VMS can make on its own. Shared by the browser (Item names page, LS PO review) and the edge functions.
// `fixName` only makes cosmetic and shorthand-only changes (capitals, spacing, marks, accents, approved shorthand) plus
// the Vendor ID at the end; anything that needs judgment (part order, brand, measurements in the size slot) is only
// flagged. `changeKind` tells a cosmetic change (no new shelf tag) from one that changes what the name says.

export const MAX_NAME = 52

/** Vendors whose items always end with the Vendor ID (SOP list); Fishing items always do too. */
export const VID_VENDORS = ['COGHLAN', 'WORLD FAMOUS SPORTS', 'LAZY ONE', 'TY']

export interface NameContext {
  /** LS category starts with FISHING */
  fishing?: boolean
  /** LS category starts with FOOTWEAR */
  footwear?: boolean
  /** LS category starts with CLOTHING */
  clothing?: boolean
  /** a Ty item (birthdays) */
  ty?: boolean
  /** the vendor has "Add Vendor ID to item names" on */
  vidVendor?: boolean
  /** the item's Vendor ID as on the invoice (or in LS) */
  vendorItemId?: string | null
  /** the brand as on the tag, when known; exempt from the punctuation rules */
  brand?: string | null
  /** other items' names in LS, upper case, for the duplicate check */
  otherNames?: Set<string>
  /** approved as an exception (over 52 after every shortening step) */
  lengthException?: boolean
}

export type ProblemCode =
  | 'length' | 'duplicate' | 'lowercase' | 'accents' | 'marks' | 'spacing' | 'units' | 'shorthand' | 'size'
  | 'marker' | 'vendor_id' | 'vendor_id_extra' | 'vid_sep' | 'sizing' | 'colors' | 'pound' | 'period' | 'birthday' | 'asst' | 'brand'

export interface NameProblem {
  code: ProblemCode
  text: string
  /** fixName fixes it */
  fixable: boolean
}

const ACCENT = /[̀-ͯ]/g
const plain = (s: string) => s.normalize('NFD').replace(ACCENT, '')
const CURLY: [RegExp, string][] = [[/[‘’‚‛′]/g, "'"], [/[“”„‟″]/g, '"']]
const SYMBOLS = /[™®©]/g
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The do-not-reorder marker at the start (* or **), the rest of the name. */
export function splitMarker(name: string): { marker: '' | '*' | '**'; rest: string } {
  const m = /^\s*(\*{1,2})\s*/.exec(name)
  if (!m) return { marker: '', rest: name }
  return { marker: (m[1] === '**' ? '**' : '*'), rest: name.slice(m[0].length) }
}

interface Parts { marker: '' | '*' | '**'; brand: string; body: string; vid: string }

/** Marker, brand (when known and at the start), body, Vendor ID (when it is the last part). */
function parts(name: string, ctx: NameContext): Parts {
  const { marker, rest } = splitMarker(name)
  let body = rest.trim()
  let brand = ''
  const b = (ctx.brand ?? '').trim()
  if (b && body.toUpperCase().startsWith(b.toUpperCase()) && (body.length === b.length || body[b.length] === ' ')) {
    brand = body.slice(0, b.length)
    body = body.slice(b.length).trim()
  }
  let vid = ''
  const v = (ctx.vendorItemId ?? '').trim()
  if (v && body.toUpperCase().endsWith(v.toUpperCase())) {
    // the Vendor ID is last; whatever stands between it and the rest (" - ", "-", " #") is a separator the SOP drops
    // ("SET - 9869", "FT-7610", "POUCH -1354"). A bare dash after a digit is part of a longer code (21-4410), not that.
    const before = body.slice(0, body.length - v.length)
    const sep = /(?:\s*[-#]+\s*|\s+)$/.exec(before)?.[0] ?? ''
    const head = before.slice(0, before.length - sep.length)
    const bareDashAfterDigit = /^-+$/.test(sep) && /\d$/.test(head)
    if (!before || (sep && !bareDashAfterDigit)) {
      vid = body.slice(body.length - v.length)
      body = head.trim()
    }
  }
  return { marker, brand, body, vid }
}

const join = (p: Parts) => p.marker + [p.brand, p.body, p.vid].filter(Boolean).join(' ')

// Always-used shorthand (SOP: sizing words, sizes, units, pack and count words, ASST and MULTI, SL, W/, W/O) and the
// marks that are wrong outright. Each swap is cosmetic: it never changes what the name says.
const WORD_SWAPS: [RegExp, string][] = [
  [/\bWOMEN'?S\b|\bWOMEN\b|\bWMS\b|\bWOMANS\b/g, 'WMNS'],
  [/\bMEN'S\b/g, 'MENS'],
  [/\bLADIE'?S'?\b/g, 'LADIES'],
  [/\bGIRL'?S'\b|\bGIRL'S\b/g, 'GIRLS'],
  [/\bBOY'?S'\b|\bBOY'S\b/g, 'BOYS'],
  [/\bKID'?S'\b|\bKID'S\b|\bKID\b/g, 'KIDS'],
  [/\bYOUTH\b/g, 'YTH'],
  [/\bJUNIORS?\b/g, 'JR'],
  [/\bSHAVER LAKE\b/g, 'SL'],
  [/\bWITHOUT\b/g, 'W/O'],
  [/\bWITH\b/g, 'W/'],
  [/\bL\/S\b/g, 'LS'],
  [/\bS\/S\b/g, 'SS'],
  [/\bGREY\b/g, 'GRAY'],
  [/\bNYL\b/g, 'NYLON'],
  [/\bONE-SIZE\b|\bONESIZE\b|\bOSFA\b|\bO\/S\b/g, 'ONE SIZE'],
  [/\bASSORTED\b|\bASSTD\b|\bASRT\b/g, 'ASST'],
  [/\bMULTICOLOU?R(ED)?\b|\bMULTI-COLOU?R(ED)?\b/g, 'MULTI'],
  [/\bBLCK\b/g, 'BLACK'],
  [/\bPRPL\b/g, 'PURPLE'],
  [/\bXXXXL\b/g, '4XL'],
  [/\bXXXL\b/g, '3XL'],
  [/\bXXL\b/g, '2XL'],
  [/\bX-?LARGE\b|\bEXTRA LARGE\b/g, 'XL'],
  [/\bX-?SMALL\b|\bEXTRA SMALL\b/g, 'XS'],
]

// Units after a number: always the shorthand, a space before it.
const UNIT_WORDS: [RegExp, string][] = [
  [/\bSZ(\d{1,2}(?:\.5)?)(?=\s|$)/g, 'SZ $1'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:FLUID OUNCES?|FL\.? ?OZ\.?)(?![A-Z])/g, '$1 FL OZ'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:OUNCES?|OZS?\.?)(?![A-Z])/g, '$1 OZ'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:GALLONS?|GAL\.?)(?![A-Z])/g, '$1 GAL'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:QUARTS?|QT\.?)(?![A-Z])/g, '$1 QT'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:MILLILITERS?|ML\.?)(?![A-Z])/g, '$1 ML'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:LITERS?|LITRES?|LTRS?\.?)(?![A-Z])/g, '$1 L'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:MILLIMETERS?|MM\.?)(?![A-Z])/g, '$1 MM'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:CENTIMETERS?|CM\.?)(?![A-Z])/g, '$1 CM'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:YARDS?|YDS?\.?)(?![A-Z])/g, '$1 YD'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:PACKS?|PKS?|PKG)(?![A-Z])/g, '$1 PK'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:PAIRS?|PRS?)(?![A-Z])/g, '$1 PR'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:COUNT|CT)(?![A-Z])/g, '$1 CT'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:PIECES?|PCS?)(?![A-Z])/g, '$1 PC'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:DOZEN|DZ)(?![A-Z])/g, '$1 DZ'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:MONTHS?|MOS?)(?![A-Z])/g, '$1 MO'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:INCH(?:ES)?|IN\.)(?![A-Z])/g, '$1"'],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s*(?:FEET|FOOT|FT\.?)(?![A-Z])/g, "$1'"],
  [/(?<![A-WYZ0-9.-])(\.?\d+(?:[./]\d+)?)\s+(['"])(?![A-Z0-9])/g, '$1$2'],
  [/\bSPF\s*(\d)/g, 'SPF $1'],
]

// Fishing color shorthand: Fishing items only (and only to stay within 52); on anything else it is spelled out.
export const FISHING_COLORS: Record<string, string> = {
  CHART: 'CHARTREUSE', FLO: 'FLUORESCENT', GLO: 'GLOW', HOLO: 'HOLOGRAPHIC', SLV: 'SILVER', BLK: 'BLACK',
  GRN: 'GREEN', WHT: 'WHITE', GLD: 'GOLD', PNK: 'PINK', PRP: 'PURPLE', YEL: 'YELLOW', PRL: 'PEARL', CLR: 'CLEAR', NAT: 'NATURAL',
}

// Shorthand that is not on the Approved Shorthand List, seen in our LS names (flagged; a person decides the full word).
const NOT_APPROVED: Record<string, string> = {
  LT: 'LIGHT', DK: 'DARK', RND: 'ROUND', YR: 'YEAR', VINT: 'VINTAGE', LRG: 'LG', MD: 'MED', ASSRT: 'ASST', BLU: 'BLUE',
  BRN: 'BROWN', GRY: 'GRAY', ORG: 'ORANGE', RD: 'RED', NVY: 'NAVY', HTHR: 'HEATHER',
}

// Sizes in the size slot (the last part before a Ty birthday or the Vendor ID).
const SIZE_SWAPS: Record<string, string> = {
  SMALL: 'SM', MEDIUM: 'MED', LARGE: 'LG', MD: 'MED', LRG: 'LG', S: 'SM', M: 'MED', L: 'LG', OS: 'ONE SIZE', 'X-LARGE': 'XL',
}
const MONTHS: Record<string, string> = {
  JANUARY: 'JAN', FEBRUARY: 'FEB', MARCH: 'MAR', APRIL: 'APR', JUNE: 'JUN', JULY: 'JUL', AUGUST: 'AUG',
  SEPTEMBER: 'SEP', SEPT: 'SEP', OCTOBER: 'OCT', NOVEMBER: 'NOV', DECEMBER: 'DEC',
}

/** The body's own clean-up: marks, capitals, spacing, units, approved shorthand. Brand and Vendor ID never pass here. */
function cleanBody(body: string, ctx: NameContext, firstPartIsBrand: boolean): string {
  let s = plain(body)
  for (const [re, to] of CURLY) s = s.replace(re, to)
  s = s.replace(SYMBOLS, '').toUpperCase()
  s = s.replace(/,/g, ' ')
  // spacing around dashes, slashes (except W/ and W/O) and the dimension X
  s = s.replace(/^\s*-+\s*|\s*-+\s*$/g, '').replace(/\s+-\s+/g, ' ').replace(/\s*-\s*/g, '-').replace(/\bW\s*\/\s*O\b\s*/g, 'W/O ').replace(/\bW\s*\/(?!O\b)\s*/g, 'W/ ')
  s = s.replace(/(\S)\s+\/\s*(?=\S)|(\S)\s*\/\s+(?=\S)/g, (_m, a, b) => `${a ?? b}/`).replace(/\bW\/(?=[A-Z0-9])(?!O\b)/g, 'W/ ')
  s = s.replace(/(\d['"]?)\s*X\s*(?=\d)/g, '$1X')
  for (const [re, to] of WORD_SWAPS) s = s.replace(re, to)
  for (const [re, to] of UNIT_WORDS) s = s.replace(re, to)
  // LB for 1 pound or less, LBS for more; fishing line strength is always LB
  s = s.replace(/(\d+(?:\.\d+)?)\s*(LBS?|POUNDS?)(?![A-Z])/g, (_m, n: string) => `${n} ${ctx.fishing || Number(n) <= 1 ? 'LB' : 'LBS'}`)
  if (!ctx.fishing) for (const [short, full] of Object.entries(FISHING_COLORS)) s = s.replace(new RegExp(`\\b${short}\\b(?!')`, 'g'), full)
  // # for hook, lure and numbered footwear sizes is SZ
  if (ctx.fishing || ctx.footwear) s = s.replace(/(?<=\s|^)#\s*(\d{1,2}(?:\/0)?)(?=\s|$)/g, 'SZ $1')
  // apostrophes: kept in the first word when it may be the brand (no brand known), dropped elsewhere (I'M → IM);
  // foot marks after a number stay
  const words = s.split(/\s+/).filter(Boolean)
  const out = words.map((w, i) => (i === 0 && firstPartIsBrand ? w : w.replace(/(?<!\d)'/g, '')))
  s = out.join(' ')
  // a period only as a decimal point (8.5, .22); a period at the end of a word goes (VINT. → VINT)
  s = s.replace(/(?<=[A-Z])\.(?=\s|$)/g, '')
  // ASST written once
  s = s.replace(/\bASST(\s+ASST)+\b/g, 'ASST')
  return s.replace(/\s{2,}/g, ' ').trim()
}

/** The size slot: last word of the body, before a Ty birthday. */
function fixSizeSlot(body: string, ctx: NameContext): string {
  const words = body.split(' ')
  if (!words.length) return body
  let end = words.length - 1
  // a Ty birthday (MAR 6) sits before the Vendor ID, after the size
  if (ctx.ty && end >= 1 && /^\d{1,2}$/.test(words[end]!) && MONTHS[words[end - 1]!] !== undefined) words[end - 1] = MONTHS[words[end - 1]!]!
  if (ctx.ty && end >= 1 && /^\d{1,2}$/.test(words[end]!) && /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(words[end - 1]!)) end -= 2
  if (end < 0) return words.join(' ')
  const w = words[end]!
  const prev = words[end - 1]
  const numberBefore = !!prev && /^\d+(\.\d+)?$/.test(prev)
  // SZ before a letter size (footwear) or on clothing goes
  if (prev === 'SZ' && SIZE_SWAPS[w] !== undefined && w !== 'OS') { words.splice(end - 1, 1); end -= 1 }
  const cur = words[end]!
  if (SIZE_SWAPS[cur] !== undefined && !(cur === 'L' && numberBefore) && !(cur === 'M' && numberBefore)) words[end] = SIZE_SWAPS[cur]!
  // SIZE 10 is SZ 10 on footwear; clothing never says SIZE or SZ
  if (end > 0 && words[end - 1] === 'SIZE' && /^\d/.test(words[end]!)) {
    if (ctx.footwear) words[end - 1] = 'SZ'
    else if (ctx.clothing) { words.splice(end - 1, 1); end -= 1 }
  }
  // footwear: a numbered size starts with SZ; clothing never uses SZ
  const now = words[end]!
  if (ctx.footwear && /^\d+(\.\d+)?$/.test(now) && words[end - 1] !== 'SZ' && end > 0) words.splice(end, 0, 'SZ')
  if (ctx.clothing && words[end - 1] === 'SZ' && /^\d/.test(now)) words.splice(end - 1, 1)
  // shoe half sizes as decimals: 8 1/2 → 8.5
  return words.join(' ').replace(/\bSZ (\d+) 1\/2\b/g, 'SZ $1.5')
}

/** What VMS can fix on its own: the cosmetic and shorthand changes. The Vendor ID is left where it is (see fixVendorId). */
export function fixName(name: string, ctx: NameContext = {}): string {
  const p = parts(name, ctx)
  let body = cleanBody(p.body, ctx, !p.brand)
  body = fixSizeSlot(body, ctx)
  // the brand: capitals, no ™ or ®, plain letters (the batch never changes a brand otherwise)
  const brand = plain(p.brand).replace(SYMBOLS, '').toUpperCase().trim()
  return join({ marker: p.marker, brand, body, vid: p.vid.toUpperCase() }).replace(/\s{2,}/g, ' ').trim()
}

const looksLikeCode = (w: string | undefined) => !!w && /\d/.test(w) && /[A-Z]/.test(w) || (!!w && /^\d{4,}$/.test(w))

/**
 * The Vendor ID part (SOP: last, one space before it, only for Fishing and the listed vendors): moved to the end, added,
 * or taken off. Null when VMS can't tell (the name already ends in a different code, or there is no Vendor ID in LS):
 * a person checks it against the invoice. Changing the Vendor ID changes what the name says (a new shelf tag).
 */
export function fixVendorId(name: string, ctx: NameContext = {}): string | null {
  const v = (ctx.vendorItemId ?? '').trim().toUpperCase()
  const want = !!(ctx.fishing || ctx.vidVendor)
  const p = parts(name, ctx)
  if (!v) return null
  if (want && p.vid) return join(p)
  if (!want && !p.vid) return name
  if (!want) return join({ ...p, vid: '' })
  const re = new RegExp(`(^|\\s)#?${esc(v)}(?=\\s|$)`)
  if (re.test(p.body)) return join({ ...p, body: p.body.replace(re, ' ').replace(/\s{2,}/g, ' ').trim(), vid: v })
  const words = p.body.split(' ')
  if (looksLikeCode(words[words.length - 1])) return null
  return join({ ...p, vid: v })
}

/** Every SOP problem with the name, fixable or not. */
export function checkName(name: string, ctx: NameContext = {}): NameProblem[] {
  const out: NameProblem[] = []
  const add = (code: ProblemCode, text: string, fixable: boolean) => { if (!out.some((p) => p.code === code)) out.push({ code, text, fixable }) }
  const fixed = fixName(name, ctx)
  const p = parts(name, ctx)
  const body = p.body
  const v = (ctx.vendorItemId ?? '').trim()

  if (name.length > MAX_NAME && !ctx.lengthException) add('length', `${name.length} characters (52 at most, counting * and spaces)`, fixed.length <= MAX_NAME && fixed !== name)
  if (ctx.otherNames?.has(name.trim().toUpperCase())) add('duplicate', 'Another LS item has this exact name', false)
  if (/[a-z]/.test(name.replace(v, ''))) add('lowercase', 'Not all capitals', true)
  if (plain(name) !== name) add('accents', 'Accented letters (use the plain letter)', true)
  if (SYMBOLS.test(name) || /[‘’“”]/.test(name)) add('marks', '™, ® or curly quotes', true)
  if (/,/.test(body)) add('marks', 'Comma in the name', true)
  if (/'/.test(body.split(' ').slice(p.brand ? 0 : 1).join(' ').replace(/\d'/g, ''))) add('marks', 'Apostrophe outside the brand', true)
  if (/#/.test(body)) add('pound', '# in the name (use SZ for hook, lure and footwear sizes)', !!(ctx.fishing || ctx.footwear) && /#\s*\d{1,2}(?:\/0)?(?=\s|$)/.test(body) && !/#(?!\s*\d{1,2}(?:\/0)?(?=\s|$))/.test(body))
  if (/\*/.test(splitMarker(name).rest)) add('marker', 'An asterisk that is not at the start (only * or ** at the very start)', false)
  if (/^\s*\*{1,2}\s+/.test(name)) add('marker', 'A space after the * or ** marker', true)
  if (/^\s*\*{3,}/.test(name)) add('marker', 'More than two asterisks', false)
  if (/\s{2,}/.test(name) || / - |- | -/.test(body) || /\S \/|\/ (?!\S*$)/.test(body.replace(/\bW\/O? /g, '')) || /\bW\/(?=[A-Z0-9])(?!O\b)/.test(body) || /\d['"]? X \d|\dX \d|\d X\d/.test(body)) add('spacing', 'Spacing (one space between words; none next to - or /, or around the X in 7X13; a space after W/)', true)
  if (/\d(OZ|LBS?|GAL|QT|ML|MM|CM|YD|PK|PR|CT|PC|DZ|MO)\b/.test(body) || /\bSPF\d/.test(body) || /\d (?:INCH|INCHES|FT|FEET)\b/.test(body)) add('units', 'A space between a number and its unit (8 OZ, SPF 15); inch and foot marks right after the number (12", 6\')', true)
  if (!ctx.fishing && /(\d+(?:\.\d+)?) LB\b/.test(body) && Number(/(\d+(?:\.\d+)?) LB\b/.exec(body)![1]) > 1) add('units', 'LBS for more than 1 pound', true)
  if (/(\d+(?:\.\d+)?) LBS\b/.test(body) && (ctx.fishing || Number(/(\d+(?:\.\d+)?) LBS\b/.exec(body)![1]) <= 1)) add('units', ctx.fishing ? 'Fishing line strength uses LB' : 'LB for 1 pound or less', true)
  const swaps = WORD_SWAPS.filter(([re]) => new RegExp(re.source).test(body.toUpperCase()))
  if (swaps.length) add('shorthand', `Use the approved shorthand (${[...new Set(swaps.map(([, to]) => to))].join(', ')})`, true)
  if (!ctx.fishing) {
    const fc = Object.keys(FISHING_COLORS).filter((k) => new RegExp(`\\b${k}\\b`).test(body.toUpperCase()))
    if (fc.length) add('colors', `Fishing color shorthand on a non-Fishing item (${fc.join(', ')}): spell it out`, true)
  }
  const odd = Object.keys(NOT_APPROVED).filter((k) => new RegExp(`\\b${k}\\b`).test(body.toUpperCase()))
  if (odd.length) add('shorthand', `Shorthand not on the approved list: ${odd.join(', ')}`, false)
  if (/\b[A-Z]+(\/[A-Z]+){3,}\b/.test(body.toUpperCase())) add('colors', 'Four or more colors: use MULTI', false)
  if (/\bASST\s+ASST\b/.test(body.toUpperCase())) add('asst', 'ASST written twice', true)
  if (/\b(YTH|YOUTH) (GIRLS|BOYS)\b|\b(GIRLS|BOYS) (YTH|YOUTH)\b/.test(body.toUpperCase())) add('sizing', 'YTH next to GIRLS or BOYS: GIRLS or BOYS up front, YTH next to the size', false)
  if (/^(BABY)\b/.test(body.toUpperCase()) || /\bBABY (TEE|ONESIE|BODYSUIT|HAT|SOCKS?|SHIRT|HOODIE|BIB)\b/.test(body.toUpperCase())) add('sizing', 'BABY as a sizing word (use INFANT)', false)
  if (/\b[A-Z]\.(?=[A-Z0-9])|(?<![0-9])\.(?![0-9])/.test(body.replace(/^\./, ''))) add('period', 'A period that is not a decimal point', /(?<=[A-Z])\.(?=\s|$)/.test(body))
  // sizes
  const last = fixSizeSlot(cleanBody(body, ctx, !p.brand), ctx)
  if (last !== cleanBody(body, ctx, !p.brand)) add('size', 'Size written the SOP way (SM, MED, LG, ONE SIZE, SZ before numbered footwear sizes, none on clothing)', true)
  if (ctx.clothing && /\bSIZE\b/.test(body.toUpperCase().replace(/\bONE SIZE\b/g, ''))) add('size', 'The word SIZE on clothing', false)
  if (ctx.ty && /\b(JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|SEPT|OCTOBER|NOVEMBER|DECEMBER)\b/.test(body.toUpperCase())) add('birthday', 'Ty birthday as a 3-letter month (MAR 6)', true)
  // the Vendor ID
  const wantVid = ctx.fishing || ctx.vidVendor
  if (wantVid && v && !p.vid) add('vendor_id', `The Vendor ID (${v}) goes last${body.toUpperCase().includes(v.toUpperCase()) ? ', not in the middle' : ''}`, fixVendorId(name, ctx) !== null)
  if (!wantVid && v && p.vid) add('vendor_id_extra', `No Vendor ID in the name for this vendor (${v})`, true)
  if (p.vid && /(?:[-#]\s*|[^ ])$/.test(splitMarker(name).rest.trimEnd().slice(0, -p.vid.length)) && splitMarker(name).rest.trim() !== p.vid) add('vid_sep', 'Just one space before the Vendor ID: no dash or # in front of it', true)
  // anything else VMS would change still shows, so no name that needs a fix reads as passing
  if (fixed !== name && !out.some((x) => x.fixable)) add('spacing', 'Capitals, spacing or marks', true)
  return out
}

const CANON: [RegExp, string][] = [
  ...WORD_SWAPS,
  [/\bSM\b|\bSMALL\b/g, 'SM'], [/\bMED\b|\bMEDIUM\b|\bMD\b/g, 'MED'], [/\bLG\b|\bLARGE\b|\bLRG\b/g, 'LG'],
  [/\bSZ\b\s*|\bSZ(?=\d{1,2}(?:\.5)?(?:\s|$))/g, ''], [/\bSIZE\b/g, ''],
  [/\bJANUARY\b/g, 'JAN'], [/\bFEBRUARY\b/g, 'FEB'], [/\bMARCH\b/g, 'MAR'], [/\bAPRIL\b/g, 'APR'], [/\bJUNE\b/g, 'JUN'],
  [/\bJULY\b/g, 'JUL'], [/\bAUGUST\b/g, 'AUG'], [/\bSEPTEMBER\b|\bSEPT\b/g, 'SEP'], [/\bOCTOBER\b/g, 'OCT'], [/\bNOVEMBER\b/g, 'NOV'],
  [/\bDECEMBER\b/g, 'DEC'], [/\bREGULAR\b/g, 'REG'],
  [/(?<!\d )\bS\b(?!')/g, 'SM'], [/(?<!\d )\bM\b(?!')/g, 'MED'], [/(?<!\d )\bL\b(?!')/g, 'LG'],
]

/** One spelling for comparing two names: what a name SAYS, without its capitals, marks, spacing or shorthand. */
export function nameMeaning(name: string): string {
  let s = plain(splitMarker(name).rest)
  for (const [re, to] of CURLY) s = s.replace(re, to)
  s = s.replace(SYMBOLS, '').toUpperCase().replace(/[,#]/g, ' ').replace(/(?<!\d)'/g, '').replace(/(?<=[A-Z])\.(?=\s|$)/g, '')
  for (const [re, to] of CANON) s = s.replace(re, to)
  for (const [re, to] of UNIT_WORDS) s = s.replace(re, to)
  for (const [short, full] of Object.entries(FISHING_COLORS)) s = s.replace(new RegExp(`\\b${short}\\b`, 'g'), full)
  s = s.replace(/(\d)\s*(LBS?|POUNDS?)\b/g, '$1 LB').replace(/\b(LBS?|POUNDS?)\b/g, 'LB')
  // single-letter sizes at the end
  s = s.replace(/\bS$/, 'SM').replace(/\bM$/, 'MED').replace(/(?<!\d )\bL$/, 'LG')
  // dashes and spacing around slashes and the dimension X are marks, not words
  return s.replace(/-/g, ' ').replace(/\s*\/\s*/g, '/').replace(/(\d['"]?)\s*X\s*(?=\d)/g, '$1X').replace(/\s+/g, ' ').trim()
}

/**
 * The kind of change (SOP "Renaming an existing item"): cosmetic and shorthand-only renames (capitals, spacing, curly
 * quotes, marks, accents, a * or ** marker, approved shorthand) need no new shelf tag; anything else changes what the
 * name says and needs one within 7 days.
 */
export function changeKind(oldName: string, newName: string): 'same' | 'cosmetic' | 'content' {
  if (oldName === newName) return 'same'
  return nameMeaning(oldName) === nameMeaning(newName) ? 'cosmetic' : 'content'
}

/** The context for an LS item from its category path, vendor setting and Vendor ID. */
export function lsContext(item: { category_path?: string | null; vendor_item_id?: string | null }, vendor?: { vid_in_description?: boolean | null; name?: string | null } | null): NameContext {
  const top = String(item.category_path ?? '').split('/')[0]!.trim().toUpperCase()
  const vname = String(vendor?.name ?? '').toUpperCase()
  return {
    fishing: top === 'FISHING',
    footwear: top === 'FOOTWEAR',
    clothing: top === 'CLOTHING',
    ty: /^TY\b/.test(vname),
    vidVendor: !!vendor?.vid_in_description,
    vendorItemId: item.vendor_item_id ?? null,
  }
}

/** Items the SOP does not cover (rentals, labor, marina fees, deposits, non-retail). */
export function outsideSop(categoryPath: string | null | undefined): boolean {
  return /^(SLS RENTALS|LABOR|MARINA FEES|WINTER SEASONAL RENTAL|NON-TAX)/i.test(String(categoryPath ?? '').trim())
}
