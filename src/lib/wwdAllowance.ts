// Freight allowance for paying on time (Dana, Oct 9): where an order stands against its pay-by date.

export interface AllowanceState { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string }

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)

export function allowanceState(o: { freight_allowance_pay_by: string | null; freight_allowance_received: string | null; paid_date: string | null }, today: string): AllowanceState {
  if (o.freight_allowance_received) return { tone: 'success', text: 'Credit received.' }
  if (o.paid_date) {
    if (o.freight_allowance_pay_by && o.paid_date > o.freight_allowance_pay_by) return { tone: 'danger', text: `Paid ${days(o.freight_allowance_pay_by, o.paid_date)} days late; the allowance may be lost. Ask the vendor.` }
    return { tone: 'warning', text: 'Paid on time. Watch for the credit.' }
  }
  if (!o.freight_allowance_pay_by) return { tone: 'warning', text: 'No pay-by date yet. Add it so the dashboard can remind you.' }
  const left = days(today, o.freight_allowance_pay_by)
  if (left < 0) return { tone: 'danger', text: `The pay-by date passed ${-left} day${left === -1 ? '' : 's'} ago.` }
  if (left <= 7) return { tone: 'danger', text: left === 0 ? 'Pay today to keep it.' : `Pay within ${left} day${left === 1 ? '' : 's'} to keep it.` }
  if (left <= 21) return { tone: 'warning', text: `${left} days left to pay.` }
  return { tone: 'neutral', text: `${left} days left to pay.` }
}
