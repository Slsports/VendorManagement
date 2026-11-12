/**
 * A vendor's Activity feed (Dana, Nov 3): "in chronological order of anything done with this record. If an email came in,
 * date who from and topic. If an invoice arrived, received invoice for PO XYZ and date. If we are talking about shipping
 * and I send an email - Dana sent email regarding shipping and the date. You can click on each one and it will pull up
 * the email or invoice or whatever transpired." Newest first; every line opens its source.
 */
export type FeedEmail = { email_id: string; thread_id: string; received_at: string; direction: 'in' | 'out' | 'internal'; line: string | null; subject: string | null; from_name: string | null; from_email: string | null }
export type FeedDoc = { id: string; kind: string; label: string; file_name: string | null; doc_number: string | null; doc_date: string | null; doc_total: number | null; received_at: string | null; created_at: string; source: string | null; storage_path: string | null; mime_type: string | null; po_number: string | null }
export type FeedStatus = { id: string; order_id: string; po_number: string | null; from_status: string | null; to_status: string; changed_at: string; who: string | null }
/** an order's own dates (Dana, Nov 3: "received order PO XYZ and date"; "Entered to LS by <employee> on <date>") */
export type FeedOrder = { id: string; po_number: string | null; order_date: string | null; placed_by: string | null; date_received: string | null; date_entered_ls: string | null; entered_by: string | null; paid_date: string | null }
export type FeedTask = { id: string; title: string; done_at: string; done_note: string | null; closed_how: string | null; who: string | null }
export type FeedNote = { id: string; body: string; created_at: string; who: string | null }

export type FeedItem = {
  key: string
  at: string
  kind: 'email' | 'document' | 'order' | 'task' | 'note'
  text: string
  /** a page in VMS to open, or a file to show */
  to?: string
  doc?: FeedDoc
}

const DOC_WORD: Record<string, string> = {
  invoice: 'invoice', payment: 'payment', credit: 'credit memo', confirmation: 'order confirmation', order: 'our order',
  ls_po: 'LS PO', price_list: 'price list', catalog: 'catalog', order_form: 'order form', specials: 'show specials',
  packing_slip: 'packing slip', delivery_receipt: 'delivery receipt', freight_bill: 'freight bill', proof: 'proof',
  approved_proof: 'approved proof', damage_photo: 'damage photo', sales_report: 'sales report', inventory_count: 'inventory count',
  policy: 'policy', other: 'file',
}
/** pictures and website links would drown the feed */
const SKIP_DOCS = new Set(['image', 'website'])
const STATUS_WORD: Record<string, string> = {
  open: 'Sent', awaiting_confirmation: 'Placed', confirmed: 'Confirmed', shipped: 'Shipped', received: 'Received',
  entered: 'Entered', ready_to_pay: 'Ready to pay', paid: 'Paid', cancelled: 'Cancelled',
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const firstName = (s: string | null) => (s ?? '').trim().split(/\s+/)[0] || null
/** a date-only value sorts as midday that day */
const sortKey = (at: string) => (/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00` : new Date(at).toISOString())

export function emailItem(e: FeedEmail): FeedItem {
  const topic = e.subject?.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim() || '(no subject)'
  const who = e.direction === 'in' ? (e.from_name || e.from_email || 'They') : (firstName(e.from_name) || 'We')
  const text = e.line?.trim() || (e.direction === 'in' ? `${who} wrote about ${topic}` : `${who} sent an email about ${topic}`)
  return { key: `e:${e.email_id}`, at: e.received_at, kind: 'email', text, to: `/mail/${e.thread_id}?email=${e.email_id}` }
}

export function docItem(d: FeedDoc): FeedItem | null {
  if (SKIP_DOCS.has(d.kind)) return null
  const word = DOC_WORD[d.kind] ?? 'file'
  const paper = ['invoice', 'credit', 'confirmation', 'payment'].includes(d.kind)
  // our own order from our sent email was sent, not received (Dana, Nov 12: "We have no idea if they received it until we
  // receive a response from them … Activity log should only say that I sent it")
  const verb = d.kind === 'order' || d.kind === 'ls_po' ? (d.source === 'email' ? 'Sent' : 'Filed') : d.source === 'email' || paper ? 'Received' : 'Filed'
  const parts = [`${verb} ${word}`]
  if (d.doc_number) parts.push(d.doc_number)
  if (d.po_number) parts.push(`for PO ${d.po_number}`)
  let text = parts.join(' ')
  if (d.doc_total != null && paper) text += ` (${money(d.doc_total)})`
  if (!d.doc_number && !d.po_number) text += `: ${d.file_name || d.label}`
  // an invoice dates from its own date (old history sent later stays in its year); anything else from when it came
  const at = (paper && d.doc_date) || d.received_at || d.created_at
  return { key: `d:${d.id}`, at, kind: 'document', text, doc: d }
}

/** status moves the order's own dates don't cover (confirmed, shipped, cancelled, waiting for confirmation) */
const FROM_HISTORY = new Set(['awaiting_confirmation', 'confirmed', 'shipped', 'cancelled'])

export function statusItem(s: FeedStatus): FeedItem | null {
  if (!FROM_HISTORY.has(s.to_status)) return null
  const po = s.po_number ? `PO ${s.po_number}` : 'An order'
  const text = `${po} moved to ${STATUS_WORD[s.to_status] ?? s.to_status}${s.who ? ` (${firstName(s.who)})` : ''}`
  return { key: `s:${s.id}`, at: s.changed_at, kind: 'order', text, to: `/orders/${s.order_id}` }
}

export function orderItems(o: FeedOrder): FeedItem[] {
  const po = o.po_number ? `PO ${o.po_number}` : 'an order'
  const to = `/orders/${o.id}`
  const out: FeedItem[] = []
  if (o.order_date) out.push({ key: `o:${o.id}:placed`, at: o.order_date, kind: 'order', text: `${o.placed_by ? `${o.placed_by} placed` : 'Placed'} order ${po}`, to })
  if (o.date_received) out.push({ key: `o:${o.id}:received`, at: o.date_received, kind: 'order', text: `Received order ${po}`, to })
  if (o.date_entered_ls) out.push({ key: `o:${o.id}:entered`, at: o.date_entered_ls, kind: 'order', text: `${po[0]!.toUpperCase()}${po.slice(1)} entered to LS${o.entered_by ? ` by ${o.entered_by}` : ''}`, to })
  if (o.paid_date) out.push({ key: `o:${o.id}:paid`, at: o.paid_date, kind: 'order', text: `Paid ${po}`, to })
  return out
}

export function taskItem(t: FeedTask): FeedItem {
  const who = t.closed_how === 'vms' || !t.who ? 'VMS' : firstName(t.who)
  const verb = who === 'VMS' ? 'closed' : 'finished'
  return { key: `t:${t.id}`, at: t.done_at, kind: 'task', text: `${who} ${verb} the task "${t.title}"`, to: `/tasks?task=${t.id}` }
}

export function noteItem(n: FeedNote): FeedItem {
  const body = n.body.replace(/\s+/g, ' ').trim()
  return { key: `n:${n.id}`, at: n.created_at, kind: 'note', text: `${firstName(n.who) ?? 'Someone'} added a note: ${body.length > 90 ? `${body.slice(0, 90)}…` : body}`, to: '#notes' }
}

/** Everything, newest first, the first `limit`. */
export function buildFeed(src: { emails: FeedEmail[]; docs: FeedDoc[]; orders: FeedOrder[]; statuses: FeedStatus[]; tasks: FeedTask[]; notes: FeedNote[] }, limit: number): FeedItem[] {
  const all: FeedItem[] = [
    ...src.emails.map(emailItem),
    ...src.docs.map(docItem).filter((x): x is FeedItem => !!x),
    ...src.orders.flatMap(orderItems),
    ...src.statuses.map(statusItem).filter((x): x is FeedItem => !!x),
    ...src.tasks.map(taskItem),
    ...src.notes.map(noteItem),
  ]
  return all.sort((a, b) => (sortKey(a.at) < sortKey(b.at) ? 1 : sortKey(a.at) > sortKey(b.at) ? -1 : 0)).slice(0, limit)
}
