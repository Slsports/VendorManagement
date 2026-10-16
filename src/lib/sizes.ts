// Sizes for the Size Summary (spec v49; Dana, Oct 16: "SZ 8" and "SIZE 8" are one size). The size is read from the
// category's last rung when the category standard names it ("… > 3 MED (10/12)"), else from the description. Kids
// number sizes (5, 6, 6X, 7, 8, 10/12), shoe sizes (W10, SZ 11, 7.5) and letter sizes (XS … 4XL) all come out as one
// plain label each, with the spelling variants kept so the report can say what was merged.

export interface SizeRead { size: string; raw: string }

/** The rungs of a category path; a slash inside parentheses ("3 MED (10/12)") is part of the rung. */
export const rungsOf = (cat: string) => cat.split(/\/(?![^(]*\))/).map((r) => r.trim()).filter(Boolean)

const LETTER: Record<string, string> = {
  XXS: 'XXS', XS: 'XS', XSMALL: 'XS', 'X-SMALL': 'XS', 'X-SM': 'XS',
  S: 'S', SM: 'S', SMALL: 'S', M: 'M', MD: 'M', MED: 'M', MEDIUM: 'M', L: 'L', LG: 'L', LARGE: 'L',
  XL: 'XL', XLARGE: 'XL', 'X-LARGE': 'XL', '1XL': 'XL', XXL: '2XL', '2X': '2XL', '2XL': '2XL', 'XX-LARGE': '2XL',
  XXXL: '3XL', '3X': '3XL', '3XL': '3XL', '4X': '4XL', '4XL': '4XL', '5X': '5XL', '5XL': '5XL',
  OS: 'ONE SIZE', OSFA: 'ONE SIZE', 'O/S': 'ONE SIZE', 'ONE SIZE': 'ONE SIZE', 'ONESIZE': 'ONE SIZE',
}
const LETTER_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE SIZE']
const LETTER_RE = /\b(XXS|XS|X-?SM(?:ALL)?|SM|S|MD|MED|MEDIUM|M|LG|LARGE|L|XL|X-?LARGE|1XL|XXL|2XL?|XX-LARGE|XXXL|3XL?|4XL?|5XL?|OS|OSFA|O\/S|ONE ?SIZE)\b/

/** The size as the report shows it, or null when none can be read. */
export function sizeOf(desc: string, cat: string): SizeRead | null {
  // 1. the category standard's size rung: "CLOTHING/TEES/KIDS/BOYS/3 MED (10/12)" or ".../6X"
  const rung = rungsOf(cat).pop() ?? ''
  const std = /^(\d)\s+(XS|SM|MED|LG|XL|2XL|3XL|4XL)\b/i.exec(rung)
  if (std) return { size: LETTER[std[2]!.toUpperCase()] ?? std[2]!.toUpperCase(), raw: rung }
  if (/^ONE SIZE$/i.test(rung)) return { size: 'ONE SIZE', raw: rung }
  const d = ` ${desc.toUpperCase().replace(/[”″]/g, '"').replace(/\s+/g, ' ').trim()} `
  // 2. "SZ 8", "SIZE 8.5", "SZ 6X", "SIZE 10/12", "SZ 7-8"
  let m = /\b(?:SZ|SIZE)\.?\s*:?\s*([0-9]{1,2}(?:\.5)?X?(?:[/-][0-9]{1,2})?|[0-9]T|[0-9]{1,2}M)\b/.exec(d)
  if (m) return { size: kidsOrNumber(m[1]!), raw: m[0]!.trim() }
  m = /\b(?:SZ|SIZE)\.?\s*:?\s*([A-Z/-]{1,8})\b/.exec(d)
  if (m && LETTER[m[1]!]) return { size: LETTER[m[1]!]!, raw: m[0]!.trim() }
  // 3. shoe sizes with a gender letter: "W10", "M 9.5", "- W10"
  m = /\b([WMK])\s?([0-9]{1,2}(?:\.5)?)\b/.exec(d)
  if (m) return { size: m[2]!, raw: m[0]!.trim() }
  // 4. a kids number size on its own at the end or after a dash: "… BLUE 6X", "… - 10/12", "… 5/6"
  m = /(?:-|\s)([0-9]{1,2}X|[0-9]{1,2}\/[0-9]{1,2}|[0-9]T|[0-9]{1,2}-[0-9]{1,2}M?)\s*$/.exec(d)
  if (m) return { size: kidsOrNumber(m[1]!), raw: m[1]! }
  // 5. a letter size as its own word, last one wins ("MENS TEE NAVY XL", "… LARGE")
  const letters = [...d.matchAll(new RegExp(LETTER_RE.source, 'g'))]
  const last = letters[letters.length - 1]
  if (last && LETTER[last[1]!.replace(/\s+/g, ' ')]) return { size: LETTER[last[1]!.replace(/\s+/g, ' ')]!, raw: last[1]! }
  // 6. a bare number at the very end ("… BOOT 11", "… 7.5"), two digits or a half size, 1 to 20
  m = /\s([0-9]{1,2}(?:\.5)?)\s*$/.exec(d)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) return { size: m[1]!, raw: m[1]! }
  return null
}

function kidsOrNumber(s: string): string {
  return s.toUpperCase().replace(/^0+(?=\d)/, '')
}

/** Sort: numbers (and 6X, 10/12) small to large, then letters XS … 4XL, then ONE SIZE, then anything else. */
export function sizeRank(size: string): number {
  const li = LETTER_ORDER.indexOf(size)
  if (li >= 0) return 1000 + li
  const n = /^([0-9]{1,2}(?:\.5)?)(X)?(?:[/-]([0-9]{1,2}))?/.exec(size)
  if (n) return Number(n[1]) + (n[2] ? 0.25 : 0) + (n[3] ? 0.1 : 0)
  return 5000
}

const GENDERS = ['MENS', 'WOMENS', 'BOYS', 'GIRLS', 'UNISEX', 'KIDS', 'YOUTH', 'INFANT', 'TODDLER', 'JUNIORS', 'LADIES']
const GENDER_WORDS: Record<string, string> = { MENS: 'Mens', MEN: 'Mens', "MEN'S": 'Mens', WOMENS: 'Womens', WOMEN: 'Womens', "WOMEN'S": 'Womens', WMNS: 'Womens', LADIES: 'Womens', BOYS: 'Boys', BOY: 'Boys', GIRLS: 'Girls', GIRL: 'Girls', UNISEX: 'Unisex', KIDS: 'Kids', KID: 'Kids', YOUTH: 'Youth', INFANT: 'Infant', TODDLER: 'Toddler', JUNIORS: 'Juniors', JR: 'Juniors' }

/** "Mens", "Girls", "Kids" … from the category path first, then the description; "" when neither says. */
export function genderOf(desc: string, cat: string): string {
  for (const rung of rungsOf(cat.toUpperCase())) {
    const w = rung.trim().replace(/\s*\(.*\)\s*$/, '')
    if (GENDERS.includes(w)) return GENDER_WORDS[w] ?? ''
    const first = w.split(/\s+/)[0] ?? ''
    if (GENDERS.includes(first)) return GENDER_WORDS[first] ?? ''
  }
  const words = desc.toUpperCase().replace(/[^A-Z' ]+/g, ' ').split(/\s+/)
  for (const w of words) if (GENDER_WORDS[w]) return GENDER_WORDS[w]!
  return ''
}

/** The subcategory shown on the Size Summary: the category path without its top rung, gender and size rungs. */
export function subcategoryOf(cat: string): string {
  const rungs = rungsOf(cat)
  const keep = rungs.slice(1).filter((r) => {
    const u = r.toUpperCase().replace(/\s*\(.*\)\s*$/, '')
    if (GENDERS.includes(u) || GENDERS.includes(u.split(/\s+/)[0] ?? '')) return false
    if (/^(\d\s+)?(XS|SM|MED|LG|XL|2XL|3XL|4XL|ONE SIZE)\b/i.test(r)) return false
    return true
  })
  return (keep.length ? keep : rungs).join(' / ')
}
