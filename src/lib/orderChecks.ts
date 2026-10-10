import type { OrderCheck } from '@/types'

// Order paperwork checks (Dana, Oct 10): words for the screens.

export const CHECK_KIND_LABEL: Record<OrderCheck['kind'], string> = { confirmation: 'Confirmation', invoice: 'Invoice' }
export const CHECK_TITLE: Record<OrderCheck['kind'], string> = { confirmation: 'Confirmation vs. our order', invoice: 'Invoice vs. confirmation' }

/** One line for where a check stands. */
export function checkStatusText(c: Pick<OrderCheck, 'status' | 'result' | 'issues' | 'outcome'>): { text: string; tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' } {
  const n = Array.isArray(c.issues) ? c.issues.length : 0
  switch (c.status) {
    case 'reading': return { text: 'Claude is reading it', tone: 'info' }
    case 'comparing': return { text: 'Claude is comparing', tone: 'info' }
    case 'needs_order': return { text: 'Which order is this for?', tone: 'warning' }
    case 'failed': return { text: 'Could not be read', tone: 'danger' }
    case 'to_review': return c.result === 'issues' ? { text: `${n} issue${n === 1 ? '' : 's'} to review`, tone: 'danger' } : { text: 'Everything matches: look it over', tone: 'success' }
    case 'done': return { text: c.outcome === 'sent' ? 'Done, email sent' : 'Done', tone: 'neutral' }
    case 'not_paperwork': return { text: 'Not a confirmation or invoice', tone: 'neutral' }
    case 'dismissed': return { text: 'Set aside', tone: 'neutral' }
  }
}

/** Whole days since it came in. */
export function daysWaiting(since: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000))
}
export const daysWaitingNow = (since: string) => daysWaiting(since)

/** The four documents to an order, in order (Dana, Oct 10). */
export const ORDER_PAPERS = [
  { kind: 'order', label: 'Our order' },
  { kind: 'ls_po', label: 'LS PO' },
  { kind: 'confirmation', label: 'Confirmation' },
  { kind: 'invoice', label: 'Invoice' },
] as const
