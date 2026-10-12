// The suggested order (Dana, Oct 11): what LS says we need (Sold − In Stock) minus what is already coming in —
// confirmed orders (the confirmation's lines), shipped or invoiced but not yet in LS (the invoice's lines), and placed
// orders (our order's lines). Items are matched on the Vendor ID, or the description when there is none.
import { needOf, type SalesItem } from './salesReport'

export type IncomingStage = 'placed' | 'confirmed' | 'shipped'
export interface IncomingLine { vid: string | null; desc: string | null; qty: number; orderId: string; orderLabel: string; stage: IncomingStage; expected: string | null }
export interface OnOrder { orderId: string; orderLabel: string; qty: number; stage: IncomingStage; expected: string | null }
export interface SuggestedLine {
  sid: string
  vid: string
  desc: string
  cost: number | null
  sold: number
  inStock: number
  need: number
  onOrder: number
  from: OnOrder[]
  suggested: number
}

const key = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const keyNoZeros = (s: string | null | undefined) => key(s).replace(/^0+(?=\d)/, '')

export function suggestOrder(items: SalesItem[], incoming: IncomingLine[]): SuggestedLine[] {
  const byVid = new Map<string, IncomingLine[]>()
  const byDesc = new Map<string, IncomingLine[]>()
  for (const l of incoming) {
    if (l.vid) for (const k of new Set([key(l.vid), keyNoZeros(l.vid)])) byVid.set(k, [...(byVid.get(k) ?? []), l])
    if (l.desc) byDesc.set(key(l.desc), [...(byDesc.get(key(l.desc)) ?? []), l])
  }
  const used = new Set<IncomingLine>()
  const out: SuggestedLine[] = []
  for (const x of items) {
    if (x.archived || x.nonInv) continue
    const need = needOf(x)
    const found = (x.vid ? byVid.get(key(x.vid)) ?? byVid.get(keyNoZeros(x.vid)) : undefined) ?? byDesc.get(key(x.desc)) ?? []
    const lines = found.filter((l) => !used.has(l))
    lines.forEach((l) => used.add(l))
    const onOrder = lines.reduce((s, l) => s + l.qty, 0)
    if (need <= 0 && !onOrder) continue
    out.push({
      sid: x.sid, vid: x.vid, desc: x.desc, cost: x.cost, sold: x.sold, inStock: Math.max(0, x.qoh), need, onOrder,
      from: lines.map((l) => ({ orderId: l.orderId, orderLabel: l.orderLabel, qty: l.qty, stage: l.stage, expected: l.expected })),
      suggested: Math.max(0, need - onOrder),
    })
  }
  return out.sort((a, b) => b.suggested - a.suggested || b.need - a.need || a.desc.localeCompare(b.desc))
}

export const suggestionTotal = (lines: SuggestedLine[]) => ({
  units: lines.reduce((s, l) => s + l.suggested, 0),
  cost: lines.reduce((s, l) => s + l.suggested * (l.cost ?? 0), 0),
  items: lines.filter((l) => l.suggested > 0).length,
})
