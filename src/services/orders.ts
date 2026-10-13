import { supabase } from '@/lib/supabase'
import type { Order, OrderLine, OrderStatus, OrderStatusHistory, TablesInsert, TablesUpdate, Vendor, VendorLink } from '@/types'

export interface OrderRow extends Order {
  vendor: (Pick<Vendor, 'id' | 'name'> & { assigned_buyer_id?: string | null }) | null
}

// The dashboard's number boxes (Dana, Oct 11: "each box show a count and when we open it we see all the items").
export type OrderView = 'open' | 'overdue' | 'future' | 'payments_due'
const OPEN_STATUSES: OrderStatus[] = ['open', 'awaiting_confirmation', 'confirmed', 'shipped']
export const ORDER_VIEW_LABELS: Record<OrderView, { title: string; help: string }> = {
  open: { title: 'Open orders', help: 'Placed, not yet received.' },
  overdue: { title: 'Overdue orders', help: 'Not received and more than 30 days past their ship date.' },
  future: { title: 'Future-dated orders', help: 'Pre-bookings shipping more than 30 days from now.' },
  payments_due: { title: 'Payments due', help: 'Entered in LS, not yet paid.' },
}
const daysFromToday = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function applyView<Q extends { in: (c: string, v: string[]) => Q; lt: (c: string, v: string) => Q; gt: (c: string, v: string) => Q }>(q: Q, view: OrderView): Q {
  if (view === 'open') return q.in('status', OPEN_STATUSES)
  if (view === 'overdue') return q.in('status', OPEN_STATUSES).lt('est_ship_date', daysFromToday(-30))
  if (view === 'future') return q.in('status', ['open', 'awaiting_confirmation', 'confirmed']).gt('est_ship_date', daysFromToday(30))
  return q.in('status', ['entered', 'ready_to_pay'])
}

/** The count behind one number box. */
export async function countOrderView(organizationId: string, view: OrderView): Promise<number> {
  const { count, error } = await applyView(supabase.from('orders').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId), view)
  if (error) throw error
  return count ?? 0
}

export interface OrderFilters {
  view?: OrderView
  status?: OrderStatus
  vendorId?: string
  search?: string
  season?: 'summer' | 'winter'
  limit?: number
}

/** Orders for the list page, newest first. */
export async function listOrders(organizationId: string, f: OrderFilters = {}): Promise<OrderRow[]> {
  let q = supabase.from('orders').select('*, vendor:vendors(id, name, assigned_buyer_id)').eq('organization_id', organizationId)
  if (f.status) q = q.eq('status', f.status)
  if (f.view) q = applyView(q, f.view)
  if (f.vendorId) q = q.eq('vendor_id', f.vendorId)
  if (f.season) q = q.eq('season', f.season)
  if (f.search) q = q.or(`description.ilike.%${f.search.replaceAll(',', ' ')}%,po_number.ilike.%${f.search.replaceAll(',', ' ')}%`)
  const { data, error } = await q.order('order_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(f.limit ?? 2000).returns<OrderRow[]>()
  if (error) throw error
  return data ?? []
}

export async function countOrdersByStatus(organizationId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('orders').select('status').eq('organization_id', organizationId)
  if (error) throw error
  const out: Record<string, number> = {}
  for (const r of data ?? []) out[r.status] = (out[r.status] ?? 0) + 1
  return out
}

/** A vendor's orders, newest first, with a few totals for the vendor page. */
export interface VendorOrderSummary {
  orders: Order[]
  count: number
  lastOrderDate: string | null
  totalSpend: number
  seasons: { summer: number; winter: number }
  shows: string[]
}

export async function vendorOrderSummary(vendorId: string): Promise<VendorOrderSummary> {
  const { data, error } = await supabase.from('orders').select('*').eq('vendor_id', vendorId).order('order_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  const orders = data ?? []
  const seasons = { summer: 0, winter: 0 }
  for (const o of orders) if (o.season) seasons[o.season]++
  return {
    orders,
    count: orders.length,
    lastOrderDate: orders.find((o) => o.order_date)?.order_date ?? null,
    totalSpend: orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + (o.final_cost ?? o.est_cost ?? 0), 0),
    seasons,
    shows: [...new Set(orders.map((o) => o.show_code).filter((c): c is string => !!c))].sort().reverse(),
  }
}

export interface OrderDetail extends Omit<OrderRow, 'vendor'> {
  vendor: (Pick<Vendor, 'id' | 'name' | 'free_shipping_policy' | 'free_shipping_threshold' | 'freight_program' | 'freight_routing' | 'wwd_zero_upcharge' | 'freight_allowance_on_time' | 'vid_in_description' | 'web_orders'> & { vendor_billing_routes: { route: string }[] }) | null
  order_status_history: OrderStatusHistory[]
  documents: VendorLink[]
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const [{ data, error }, { data: docs, error: e2 }] = await Promise.all([
    supabase.from('orders').select('*, vendor:vendors(id, name, free_shipping_policy, free_shipping_threshold, freight_program, freight_routing, wwd_zero_upcharge, freight_allowance_on_time, vid_in_description, web_orders, vendor_billing_routes(route, pay_method)), order_status_history(*)').eq('id', id).single(),
    supabase.from('vendor_links').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ])
  if (error) throw error
  if (e2) throw e2
  const row = data as unknown as Omit<OrderRow, 'vendor'> & { vendor: OrderDetail['vendor']; order_status_history: OrderStatusHistory[] }
  return { ...row, order_status_history: (row.order_status_history ?? []).sort((a, b) => a.changed_at.localeCompare(b.changed_at)), documents: docs ?? [] }
}

export async function updateOrder(id: string, changes: TablesUpdate<'orders'>): Promise<Order> {
  const { data, error } = await supabase.from('orders').update(changes).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function createOrder(input: TablesInsert<'orders'>): Promise<Order> {
  const { data, error } = await supabase.from('orders').insert(input).select('*').single()
  if (error) throw error
  return data
}

// ---- order lines and check-in pricing --------------------------------------------------
export async function listOrderLines(orderId: string): Promise<OrderLine[]> {
  const { data, error } = await supabase.from('order_lines').select('*').eq('order_id', orderId).order('sort_order').order('created_at')
  if (error) throw error
  return data ?? []
}

export async function addOrderLines(rows: TablesInsert<'order_lines'>[]): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase.from('order_lines').insert(rows)
  if (error) throw error
}

export async function updateOrderLine(id: string, changes: TablesUpdate<'order_lines'>): Promise<void> {
  const { error } = await supabase.from('order_lines').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteOrderLine(id: string): Promise<void> {
  const { error } = await supabase.from('order_lines').delete().eq('id', id)
  if (error) throw error
}

/** Move an order to its real vendor (a Worldwide Warehouse order once the invoice names it); files and mail go along. */
export async function moveOrderVendor(orderId: string, vendorId: string): Promise<void> {
  const { error } = await supabase.rpc('move_order_vendor', { p_order: orderId, p_vendor: vendorId })
  if (error) throw error
}

/** A freight rate quoted in mail about this vendor since the order (Worldwide's pallet rate), newest first. */
export async function quotedFreightRate(vendorId: string, since: string | null): Promise<{ pct: number; subject: string | null; received_at: string; thread_id: string } | null> {
  const [tagged, filed] = await Promise.all([
    supabase.from('email_vendor_tags').select('emails!inner(freight_pct, subject, received_at, thread_id)').eq('vendor_id', vendorId).not('emails.freight_pct', 'is', null).limit(20),
    supabase.from('emails').select('freight_pct, subject, received_at, thread_id').eq('vendor_id', vendorId).not('freight_pct', 'is', null).limit(20),
  ])
  if (tagged.error) throw tagged.error
  if (filed.error) throw filed.error
  type Hit = { freight_pct: number; subject: string | null; received_at: string; thread_id: string }
  const hits: Hit[] = [...((tagged.data ?? []) as unknown as { emails: Hit }[]).map((r) => r.emails), ...((filed.data ?? []) as unknown as Hit[])]
    .filter((h) => !since || h.received_at.slice(0, 10) >= since)
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
  const h = hits[0]
  return h ? { pct: Number(h.freight_pct), subject: h.subject, received_at: h.received_at, thread_id: h.thread_id } : null
}

