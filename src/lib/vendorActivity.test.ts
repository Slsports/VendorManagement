import { describe, expect, it } from 'vitest'
import { buildFeed, docItem, emailItem, orderItems, statusItem, taskItem } from './vendorActivity'

const doc = { id: 'd1', kind: 'invoice', label: 'Invoice 184482', file_name: 'x.pdf', doc_number: '184482', doc_date: '2026-01-28', doc_total: 10606.6, received_at: '2026-02-01', created_at: '2026-10-20T10:00:00Z', source: 'email', storage_path: 'a/b.pdf', mime_type: 'application/pdf', po_number: 'BECKER-1-13-26' }

describe('vendor activity feed', () => {
  it('says who wrote and about what, and opens the email', () => {
    const e = emailItem({ email_id: 'e1', thread_id: 't1', received_at: '2026-11-02T21:04:09Z', direction: 'in', line: null, subject: 'RE: Routing request for PO# BECKER2926', from_name: 'Steve Bahr', from_email: 'steve@beckerglove.com' })
    expect(e.text).toBe('Steve Bahr wrote about Routing request for PO# BECKER2926')
    expect(e.to).toBe('/mail/t1?email=e1')
    const sent = { email_id: 'e2', thread_id: 't1', received_at: '2026-11-02T21:05:00Z', direction: 'out' as const, line: null, subject: 'Re: shipping', from_name: 'Dana Powell', from_email: 'dana@x.com' }
    expect(emailItem(sent).text).toBe('Dana sent an email about shipping')
    expect(emailItem({ ...sent, line: 'Dana asked Steve when it ships.' }).text).toBe('Dana asked Steve when it ships.')
  })

  it('names the invoice, its PO and amount, dated by the invoice', () => {
    const d = docItem(doc)!
    expect(d.text).toBe('Received invoice 184482 for PO BECKER-1-13-26 ($10,606.60)')
    expect(d.at).toBe('2026-01-28')
    expect(d.doc?.storage_path).toBe('a/b.pdf')
    expect(docItem({ ...doc, kind: 'image' })).toBeNull()
    expect(docItem({ ...doc, kind: 'price_list', doc_number: null, po_number: null, source: 'upload', file_name: '2026 Price List.pdf' })!.text).toBe('Filed price list: 2026 Price List.pdf')
    // our order taken from our own sent email: sent, never "received" (Dana, Nov 12)
    expect(docItem({ ...doc, kind: 'order', doc_number: null, po_number: 'SLIPPERYRACER11-10-26', source: 'email' })!.text).toBe('Sent our order for PO SLIPPERYRACER11-10-26')
  })

  it('order moves and closed tasks', () => {
    expect(statusItem({ id: 's1', order_id: 'o1', po_number: 'BECKER2926', from_status: 'confirmed', to_status: 'shipped', changed_at: '2026-11-03T23:00:00Z', who: 'Dana Powell' })!.text).toBe('PO BECKER2926 moved to Shipped (Dana)')
    // received, entered and paid come from the order's own dates, not twice
    expect(statusItem({ id: 's2', order_id: 'o1', po_number: 'X', from_status: 'received', to_status: 'entered', changed_at: '2026-11-03T23:00:00Z', who: null })).toBeNull()
    const o = orderItems({ id: 'o1', po_number: 'BECKER-1-13-26', order_date: '2026-01-13', placed_by: 'Dana', date_received: '2026-02-02', date_entered_ls: '2026-02-03', entered_by: 'Jarrett', paid_date: '2026-03-01' })
    expect(o.map((x) => [x.at, x.text])).toEqual([
      ['2026-01-13', 'Dana placed order PO BECKER-1-13-26'],
      ['2026-02-02', 'Received order PO BECKER-1-13-26'],
      ['2026-02-03', 'PO BECKER-1-13-26 entered to LS by Jarrett'],
      ['2026-03-01', 'Paid PO BECKER-1-13-26'],
    ])
    expect(o[0]!.to).toBe('/orders/o1')
    expect(taskItem({ id: 't1', title: 'Check rep', done_at: '2026-11-03T10:00:00Z', done_note: null, closed_how: 'vms', who: null }).text).toBe('VMS closed the task "Check rep"')
    expect(taskItem({ id: 't1', title: 'Check rep', done_at: '2026-11-03T10:00:00Z', done_note: null, closed_how: 'person', who: 'Jarrett Smith' }).text).toBe('Jarrett finished the task "Check rep"')
  })

  it('puts everything newest first', () => {
    const feed = buildFeed({
      emails: [{ email_id: 'e1', thread_id: 't1', received_at: '2026-11-02T21:04:09Z', direction: 'in', line: 'Steve booked the pickup.', subject: null, from_name: null, from_email: null }],
      docs: [doc],
      orders: [],
      statuses: [{ id: 's1', order_id: 'o1', po_number: 'BECKER2926', from_status: 'confirmed', to_status: 'shipped', changed_at: '2026-11-03T23:00:00Z', who: null }],
      tasks: [], notes: [{ id: 'n1', body: 'Called Steve', created_at: '2026-03-01T10:00:00Z', who: 'Dana' }],
    }, 10)
    expect(feed.map((f) => f.key)).toEqual(['s:s1', 'e:e1', 'n:n1', 'd:d1'])
    expect(buildFeed({ emails: [], docs: [doc, { ...doc, id: 'd2' }], orders: [], statuses: [], tasks: [], notes: [] }, 1)).toHaveLength(1)
  })
})
