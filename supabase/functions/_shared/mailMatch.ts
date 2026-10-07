// Vendor clues in an email (decisions log Oct 7): the sender's web address, and vendor names in the
// subject, the message above the signature, attachment file names and the From name. Pure functions,
// shared by the gmail-sync Edge Function (Deno) and the unit tests (vitest).

export interface VendorRef { id: string; name: string; aliases: string[] }
export interface VendorIndex {
  /** phrase ("world famous sports") → vendor ids */
  phrases: Map<string, string[]>
  /** words of each vendor's names, for the web-address check */
  wordsets: { id: string; words: string[] }[]
  maxWords: number
}

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
    const base = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, ' ')
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
  if (words.length === 1) return !GENERIC.has(words[0]!) && !CORPORATE.has(words[0]!)
  return !words.every((w) => GENERIC.has(w) || CORPORATE.has(w))
}

/** ignore: phrases that are ours and appear in every email ("shaver lake"). */
export function buildVendorIndex(vendors: VendorRef[], ignore: string[] = []): VendorIndex {
  const phrases = new Map<string, string[]>()
  const wordsets: VendorIndex['wordsets'] = []
  const ignored = ignore.map((p) => normalize(p).join(' '))
  let maxWords = 1
  for (const v of vendors) {
    for (const phrase of vendorNames(v)) {
      if (ignored.some((ig) => phrase.includes(ig))) continue
      wordsets.push({ id: v.id, words: phrase.split(' ') })
      if (!usablePhrase(phrase)) continue
      const ids = phrases.get(phrase) ?? []
      if (!ids.includes(v.id)) ids.push(v.id)
      phrases.set(phrase, ids)
      maxWords = Math.max(maxWords, phrase.split(' ').length)
    }
  }
  return { phrases, wordsets, maxWords }
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
 * Vendors named in an email. Multi-word names count anywhere in the clue text; a one-word name
 * ("Thermacell") counts only in the subject, a file name or the From name, where it is rarely a
 * coincidence ("Hi Sherry" in a body is not the vendor Sherry).
 */
export function mentionedVendors(index: VendorIndex, clues: { strong: string; body: string }): string[] {
  const strong = grams(normalize(clues.strong), index.maxWords)
  const body = grams(normalize(clues.body), index.maxWords)
  const found = new Set<string>()
  for (const [phrase, ids] of index.phrases) {
    const hit = strong.has(phrase) || (phrase.includes(' ') && body.has(phrase))
    if (hit) for (const id of ids) found.add(id)
  }
  return [...found]
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
    if (!core.length) continue
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
