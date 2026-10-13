import { supabase } from '@/lib/supabase'
import type { FreightQuote } from '@/types'

// Freight quotes (Dana, Oct 13): a vendor's freight quote on an order, our Priority One and WWEX prices, the one approved.

export type FreightQuoteRow = FreightQuote & {
  vendor: { id: string; name: string } | null
  order: { id: string; po_number: string | null; order_date: string | null; est_cost: number | null; status: string } | null
  email: { id: string; subject: string | null; received_at: string; from_name: string | null; from_email: string | null } | null
  approver: { full_name: string } | null
}

export interface QuoteDetails {
  ship_from?: string | null; ship_from_zip?: string | null; pickup_type?: string | null; ready_date?: string | null; pickup_hours?: string | null; contact?: string | null
  cartons?: { count: number; length: number | null; width: number | null; height: number | null; weight: number | null }[]
  pallets?: { count: number; length: number | null; width: number | null; height: number | null; weight: number | null; freight_class: string | null; stackable: boolean | null }[]
  total_weight?: number | null; value?: number | null; hazardous?: boolean | null; notes?: string | null
}

const SELECT = '*, vendor:vendors!freight_quotes_vendor_id_fkey(id, name), order:orders!freight_quotes_order_id_fkey(id, po_number, order_date, est_cost, status), email:emails!freight_quotes_email_id_fkey(id, subject, received_at, from_name, from_email), approver:profiles!freight_quotes_approved_by_fkey(full_name)'

export type QuoteFilter = 'waiting' | 'needs_order' | 'approved' | 'all'

export async function listFreightQuotes(organizationId: string, filter: QuoteFilter): Promise<FreightQuoteRow[]> {
  let q = supabase.from('freight_quotes').select(SELECT).eq('organization_id', organizationId)
  if (filter !== 'all') q = q.eq('status', filter)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  return (data ?? []) as unknown as FreightQuoteRow[]
}

export async function getFreightQuote(id: string): Promise<FreightQuoteRow> {
  const { data, error } = await supabase.from('freight_quotes').select(SELECT).eq('id', id).single()
  if (error) throw error
  return data as unknown as FreightQuoteRow
}

/** Freight quotes on one order, newest first. */
export async function listOrderFreightQuotes(orderId: string): Promise<FreightQuoteRow[]> {
  const { data, error } = await supabase.from('freight_quotes').select(SELECT).eq('order_id', orderId).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as FreightQuoteRow[]
}

export async function countWaitingFreightQuotes(organizationId: string): Promise<number> {
  const { count, error } = await supabase.from('freight_quotes').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).in('status', ['waiting', 'needs_order'])
  if (error) throw error
  return count ?? 0
}

export async function freightQuoteAction(id: string, action: 'set_order' | 'ours' | 'approve' | 'decline' | 'reopen', opts: { order?: string | null; priorityOne?: number | null; wwex?: number | null; note?: string | null; choice?: string | null; cost?: number | null } = {}): Promise<void> {
  const { error } = await supabase.rpc('freight_quote_action', {
    p_quote: id, p_action: action, p_order: opts.order ?? null, p_priority_one: opts.priorityOne ?? null, p_wwex: opts.wwex ?? null,
    p_note: opts.note ?? null, p_choice: opts.choice ?? null, p_cost: opts.cost ?? null,
  })
  if (error) throw error
}

export async function listUnapprovedShipments(organizationId: string) {
  const { data, error } = await supabase.rpc('freight_unapproved_shipments', { p_org: organizationId })
  if (error) throw error
  return data ?? []
}
