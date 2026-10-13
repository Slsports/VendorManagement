import type { FreightQuote } from '@/types'

export const QUOTE_STATUS: Record<FreightQuote['status'], { text: string; tone: 'warning' | 'danger' | 'success' | 'neutral' }> = {
  waiting: { text: 'Waiting on freight quote', tone: 'warning' },
  needs_order: { text: 'Which order?', tone: 'danger' },
  approved: { text: 'Approved', tone: 'success' },
  declined: { text: 'Not a quote', tone: 'neutral' },
}

/** Lowest price we have for a quote: the vendor's, Priority One's or WWEX's. */
export function cheapest(q: Pick<FreightQuote, 'vendor_cost' | 'priority_one_cost' | 'wwex_cost'>): number | null {
  const all = [q.vendor_cost, q.priority_one_cost, q.wwex_cost].filter((x): x is number => x !== null && x !== undefined)
  return all.length ? Math.min(...all.map(Number)) : null
}

