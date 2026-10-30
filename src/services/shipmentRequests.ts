import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { ShipmentRequest } from '@/types'

export type ShipmentRequestRow = ShipmentRequest & {
  vendor: { id: string; name: string } | null
  order: { id: string; po_number: string | null; description: string | null; status: string; freight_terms: string | null; free_shipping: boolean | null; freight_cap_pct: number | null } | null
  sender: { full_name: string | null } | null
}
const SELECT = '*, vendor:vendors!shipment_requests_vendor_id_fkey(id, name), order:orders!shipment_requests_order_id_fkey(id, po_number, description, status, freight_terms, free_shipping, freight_cap_pct), sender:profiles!shipment_requests_send_as_fkey(full_name)'

export type ShipmentFilter = 'waiting' | 'answered' | 'all'
const WAITING: ShipmentRequest['status'][] = ['ready', 'sent', 'opened']
const ANSWERED: ShipmentRequest['status'][] = ['answered', 'confirmed', 'disputed']

/** The shipment details emails (Dana, Oct 30): waiting on the vendor, answered, or everything. */
export async function listShipmentRequests(organizationId: string, filter: ShipmentFilter): Promise<ShipmentRequestRow[]> {
  let q = supabase.from('shipment_requests').select(SELECT).eq('organization_id', organizationId)
  if (filter === 'waiting') q = q.in('status', WAITING)
  else if (filter === 'answered') q = q.in('status', ANSWERED)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  return (data ?? []) as unknown as ShipmentRequestRow[]
}

export async function listVendorShipmentRequests(vendorId: string): Promise<ShipmentRequestRow[]> {
  const { data, error } = await supabase.from('shipment_requests').select(SELECT).eq('vendor_id', vendorId).neq('status', 'skipped').order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  return (data ?? []) as unknown as ShipmentRequestRow[]
}

export async function getOrderShipmentRequest(orderId: string): Promise<ShipmentRequestRow | null> {
  const { data, error } = await supabase.from('shipment_requests').select(SELECT).eq('order_id', orderId).maybeSingle()
  if (error) throw error
  return (data as unknown as ShipmentRequestRow | null) ?? null
}

export async function countWaitingShipmentRequests(organizationId: string): Promise<{ waiting: number; overdue: number }> {
  const { data, error } = await supabase.from('shipment_requests').select('id, followup_due_at, status').eq('organization_id', organizationId).in('status', WAITING)
  if (error) throw error
  const now = new Date().toISOString()
  return { waiting: (data ?? []).length, overdue: (data ?? []).filter((r) => r.status !== 'ready' && r.followup_due_at && r.followup_due_at < now).length }
}

/** Send one now (a held one from the backfill, or one that waited for an email address). */
export async function sendShipmentRequestNow(id: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('shipment-requests', { body: { action: 'send', id } })
  if (error) throw await functionError(error)
  if (data?.error) throw new Error(data.error)
}

export async function cancelShipmentRequest(id: string, note: string): Promise<void> {
  const { error } = await supabase.from('shipment_requests').update({ status: 'cancelled', note, followup_due_at: null }).eq('id', id)
  if (error) throw error
}

/** The answers as the form stored them. */
export interface ShipmentItem { count: number; weight: number | null; length: number | null; width: number | null; height: number | null; freight_class?: string; nmfc?: string; stackable?: boolean; hazmat?: boolean; large?: boolean; additional_handling?: boolean; description?: string }
export interface ShipmentAnswers { company?: string; address?: string; city?: string; state?: string; zip?: string; contact_name?: string; contact_email?: string; contact_phone?: string; hours?: string; ready_date?: string; services?: string[]; items?: ShipmentItem[]; quote_amount?: string | number; carrier?: string; notes?: string }
export function shipmentAnswers(r: Pick<ShipmentRequest, 'answers'>): ShipmentAnswers {
  return (r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers) ? r.answers : {}) as ShipmentAnswers
}
