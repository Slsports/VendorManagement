import { supabase } from '@/lib/supabase'
import { localDay } from '@/lib/tasks'
import { incomingRow, type FormAnswer, type IncomingOrder, type IncomingRow, type Receipt, type ShipEmail } from '@/lib/incomingShipments'
import { shipmentAnswers } from '@/services/shipmentRequests'

const LIVE = ['open', 'awaiting_confirmation', 'confirmed', 'shipped'] as const

/**
 * Every live order (Sent, Placed, Confirmed, Shipped) with what VMS knows about its shipping: the latest carrier or vendor
 * shipping email on it, the vendor's answer to the shipment form, and any delivery receipt. One line per order.
 */
export async function listIncomingShipments(organizationId: string): Promise<IncomingRow[]> {
  const { data: orders, error } = await supabase.from('orders')
    .select('id, po_number, description, status, order_date, est_ship_date, store_codes, vendor:vendors(id, name)')
    .eq('organization_id', organizationId).in('status', [...LIVE]).order('est_ship_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  const rows = (orders ?? []) as unknown as IncomingOrder[]
  const ids = rows.map((o) => o.id)
  if (!ids.length) return []
  const [emails, requests, receipts] = await Promise.all([
    supabase.from('emails').select('id, thread_id, received_at, ship_status, ship_carrier, ship_ref, ship_eta, from_name, order_id').in('order_id', ids).not('ship_status', 'is', null).order('received_at', { ascending: false }),
    supabase.from('shipment_requests').select('id, order_id, answered_at, answers').in('order_id', ids).not('answered_at', 'is', null),
    supabase.from('delivery_receipts').select('id, order_id, delivered_on, pro_number, signed_by').in('order_id', ids),
  ])
  for (const r of [emails, requests, receipts]) if (r.error) throw r.error
  const byOrder = <T extends { order_id: string | null }>(xs: T[] | null) => {
    const m = new Map<string, T[]>()
    for (const x of xs ?? []) if (x.order_id) m.set(x.order_id, [...(m.get(x.order_id) ?? []), x])
    return m
  }
  const emailMap = byOrder(emails.data as (ShipEmail & { order_id: string | null })[] | null)
  const answerMap = byOrder((requests.data ?? []).map((r) => { const a = shipmentAnswers(r); return { request_id: r.id, order_id: r.order_id, answered_at: r.answered_at, ready_date: a.ready_date || null, carrier: a.carrier || null } as FormAnswer & { order_id: string | null } }))
  const receiptMap = byOrder(receipts.data as (Receipt & { order_id: string | null })[] | null)
  const today = localDay(new Date())
  return rows.map((o) => incomingRow(o, emailMap.get(o.id) ?? [], answerMap.get(o.id) ?? [], receiptMap.get(o.id) ?? [], today))
}
