import type { ScoreDimension, VendorScorecard as Card } from '@/types'

export const SCORE_DIMENSIONS: { key: ScoreDimension; label: string; help: string; auto: boolean }[] = [
  { key: 'ease', label: 'Ease of ordering', help: 'How much work it takes to get an order in: forms, portals, confirmations.', auto: false },
  { key: 'communication', label: 'Communication and help', help: 'Does the rep or vendor answer, and do they help get the order right?', auto: false },
  { key: 'fulfilment', label: 'On-time fulfilment', help: 'Received within a week of the ship date they gave.', auto: true },
  { key: 'accuracy', label: 'Order accuracy', help: 'Right items, right quantities, right hang tags, nothing damaged. From check-in notes today; from the check-in form once it lives in VMS.', auto: true },
  { key: 'shipping', label: 'Shipping', help: 'Freight as a share of product cost, free shipping honored, late or lost shipments.', auto: true },
  { key: 'resolution', label: 'Resolving issues', help: 'Credits owed to us: how many came through and how fast.', auto: true },
]

export const SCORE_WORDS: Record<1 | 2 | 3 | 4 | 5, string> = { 1: 'Poor', 2: 'Weak', 3: 'Fair', 4: 'Good', 5: 'Excellent' }

export function scoreTone(score: number | null): 'good' | 'mid' | 'bad' | 'none' {
  if (score === null) return 'none'
  return score >= 4 ? 'good' : score >= 3 ? 'mid' : 'bad'
}

/** What the order history says for one dimension, in a sentence. */
export function evidence(c: Card, key: ScoreDimension): string {
  switch (key) {
    case 'fulfilment':
      if (c.received < 2) return c.received ? 'One order with both a ship date and a received date; two are needed to score.' : 'No orders with both a ship date and a received date yet.'
      return `${c.on_time} of ${c.received} received within a week of the ship date${c.late ? `, ${c.late} late by about ${c.avg_days_late ?? '?'} days` : ''}.`
    case 'accuracy':
      if (c.orders < 3) return `${c.orders} order${c.orders === 1 ? '' : 's'} on file; three are needed to score.`
      return c.accuracy_issues ? `${c.accuracy_issues} of ${c.orders} orders mention damage, shortages, wrong items or wrong tags.` : `No damage, shortage, wrong-item or tag notes on ${c.orders} orders.`
    case 'shipping':
      if (c.freight_pct === null) return 'Fewer than two orders with a freight figure.'
      return `Freight ${c.freight_pct}% of product cost over ${c.freight_orders} orders${c.free_violations ? `, ${c.free_violations} charged when they should have shipped free` : ''}${c.issue_notes ? `, ${c.issue_notes} late or lost notes` : ''}.`
    case 'resolution':
      if (!c.credits_due) return 'No credits owed on file yet.'
      return `${c.credits_resolved} of ${c.credits_due} credits received${c.avg_credit_days !== null ? `, about ${c.avg_credit_days} days each` : ''}.`
    default:
      return 'No automatic signal yet. It comes from the vendor emails once Gmail is connected.'
  }
}

