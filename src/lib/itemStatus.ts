// Discontinued, do-not-reorder, out-of-stock and replacement items on the sales reports (Dana, Oct 18). Lightspeed's
// item name and Note carry the story: "*" at the start (or end) of the name = discontinued, "**" = do not reorder (bad
// quality or poor seller), a Note "REPLACED WITH <Vendor ID>" names what to order instead, and a Note "OUT OF STOCK AT
// VENDOR 10/18/26, BACK 11/15/26" says it is only out at the vendor for now. The report shows each one in plain words,
// gives a discontinued item no Need of its own, and carries that need to the replacement, which becomes the item to order.
import type { SalesItem } from './salesReport'
import { needOf } from './salesReport'

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const noZeros = (s: string) => key(s).replace(/^0+(?=\d)/, '')
const WORDS = new Set(['NEW', 'SOMETHING', 'A', 'AN', 'THE', 'OTHER', 'ANOTHER', 'ITEM', 'STYLE', 'STYLES', 'NA', 'N/A', 'TBD'])
const DATE = String.raw`(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})`

/** "REPLACED WITH 63360" → "63360"; "Replaced with new styles" → null (no Vendor ID named). */
export function replacementIn(note: string): string | null {
  const m = /REPLACE[DS]?\s+(?:WITH|BY)\s+(?:#\s*|NO\.?\s*|VENDOR\s+ID\s*)?([A-Z0-9][A-Z0-9.\-/]*)/i.exec(note)
  if (!m) return null
  const token = m[1]!.replace(/[.,;:]+$/, '')
  return WORDS.has(token.toUpperCase()) ? null : token
}

/** "OUT OF STOCK AT VENDOR 10/18/26, BACK 11/15/26" → { since, back }; null when the note says nothing of the kind. */
export function outOfStockIn(note: string): { since: string | null; back: string | null } | null {
  const m = new RegExp(String.raw`OUT\s+OF\s+STOCK(?:\s+AT\s+(?:THE\s+)?VENDOR)?\s*:?\s*${DATE}?`, 'i').exec(note)
  if (!m) return null
  const back = new RegExp(String.raw`BACK(?:\s+IN(?:\s+STOCK)?)?\s*:?\s*(?:ON\s+|BY\s+)?${DATE}`, 'i').exec(note)
  return { since: m[1] ?? null, back: back?.[1] ?? null }
}

/** The marker in the LS name: ** do not reorder, * discontinued (Becker also puts the * at the end). */
export function markerOf(desc: string): 'dnr' | 'discontinued' | null {
  const d = desc.trim()
  if (/^\*\*/.test(d)) return 'dnr'
  if (/^\*/.test(d) || /\s\*$/.test(d)) return 'discontinued'
  return null
}

/**
 * Mark the items (in place) from their LS names and notes, and carry each discontinued item's need to its replacement
 * when the note names one that is on the report. A chain is followed to the end (A replaced by B, B replaced by C: A's
 * need lands on C). Returns how many were marked.
 */
export function markItemStatus(items: SalesItem[]): { discontinued: number; dnr: number; outOfStock: number; replaced: number } {
  const counts = { discontinued: 0, dnr: 0, outOfStock: 0, replaced: 0 }
  const byVid = new Map<string, SalesItem>()
  for (const x of items) {
    for (const k of [x.vid, x.upc, x.sid]) if (k) { byVid.set(key(k), x); byVid.set(noZeros(k), x) }
  }
  const clean = (d: string) => d.replace(/^\*+\s*|\s*\*$/g, '')
  const quoted = (note: string) => (note ? ` LS note: "${note}".` : '')
  // first pass: markers, replacements named, out of stock
  const next = new Map<SalesItem, SalesItem>()   // discontinued item → the item its note names (when on the report)
  for (const x of items) {
    const note = (x.lsNote ?? '').trim()
    const marker = markerOf(x.desc)
    if (marker === 'dnr') {
      x.status = 'dnr'
      counts.dnr++
      x.notes.unshift(`DO NOT REORDER (** in LS).${quoted(note) || ' No reason noted in LS.'}`)
      continue
    }
    if (marker === 'discontinued') {
      x.status = 'discontinued'
      counts.discontinued++
      const vid = replacementIn(note)
      if (vid) x.replacementVid = vid
      const target = vid ? (byVid.get(key(vid)) ?? byVid.get(noZeros(vid))) : undefined
      if (target && target !== x) next.set(x, target)
      continue
    }
    const oos = outOfStockIn(note)
    if (oos) {
      x.status = 'out_of_stock'
      x.backDate = oos.back ?? undefined
      counts.outOfStock++
      x.notes.unshift(`OUT OF STOCK AT VENDOR${oos.since ? ` since ${oos.since}` : ''}${oos.back ? `, back ${oos.back}` : ', no back date given'}.${quoted(note)}`)
    } else if (note) {
      x.notes.push(`LS note: "${note}".`)
    }
  }
  // second pass: follow each chain to its end and carry the need there
  for (const x of items) {
    if (x.status !== 'discontinued') continue
    const note = quoted((x.lsNote ?? '').trim())
    const chain: SalesItem[] = []
    let cur: SalesItem | undefined = next.get(x)
    while (cur && !chain.includes(cur) && cur !== x && chain.length < 10) { chain.push(cur); cur = next.get(cur) }
    const end = chain[chain.length - 1]
    const path = chain.map((c) => c.vid || c.sid).join(', then ')
    if (end && end.status !== 'discontinued' && end.status !== 'dnr') {
      const need = Math.max(0, needOf(x))
      end.carried = (end.carried ?? 0) + need
      end.notes.push(`REPLACES ${x.vid || x.sid} ${clean(x.desc)} (sold ${x.sold}, need ${need}${chain.length > 1 ? `, via ${chain.slice(0, -1).map((c) => c.vid || c.sid).join(', ')}` : ''}): order this item instead.`)
      counts.replaced++
      x.notes.unshift(`DISCONTINUED (* in LS): replaced with ${path}${chain.length > 1 ? ` — order ${end.vid || end.sid}` : ' — order the replacement'} instead; its need is carried there.${note}`)
    } else if (end) {
      x.notes.unshift(`DISCONTINUED (* in LS): replaced with ${path}, which is ${end.status === 'dnr' ? 'marked do not reorder' : 'also discontinued with no replacement on this report'} — check in LS.${note}`)
    } else if (x.replacementVid) {
      x.notes.unshift(`DISCONTINUED (* in LS): replaced with ${x.replacementVid}, which is not on this report — check the replacement in LS.${note}`)
    } else {
      x.notes.unshift(`DISCONTINUED (* in LS): no replacement noted.${note}`)
    }
  }
  return counts
}
