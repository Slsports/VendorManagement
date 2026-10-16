import { supabase } from '@/lib/supabase'
import type { AddOnLine, AddOnOrder } from '@/lib/addOns'
import type { Json } from '@/types/database'

// Add-ons to open orders (Dana, Oct 16): which open orders a vendor has, their add-on choice, and putting lines on one.

/** The vendor's orders that have not shipped, newest first, with the add-on choice and ship date. */
export async function openOrdersForVendor(vendorId: string): Promise<AddOnOrder[]> {
  const { data, error } = await supabase.from('orders').select('id, po_number, order_date, est_ship_date, status, addons, description')
    .eq('vendor_id', vendorId).in('status', ['open', 'awaiting_confirmation', 'confirmed']).order('order_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as AddOnOrder[]
}

/** Add-on lines onto the order (marked with today; a confirmed order goes back to awaiting confirmation). */
export async function addLinesToOrder(orderId: string, lines: AddOnLine[]): Promise<number> {
  const { data, error } = await supabase.rpc('order_add_lines', { p_order: orderId, p_lines: lines as unknown as Json })
  if (error) throw error
  return data ?? 0
}

export async function setOrderAddons(orderId: string, addons: 'yes' | 'no' | 'ask' | null, asked = false) {
  const { error } = await supabase.from('orders').update({ addons, ...(asked ? { addons_asked_at: new Date().toISOString() } : {}) }).eq('id', orderId)
  if (error) throw error
}

/** The order's paper to attach: the current confirmation on file, else our own order sheet; and the original lines. */
export async function orderPapers(orderId: string): Promise<{ confirmation: { id: string; file_name: string | null } | null; orderSheet: { id: string; file_name: string | null } | null; originalLines: AddOnLine[] }> {
  const [{ data: links, error }, { data: lines, error: lerr }] = await Promise.all([
    supabase.from('vendor_links').select('id, kind, file_name, is_current, created_at').eq('order_id', orderId).in('kind', ['confirmation', 'order']).not('storage_path', 'is', null).order('created_at', { ascending: false }),
    supabase.from('order_lines').select('vendor_item_id, description, quantity, unit_cost, added_on').eq('order_id', orderId).order('sort_order'),
  ])
  if (error) throw error
  if (lerr) throw lerr
  const pick = (kind: string) => (links ?? []).find((l) => l.kind === kind && l.is_current !== false) ?? (links ?? []).find((l) => l.kind === kind) ?? null
  const c = pick('confirmation'), o = pick('order')
  return {
    confirmation: c ? { id: c.id, file_name: c.file_name } : null,
    orderSheet: o ? { id: o.id, file_name: o.file_name } : null,
    originalLines: (lines ?? []).filter((l) => !l.added_on).map((l) => ({ vendor_item_id: l.vendor_item_id, description: l.description ?? '', quantity: Number(l.quantity), unit_cost: l.unit_cost == null ? null : Number(l.unit_cost) })),
  }
}

/** Where the vendor takes orders: the addresses with an orders role first, then the rest. */
export async function vendorOrderAddresses(vendorId: string): Promise<string[]> {
  const { data, error } = await supabase.from('vendor_emails').select('email, roles, contact_type').eq('vendor_id', vendorId)
  if (error) throw error
  const rows = (data ?? []) as { email: string; roles: string[] | null; contact_type: string | null }[]
  const orders = rows.filter((r) => (r.roles ?? []).some((x) => /order/i.test(x)) || /order/i.test(r.contact_type ?? ''))
  return [...new Set((orders.length ? orders : rows).map((r) => r.email.trim().toLowerCase()).filter(Boolean))]
}
