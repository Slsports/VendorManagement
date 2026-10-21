// Add-ons to open orders (Dana, Oct 16): the email that asks the vendor to add items to an order already sent, with
// the items in one clean table and a request for one confirmation covering the whole order. When no confirmation has
// come back yet, the email says so and asks for one for everything.
import type { IncomingLine } from './suggestedOrder'
import type { SalesItem } from './salesReport'

export const ADDONS_LABELS: Record<'yes' | 'no' | 'ask', string> = { yes: 'Yes, until it ships', no: 'No', ask: 'Ask the rep' }

export interface AddOnLine { vendor_item_id: string | null; description: string; quantity: number; unit_cost: number | null }
export interface AddOnOrder { id: string; po_number: string | null; order_date: string | null; est_ship_date: string | null; status: string; addons: 'yes' | 'no' | 'ask' | null; description: string | null }

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)

/** The order as the vendor knows it: "PO SLS101426" or "our order of Oct 10". */
export function orderWord(o: Pick<AddOnOrder, 'po_number' | 'order_date'>): string {
  return o.po_number ? `PO ${o.po_number}` : o.order_date ? `our order of ${day(o.order_date)}` : 'our order'
}

/** A plain-text table the rep can read in any mail program. */
export function linesTable(lines: AddOnLine[]): string {
  const w1 = Math.max(9, ...lines.map((l) => (l.vendor_item_id ?? '').length))
  const w2 = Math.max(11, ...lines.map((l) => l.description.length))
  const rows = [`${pad('Vendor ID', w1)}  ${pad('Description', w2)}  Qty`, `${'-'.repeat(w1)}  ${'-'.repeat(w2)}  ---`]
  for (const l of lines) rows.push(`${pad(l.vendor_item_id ?? '', w1)}  ${pad(l.description, w2)}  ${l.quantity}`)
  return rows.join('\n')
}

/** The add-on email: subject and body, before the signature. */
export function addOnEmail(input: { vendorName: string; order: AddOnOrder; lines: AddOnLine[]; hasConfirmation: boolean; originalLines: AddOnLine[] }): { subject: string; body: string } {
  const what = orderWord(input.order)
  const subject = `${input.order.po_number ? `PO ${input.order.po_number}` : 'Our order'}: please add the following`
  const ship = input.order.est_ship_date ? ` (ships ${day(input.order.est_ship_date)})` : ''
  const parts: string[] = []
  if (input.hasConfirmation) {
    parts.push(`Hello,\n\nBefore ${what}${ship} ships, please add the items below to it. The confirmation you sent is attached for reference.`)
  } else {
    parts.push(`Hello,\n\nWe have not received a confirmation yet for ${what}${input.order.order_date ? `, sent on ${day(input.order.order_date)}` : ''}. Please add the items below to that order.`)
  }
  parts.push(`Please add:\n\n${linesTable(input.lines)}`)
  if (!input.hasConfirmation && input.originalLines.length) parts.push(`For reference, the original order:\n\n${linesTable(input.originalLines)}`)
  parts.push('When it is updated, please send one confirmation covering the whole order, with the ship date.\n\nThank you,')
  return { subject, body: parts.join('\n\n') }
}

/** The one-line question when the order's add-on choice is "ask the rep". */
export function askAddOnsEmail(order: AddOnOrder): { subject: string; body: string } {
  const what = orderWord(order)
  return { subject: `${order.po_number ? `PO ${order.po_number}` : 'Our order'}: can we still add to it?`, body: `Hello,\n\nCan we still add items to ${what}${order.est_ship_date ? ` before it ships on ${day(order.est_ship_date)}` : ' before it ships'}? If so, until when?\n\nThank you,` }
}

const key = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const keyNoZeros = (s: string | null | undefined) => key(s).replace(/^0+(?=\d)/, '')

export interface OnOrderMatch { qty: number; from: { orderId: string; orderLabel: string; qty: number; stage: IncomingLine['stage']; expected: string | null }[] }

/** What is already coming in for each report item (by Vendor ID, then description), each incoming line used once. */
export function matchIncoming(items: SalesItem[], incoming: IncomingLine[]): Map<string, OnOrderMatch> {
  const byVid = new Map<string, IncomingLine[]>()
  const byDesc = new Map<string, IncomingLine[]>()
  for (const l of incoming) {
    if (l.vid) for (const k of new Set([key(l.vid), keyNoZeros(l.vid)])) byVid.set(k, [...(byVid.get(k) ?? []), l])
    if (l.desc) byDesc.set(key(l.desc), [...(byDesc.get(key(l.desc)) ?? []), l])
  }
  const used = new Set<IncomingLine>()
  const out = new Map<string, OnOrderMatch>()
  for (const x of items) {
    const found = (x.vid ? byVid.get(key(x.vid)) ?? byVid.get(keyNoZeros(x.vid)) : undefined) ?? byDesc.get(key(x.desc)) ?? []
    const lines = found.filter((l) => !used.has(l))
    if (!lines.length) continue
    lines.forEach((l) => used.add(l))
    out.set(x.sid, { qty: lines.reduce((s, l) => s + l.qty, 0), from: lines.map((l) => ({ orderId: l.orderId, orderLabel: l.orderLabel, qty: l.qty, stage: l.stage, expected: l.expected })) })
  }
  return out
}

/** Dana, Oct 21: pending until the vendor confirms, placed once confirmed. */
const NOTE_STAGE = { placed: 'pending', confirmed: 'placed', shipped: 'shipped' } as const

/** "12 placed on PO SLS101426, ships Nov 3" for the report's Notes. */
export function onOrderNote(m: OnOrderMatch): string {
  return m.from.map((f) => `${f.qty} ${NOTE_STAGE[f.stage]} on ${f.orderLabel.split(' · ')[0]}${f.expected ? `, ships ${day(f.expected)}` : f.stage === 'shipped' ? '' : ', no ship date yet'}`).join('; ')
}
