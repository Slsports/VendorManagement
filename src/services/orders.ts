import { supabase } from '@/lib/supabase'
import type { Order, OrderStatus, OrderStatusHistory, TablesInsert, TablesUpdate, Vendor, VendorLink } from '@/types'

export interface OrderRow extends Order {
  vendor: Pick<Vendor, 'id' | 'name'> | null
}

export interface OrderFilters {
  status?: OrderStatus
  vendorId?: string
  search?: string
  season?: 'summer' | 'winter'
  limit?: number
}

/** Orders for the list page, newest first. */
export async function listOrders(organizationId: string, f: OrderFilters = {}): Promise<OrderRow[]> {
  let q = supabase.from('orders').select('*, vendor:vendors(id, name)').eq('organization_id', organizationId)
  if (f.status) q = q.eq('status', f.status)
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
  vendor: Pick<Vendor, 'id' | 'name' | 'free_shipping_policy' | 'free_shipping_threshold' | 'freight_program' | 'freight_routing'> | null
  order_status_history: OrderStatusHistory[]
  documents: VendorLink[]
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const [{ data, error }, { data: docs, error: e2 }] = await Promise.all([
    supabase.from('orders').select('*, vendor:vendors(id, name, free_shipping_policy, free_shipping_threshold, freight_program, freight_routing), order_status_history(*)').eq('id', id).single(),
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
