import type { FreightBill } from '@/types'

export const FREIGHT_STATUS: Record<FreightBill['status'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' | 'info' }> = {
  needs_pdf: { label: 'Needs the PDF', tone: 'warning' },
  reading: { label: 'Reading…', tone: 'info' },
  to_match: { label: 'To match', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Could not read', tone: 'danger' },
}

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
export const shortDate = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString() : '—')

/** "XPO.com, @ltl.xpo.com https://www.estes-express.com/" → ['xpo.com', 'ltl.xpo.com', 'estes-express.com']. */
export function domainsFrom(text: string): string[] {
  const out = text.split(/[\s,;]+/).map((d) => d.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').replace(/^www\./, '').replace(/[/?#].*$/, ''))
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))
  return [...new Set(out)]
}

/**
 * The shipping line under an order's cost (Dana, Nov 9: "below the cost of each order list shipping cost, free, or 1/2
 * freight"): free freight, half or capped (with the freight when known), else the freight paid. Null when nothing is known.
 */
export function orderShippingLine(o: { free_shipping: boolean | null; freight_terms?: 'free' | 'half' | 'capped' | 'charged' | null; freight_cap_pct?: number | null; freight_cost: number | null }): { text: string; free: boolean } | null {
  const cost = o.freight_cost != null && o.freight_cost > 0 ? money(o.freight_cost) : null
  if (o.free_shipping === true || o.freight_terms === 'free') return { text: 'Free freight', free: true }
  if (o.freight_terms === 'half') return { text: cost ? `1/2 freight: ${cost}` : '1/2 freight', free: false }
  if (o.freight_terms === 'capped') return { text: `Freight capped ${o.freight_cap_pct ?? '?'}%${cost ? `: ${cost}` : ''}`, free: false }
  if (cost) return { text: `+${cost} freight`, free: false }
  return null
}
