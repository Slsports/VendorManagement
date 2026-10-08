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
