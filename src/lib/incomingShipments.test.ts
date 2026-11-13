import { describe, expect, it } from 'vitest'
import { fmt, incomingRow, inWindow, sortIncoming, type IncomingOrder } from './incomingShipments'

const order = (over: Partial<IncomingOrder> = {}): IncomingOrder => ({ id: 'o1', po_number: 'SR11-10-26', description: 'Sleds', status: 'awaiting_confirmation', order_date: '2026-11-10', est_ship_date: '2026-11-20', store_codes: ['SLS'], vendor: { id: 'v1', name: 'Slippery Racer' }, ...over })
const today = '2026-11-13'

describe('incomingRow', () => {
  it("uses the carrier's arrival date when an email gave one", () => {
    const r = incomingRow(order(), [{ id: 'e1', thread_id: 't1', received_at: '2026-11-12T10:00:00Z', ship_status: 'in_transit', ship_carrier: 'FedEx Freight', ship_ref: '1234', ship_eta: '2026-11-18', from_name: null }], [], [], today)
    expect(r.arrival).toBe('2026-11-18')
    expect(r.day).toBe('2026-11-18')
    expect(r.carrier).toBe('FedEx Freight')
    expect(r.tracking).toBe('1234')
    expect(r.from.kind).toBe('carrier')
    expect(r.from.label).toBe('FedEx Freight says Nov 18, in transit')
    expect(r.from.to).toBe('/mail/t1')
    expect(r.late).toBe(false)
  })
  it('falls back to the vendor form, then the order, for the ship date', () => {
    const r = incomingRow(order(), [], [{ request_id: 'q1', answered_at: '2026-11-11T00:00:00Z', ready_date: '2026-11-15', carrier: 'UPS Ground' }], [], today)
    expect(r.arrival).toBeNull()
    expect(r.ship_date).toBe('2026-11-15')
    expect(r.day).toBe('2026-11-15')
    expect(r.carrier).toBe('UPS Ground')
    expect(r.from.kind).toBe('form')
    const o = incomingRow(order(), [], [], [], today)
    expect(o.day).toBe('2026-11-20')
    expect(o.from.label).toBe('expected to ship Nov 20 (the order)')
  })
  it('is late when the day has passed and nothing was delivered', () => {
    const r = incomingRow(order({ est_ship_date: '2026-11-01' }), [], [], [], today)
    expect(r.late).toBe(true)
    const d = incomingRow(order({ est_ship_date: '2026-11-01' }), [{ id: 'e1', thread_id: 't1', received_at: '2026-11-05T10:00:00Z', ship_status: 'delivered', ship_carrier: 'UPS', ship_ref: null, ship_eta: null, from_name: null }], [], [], today)
    expect(d.delivered).toBe(true)
    expect(d.arrival).toBe('2026-11-05')
    expect(d.late).toBe(false)
  })
  it("prefers the carrier's delivery receipt", () => {
    const r = incomingRow(order(), [{ id: 'e1', thread_id: 't1', received_at: '2026-11-12T10:00:00Z', ship_status: 'in_transit', ship_carrier: 'Estes', ship_ref: 'PRO9', ship_eta: '2026-11-18', from_name: null }], [], [{ id: 'd1', delivered_on: '2026-11-12', pro_number: 'PRO9', signed_by: 'Trevor' }], today)
    expect(r.delivered).toBe(true)
    expect(r.from.label).toBe("delivered Nov 12, signed by Trevor (the carrier's receipt)")
  })
})

describe('fmt', () => {
  it('adds the year only when it is another year', () => {
    expect(fmt('2026-11-18', new Date(2026, 10, 13))).toBe('Nov 18')
    expect(fmt('2026-02-09', new Date(2027, 0, 5))).toBe('Feb 9, 2026')
  })
})

describe('inWindow and sortIncoming', () => {
  const rows = [
    incomingRow(order({ id: 'a', est_ship_date: '2026-11-25' }), [], [], [], today),
    incomingRow(order({ id: 'b', est_ship_date: null, order_date: '2026-11-12' }), [], [], [], today),
    incomingRow(order({ id: 'c', est_ship_date: '2026-11-14' }), [], [], [], today),
  ]
  it('keeps only the rows inside the window', () => {
    expect(inWindow(rows, '2026-11-13', '2026-11-20').map((r) => r.order.id)).toEqual(['c'])
    expect(inWindow(rows, null, null)).toHaveLength(3)
  })
  it('sorts soonest first with the undated last', () => {
    expect(sortIncoming(rows).map((r) => r.order.id)).toEqual(['c', 'a', 'b'])
  })
})
