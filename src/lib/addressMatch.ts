/**
 * Address suggestions while typing in To or Cc (Dana, Nov 5: "All address fields for sending mail should pop up any vendor
 * contact email if you start typing as well as sls employees. I went to type jarr for jarrett and nothing came up").
 * The field holds addresses separated by commas; only the part after the last comma is being typed.
 */
export interface BookEntry { email: string; name: string; where: string }

/** What is being typed now: the text after the last comma or semicolon. */
export function typingPart(value: string): string {
  const i = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'))
  return value.slice(i + 1).trim()
}

/** Up to `max` people matching what is typed, best first: a name or email that starts with it, then one that contains it, then the company. */
export function matchBook(book: BookEntry[], typed: string, chosen: string[], max = 8): BookEntry[] {
  const q = typed.trim().toLowerCase()
  if (q.length < 2) return []
  const taken = new Set(chosen.map((c) => c.toLowerCase()))
  const seen = new Set<string>()
  const scored: { b: BookEntry; s: number }[] = []
  for (const b of book) {
    const key = b.email.toLowerCase()
    if (taken.has(key) || seen.has(key)) continue
    const name = b.name.toLowerCase()
    const words = name.split(/[^a-z0-9]+/)
    let s = -1
    if (name.startsWith(q) || key.startsWith(q)) s = 0
    else if (words.some((w) => w.startsWith(q))) s = 1
    else if (name.includes(q) || key.includes(q)) s = 2
    else if (b.where.toLowerCase().includes(q)) s = 3
    if (s < 0) continue
    seen.add(key)
    scored.push({ b, s })
  }
  return scored.sort((a, z) => a.s - z.s || a.b.name.localeCompare(z.b.name)).slice(0, max).map((x) => x.b)
}

/** The field with the typed part replaced by the picked address, ready for the next one. */
export function pickAddress(value: string, email: string): string {
  const i = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'))
  const before = i >= 0 ? value.slice(0, i + 1).trimEnd() + ' ' : ''
  return `${before}${email}, `
}
