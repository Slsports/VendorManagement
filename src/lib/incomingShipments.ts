// Incoming Shipments (Dana, Nov 13: "Isnt all the data available for incoming shipments? We just need to build the page?"):
// every live order with what VMS already knows about its shipping, read into one line each. Pure, so it is tested.

export type IncomingStatus = 'open' | 'awaiting_confirmation' | 'confirmed' | 'shipped'

export interface IncomingOrder {
  id: string
  po_number: string | null
  description: string | null
  status: IncomingStatus
  order_date: string | null
  est_ship_date: string | null
  store_codes: string[]
  vendor: { id: string; name: string } | null
}
/** The latest carrier or vendor shipping email tied to the order. */
export interface ShipEmail { id: string; thread_id: string; received_at: string; ship_status: string | null; ship_carrier: string | null; ship_ref: string | null; ship_eta: string | null; from_name: string | null }
/** The vendor's answer to our shipment-details form. */
export interface FormAnswer { request_id: string; answered_at: string | null; ready_date: string | null; carrier: string | null }
export interface Receipt { id: string; delivered_on: string | null; pro_number: string | null; signed_by: string | null }

export type WhereFrom = 'receipt' | 'carrier' | 'form' | 'order'

export interface IncomingRow {
  order: IncomingOrder
  /** the day it is expected (or came), when VMS knows it */
  arrival: string | null
  /** the day it ships or shipped, when VMS knows it */
  ship_date: string | null
  /** the day the calendar and the sort go by: the arrival, else the ship date */
  day: string | null
  delivered: boolean
  carrier: string | null
  tracking: string | null
  /** where the dates came from, in plain words, and what opens */
  from: { kind: WhereFrom; label: string; to: string | null }
  /** later than the day and still not received */
  late: boolean
  email: ShipEmail | null
}

const STATUS_WORD: Record<string, string> = { picked_up: 'picked up', in_transit: 'in transit', out_for_delivery: 'out for delivery', delivered: 'delivered', exception: 'a problem' }

export function shipStatusWord(s: string | null | undefined): string | null {
  return s ? STATUS_WORD[s] ?? s : null
}

/** One order's shipping line from what is on file. `today` is a local YYYY-MM-DD. */
export function incomingRow(order: IncomingOrder, emails: ShipEmail[], answers: FormAnswer[], receipts: Receipt[], today: string): IncomingRow {
  const email = [...emails].sort((a, b) => b.received_at.localeCompare(a.received_at))[0] ?? null
  const answer = [...answers].filter((a) => a.ready_date || a.carrier).sort((a, b) => (b.answered_at ?? '').localeCompare(a.answered_at ?? ''))[0] ?? null
  const receipt = [...receipts].filter((r) => r.delivered_on).sort((a, b) => (b.delivered_on ?? '').localeCompare(a.delivered_on ?? ''))[0] ?? null
  const carrier = email?.ship_carrier ?? answer?.carrier ?? null
  const tracking = email?.ship_ref ?? receipt?.pro_number ?? null
  const shipDate = answer?.ready_date ?? order.est_ship_date ?? null
  let arrival: string | null = null
  let delivered = false
  let from: IncomingRow['from']
  if (receipt?.delivered_on) {
    arrival = receipt.delivered_on; delivered = true
    from = { kind: 'receipt', label: `delivered ${fmt(receipt.delivered_on)}${receipt.signed_by ? `, signed by ${receipt.signed_by}` : ''} (the carrier's receipt)`, to: `/orders/${order.id}` }
  } else if (email?.ship_status === 'delivered') {
    arrival = email.received_at.slice(0, 10); delivered = true
    from = { kind: 'carrier', label: `delivered ${fmt(arrival)} (${email.ship_carrier ?? 'the carrier'}'s email)`, to: `/mail/${email.thread_id}` }
  } else if (email?.ship_eta) {
    arrival = email.ship_eta
    from = { kind: 'carrier', label: `${email.ship_carrier ?? 'the carrier'} says ${fmt(email.ship_eta)}${email.ship_status ? `, ${shipStatusWord(email.ship_status)}` : ''}`, to: `/mail/${email.thread_id}` }
  } else if (email?.ship_status) {
    from = { kind: 'carrier', label: `${email.ship_carrier ?? 'the carrier'}: ${shipStatusWord(email.ship_status)} ${fmt(email.received_at.slice(0, 10))}, no arrival date given`, to: `/mail/${email.thread_id}` }
  } else if (answer?.ready_date) {
    from = { kind: 'form', label: `ready to ship ${fmt(answer.ready_date)} (the vendor's shipment form)`, to: `/orders/${order.id}` }
  } else if (order.est_ship_date) {
    from = { kind: 'order', label: `expected to ship ${fmt(order.est_ship_date)} (the order)`, to: `/orders/${order.id}` }
  } else {
    from = { kind: 'order', label: 'no ship date yet', to: `/orders/${order.id}` }
  }
  const day = arrival ?? shipDate
  return { order, arrival, ship_date: shipDate, day, delivered, carrier, tracking, from, late: !!day && day < today && !delivered, email }
}

/** "Nov 18", with the year when it is not this year ("Feb 9, 2026"). */
export const fmt = (d: string, now = new Date()) => {
  const x = new Date(`${d.slice(0, 10)}T12:00:00`)
  return x.toLocaleDateString('en-US', x.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Rows inside a From / To window (by the day they go by); rows with no day only when no window is set. */
export function inWindow(rows: IncomingRow[], from: string | null, to: string | null): IncomingRow[] {
  if (!from && !to) return rows
  return rows.filter((r) => r.day && (!from || r.day >= from) && (!to || r.day <= to))
}

/** Soonest first; rows with no day last, newest order first among them. */
export function sortIncoming(rows: IncomingRow[]): IncomingRow[] {
  return [...rows].sort((a, b) => {
    if (a.day && b.day) return a.day.localeCompare(b.day)
    if (a.day) return -1
    if (b.day) return 1
    return (b.order.order_date ?? '').localeCompare(a.order.order_date ?? '')
  })
}
