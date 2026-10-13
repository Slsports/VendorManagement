import type { FreightQuote } from '@/types'

export const QUOTE_STATUS: Record<FreightQuote['status'], { text: string; tone: 'warning' | 'danger' | 'success' | 'neutral' }> = {
  waiting: { text: 'Waiting on freight quote', tone: 'warning' },
  needs_order: { text: 'Which order?', tone: 'danger' },
  approved: { text: 'Approved', tone: 'success' },
  declined: { text: 'Not a quote', tone: 'neutral' },
}

/** Pallets go by truck with Priority One; boxes go parcel, UPS through WWEX (Dana, Oct 13). */
export const SHIPS_BY = {
  pallet: { label: 'Pallet (P1)', ours: 'priority_one', oursLabel: 'Priority One' },
  parcel: { label: 'Parcel (WWEX/UPS)', ours: 'wwex', oursLabel: 'WWEX (UPS)' },
} as const

/** Lowest price we have for a quote: the vendor's and ours for the way it ships (both of ours while that is not known). */
export function cheapest(q: Pick<FreightQuote, 'vendor_cost' | 'priority_one_cost' | 'wwex_cost'> & { ships_by?: FreightQuote['ships_by'] }): number | null {
  const ours = q.ships_by === 'pallet' ? [q.priority_one_cost] : q.ships_by === 'parcel' ? [q.wwex_cost] : [q.priority_one_cost, q.wwex_cost]
  const all = [q.vendor_cost, ...ours].filter((x): x is number => x !== null && x !== undefined)
  return all.length ? Math.min(...all.map(Number)) : null
}

