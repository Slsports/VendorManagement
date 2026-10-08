// Vendor clues in an email (decisions log Oct 7 and Oct 8): the sender's web address, a PO number, and
// vendor names in the subject, the message above the signature, attachment file names and the From name.
// Dana, Oct 8: a PO number decides (our POs are <vendor name><date>, PNW9126); the part of an address
// before the @ never counts; a line name that is also a first name (Angie) needs another clue; "Worldwide"
// alone never decides (it is how we are billed). Pure functions, shared by gmail-sync (Deno), the
// re-matching script and the unit tests (vitest).

export interface VendorRef { id: string; name: string; aliases: string[] }
export interface VendorIndex {
  /** phrase ("world famous sports") → vendor ids */
  phrases: Map<string, string[]>
  /** a vendor's name squeezed together ("pnw", "starofindia") → vendor ids, for PO numbers like PNW9126 */
  poPrefixes: Map<string, string[]>
  /** PO numbers on file (upper case, letters and digits only) → vendor id */
  poNumbers: Map<string, string>
  /** words of each vendor's names, for the web-address check */
  wordsets: { id: string; words: string[] }[]
  maxWords: number
}

/** How we are billed or shipped: never a vendor clue on their own ("Worldwide", "Worldwide Express"). */
const NEVER_ALONE = new Set(['worldwide', 'wwd', 'faire', 'express', 'distributors', 'ups', 'fedex', 'usps', 'freight'])

/** Common first names: a one-word line name like Angie counts only next to another clue for the same vendor. */
const FIRST_NAMES = new Set(`aaron adam alex alice alicia allison amanda amber amy andrea andrew angela angie anna anne annette april ashley barbara
becky ben beth betty bill billy bob bobby brad brandon brenda brian brittany bruce carl carla carol carolyn carrie cat cathy chad charles chris
christina christine cindy claire connie craig crystal cynthia dale dan dana daniel danielle darlene dave david dawn debbie deborah debra denise
dennis diana diane donna doris dorothy doug ed eddie edward elaine elizabeth ellen emily emma eric erica erin eva frank fred gail gary george
gina gloria grace greg gregory hannah harold heather helen holly jack jackie jacob james jamie jan jane janet janice jason jean jeff jennifer
jenny jeremy jerry jessica jill jim jimmy jo joan joe john johnny jon jordan joseph josh joshua joy joyce juan judy julia julie justin karen
kate katherine kathleen kathy katie kay keith kelly ken kevin kim kimberly kristen kristin kyle larry laura lauren leah lee leslie linda lisa
lori louise lucy lynn maggie marcia margaret maria marie marilyn mark martha martin mary matt matthew megan melanie melissa michael michelle
mike missy molly nancy natalie nathan nicholas nick nicole pam pamela pat patricia patrick paul paula peggy peter phillip rachel raelee randy
ray rebecca renee rhonda richard rick rita rob robert robin rod roger ron ronald rose ruby russell ruth ryan sally sam samantha sandra sandy
sara sarah scott sean sharon shawn sheila shelly sherry shirley stacy stephanie stephen steve steven sue susan suzanne tammy tanya tara teresa
terri terry thomas tiffany tim timothy tina todd tom tommy tony tracy travis trevor troy tyler valerie vicki victoria virginia walter wanda
wayne wendy william`.split(/\s+/))

/** Words that say nothing about which vendor it is when they stand alone or trail a name. */
const CORPORATE = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'usa', 'us', 'intl', 'international', 'enterprises', 'group', 'wwd', 'faire', 'and'])
const GENERIC = new Set([
  'sports', 'sport', 'outdoor', 'outdoors', 'products', 'product', 'supply', 'supplies', 'trading', 'tackle', 'marine', 'fishing', 'camping', 'gear',
  'apparel', 'design', 'designs', 'imports', 'import', 'distributing', 'distributors', 'distribution', 'industries', 'manufacturing', 'wholesale',
  'home', 'goods', 'toys', 'toy', 'games', 'clothing', 'accessories', 'kids', 'gifts', 'gift', 'candy', 'foods', 'food', 'coffee', 'brands', 'brand',
  'mountain', 'pacific', 'american', 'america', 'world', 'global', 'life', 'wear', 'house', 'factory', 'river', 'master', 'pro', 'fun', 'trail',
  'order', 'orders', 'invoice', 'shipping', 'ship', 'sale', 'sales', 'free', 'new', 'summer', 'winter', 'spring', 'fall', 'catalog', 'thanks', 'best',
])

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** The names a vendor goes by, cleaned: no " - WWD" / " - Dandylines" tags, no "(FAIRE)", slash = two names. */
export function vendorNames(v: VendorRef): string[] {
  const out = new Set<string>()
  for (const raw of [v.name, ...v.aliases]) {
    // "(FAIRE)", "- WWD", and the half-closed "IMAGE ONE (Maryellen" all drop their tags.
    const base = raw.replace(/\([^)]*\)/g, ' ').replace(/\(.*$/, ' ').replace(/\s+-\s+.*$/, ' ')
    for (const part of base.split('/')) {
      const words = normalize(part)
      while (words.length && CORPORATE.has(words[words.length - 1]!)) words.pop()
      while (words.length && words[0] === 'the') words.shift()
      if (words.length) out.add(words.join(' '))
    }
  }
  return [...out]
}

/** A phrase is usable as a clue when it is distinctive: two or more words, or one uncommon word. */
function usablePhrase(phrase: string): boolean {
  const words = phrase.split(' ')
  if (phrase.replace(/ /g, '').length < 4) return false
  if (words.length === 1) return !GENERIC.has(words[0]!) && !CORPORATE.has(words[0]!) && !NEVER_ALONE.has(words[0]!)
  return !words.every((w) => GENERIC.has(w) || CORPORATE.has(w) || NEVER_ALONE.has(w))
}

/** Words that make a PO number common text rather than ours ("Spring 2026", "Order 1234"). */
const PO_COMMON = new Set(['spring', 'summer', 'fall', 'winter', 'show', 'order', 'po', 'inv', 'invoice', 'sku', 'item', 'style', 'jan', 'feb', 'mar', 'apr',
  'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'q', 'fy', 'w', 'ss', 'fw', 'bulk', 'reno', 'vegas', 'booth', 'ref', 'case', 'ticket'])
const commonPo = (k: string) => {
  const letters = k.replace(/[^A-Z]/g, '').toLowerCase()
  return letters.length > 0 && (PO_COMMON.has(letters) || GENERIC.has(letters))
}

/** Upper case, letters and digits only: "pnw-9126" → "PNW9126". */
export const poKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** ignore: phrases that are ours and appear in every email ("shaver lake"). orders: PO numbers on file. */
export function buildVendorIndex(vendors: VendorRef[], ignore: string[] = [], orders: { po_number: string | null; vendor_id: string }[] = []): VendorIndex {
  const phrases = new Map<string, string[]>()
  const poPrefixes = new Map<string, string[]>()
  const poNumbers = new Map<string, string>()
  const poClash = new Set<string>()
  for (const o of orders) {
    const k = o.po_number ? poKey(o.po_number) : ''
    // Too short, all digits and short (a ZIP code, a quantity), or a season ("SPRING 2026") says nothing.
    if (k.length < 5 || (/^\d+$/.test(k) && k.length < 6) || commonPo(k)) continue
    if (poNumbers.has(k) && poNumbers.get(k) !== o.vendor_id) poClash.add(k)
    poNumbers.set(k, o.vendor_id)
  }
  for (const k of poClash) poNumbers.delete(k)
  const wordsets: VendorIndex['wordsets'] = []
  const ignored = ignore.map((p) => normalize(p).join(' '))
  let maxWords = 1
  for (const v of vendors) {
    for (const phrase of vendorNames(v)) {
      if (ignored.some((ig) => phrase.includes(ig))) continue
      wordsets.push({ id: v.id, words: phrase.split(' ') })
      // PO prefixes may be short (PNW9126): any name of 3+ letters that is not a generic word.
      const squeezed = phrase.replace(/ /g, '')
      if (squeezed.length >= 3 && !phrase.split(' ').every((w) => GENERIC.has(w) || CORPORATE.has(w) || NEVER_ALONE.has(w))) {
        const pids = poPrefixes.get(squeezed) ?? []
        if (!pids.includes(v.id)) pids.push(v.id)
        poPrefixes.set(squeezed, pids)
      }
      if (!usablePhrase(phrase)) continue
      const ids = phrases.get(phrase) ?? []
      if (!ids.includes(v.id)) ids.push(v.id)
      phrases.set(phrase, ids)
      maxWords = Math.max(maxWords, phrase.split(' ').length)
    }
  }
  return { phrases, poPrefixes, poNumbers, wordsets, maxWords }
}

function grams(words: string[], max: number): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    let g = ''
    for (let n = 0; n < max && i + n < words.length; n++) {
      g = n === 0 ? words[i]! : `${g} ${words[i + n]}`
      out.add(g)
    }
  }
  return out
}

/**
 * Vendors a PO number points to: one on file (BAFFIN2226), or our <vendor name><date> pattern (PNW9126).
 * po: text where any letters+digits word may be a PO (subject, file names); after "PO", "PO#" or "PO No."
 * in the body counts too. Common words with a year ("Spring 2026") never count.
 */
export function poVendors(index: VendorIndex, po: string, body = ''): string[] {
  const found = new Set<string>()
  const tokens = new Set<string>()
  for (const text of [po, body]) {
    for (const m of text.matchAll(/\bP\.?\s?O\.?\s*(?:#|no\.?|number)?\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/gi)) tokens.add(m[1]!)
  }
  for (const m of po.matchAll(/\b([A-Za-z][A-Za-z&']*[- ]?\d[\d-]{2,})\b/g)) tokens.add(m[1]!)
  for (const t of tokens) {
    const k = poKey(t)
    if (commonPo(k)) continue
    const onFile = index.poNumbers.get(k)
    if (onFile) { found.add(onFile); continue }
    const m = k.match(/^([A-Z]{3,})(\d{3,8})$/)
    if (!m) continue
    const ids = index.poPrefixes.get(m[1]!.toLowerCase())
    if (ids && ids.length === 1) found.add(ids[0]!)
  }
  return [...found]
}

/**
 * Vendors named in an email. A PO number decides. Otherwise multi-word names count anywhere in the clue
 * text; a one-word name ("Thermacell") counts only in the subject, a file name or the From name, where it
 * is rarely a coincidence ("Hi Sherry" in a body is not the vendor Sherry). A one-word name that is a first
 * name (Angie) also needs another of that vendor's names in the email, so "Angie Castillo" is not Angie.
 */
export function mentionedVendors(index: VendorIndex, clues: { strong: string; body: string; from?: string }): string[] {
  const byPo = poVendors(index, clues.strong, clues.body)
  if (byPo.length) return byPo
  const strong = grams(normalize(clues.strong), index.maxWords)
  const body = grams(normalize(clues.body), index.maxWords)
  const from = grams(normalize(clues.from ?? ''), index.maxWords)
  const hits = new Map<string, string[]>()
  for (const [phrase, ids] of index.phrases) {
    const multi = phrase.includes(' ')
    const hit = strong.has(phrase) || from.has(phrase) || (multi && body.has(phrase))
    if (hit) for (const id of ids) hits.set(id, [...(hits.get(id) ?? []), phrase])
  }
  return [...hits.entries()]
    .filter(([, phrases]) => phrases.some((p) => p.includes(' ') || !FIRST_NAMES.has(p)) || phrases.length > 1)
    .map(([id]) => id)
}

/** The part of a domain that names the company: mail.wfsports.com → wfsports. */
export function domainLabel(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  const twoLevel = parts.length >= 3 && ['co', 'com', 'net', 'org'].includes(parts[parts.length - 2]!) && parts[parts.length - 1]!.length === 2
  return (twoLevel ? parts[parts.length - 3]! : parts[parts.length - 2]!).replace(/[^a-z0-9]/g, '')
}

/** Vendors whose name the web address looks like: wfsports → World Famous Sports, thermacell → Thermacell. */
export function domainVendors(index: VendorIndex, domain: string): string[] {
  const label = domainLabel(domain)
  if (label.length < 3) return []
  const found = new Set<string>()
  for (const { id, words } of index.wordsets) {
    const core = words.filter((w) => !CORPORATE.has(w))
    if (!core.length || core.every((w) => NEVER_ALONE.has(w))) continue
    const joined = core.join('')
    const initials = core.length >= 2 ? core.map((w) => w[0]).join('') : ''
    const lastWhole = core.length >= 2 ? core.slice(0, -1).map((w) => w[0]).join('') + core[core.length - 1] : ''
    const firstWhole = core.length >= 2 ? core[0] + core.slice(1).map((w) => w[0]).join('') : ''
    const hit =
      label === joined ||
      (joined.length >= 6 && label.startsWith(joined) && !(core.length === 1 && GENERIC.has(joined))) ||
      (label.length >= 6 && joined.startsWith(label) && !GENERIC.has(label)) ||
      (initials.length >= 3 && (label === initials || label === `${initials}inc` || label === `${initials}usa`)) ||
      (lastWhole.length >= 5 && label === lastWhole) ||
      (firstWhole.length >= 5 && core[0]!.length >= 4 && !GENERIC.has(core[0]!) && label === firstWhole)
    if (hit) found.add(id)
  }
  // A label that fits many vendors says nothing.
  return found.size <= 3 ? [...found] : []
}

/**
 * The vendor a freight bill's shipper is: "MASTER FISH TACKLE" → Master Fishing Tackle. Every word of one of
 * the vendor's names must be in the shipper name, a shortened word counting ("fish" for "fishing"). Only an
 * answer with one vendor counts; anything else goes to a person.
 */
export function shipperVendors(index: VendorIndex, shipper: string): string[] {
  const words = normalize(shipper).filter((w) => !CORPORATE.has(w))
  if (!words.length) return []
  const fits = (vw: string) => words.some((w) => w === vw || (w.length >= 4 && vw.startsWith(w)) || (vw.length >= 4 && w.startsWith(vw)))
  let best = 0
  const scored = new Map<string, number>()
  for (const { id, words: vwords } of index.wordsets) {
    const core = vwords.filter((w) => !CORPORATE.has(w))
    if (!core.length || core.every((w) => NEVER_ALONE.has(w))) continue
    if (!core.every(fits)) continue
    // The more of the shipper's words the name explains, the better. A name of common words only
    // ("Master Fishing Tackle") must explain the whole shipper name.
    const score = core.length / words.length
    if (core.every((w) => GENERIC.has(w)) && (core.length < 2 || score < 1)) continue
    scored.set(id, Math.max(scored.get(id) ?? 0, score))
    best = Math.max(best, score)
  }
  const top = [...scored.entries()].filter(([, sc]) => sc === best).map(([id]) => id)
  return best >= 0.5 && top.length === 1 ? top : []
}

