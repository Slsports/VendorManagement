import { supabase } from '@/lib/supabase'
import type { SupplyRequest } from '@/types'

// Supplies (Dana, Oct 12): staff supply requests, from the email asking for them to the order and its arrival.

export type SupplyStatus = SupplyRequest['status']
export type SupplyView = 'requested' | 'ordered' | 'arrived' | 'all'

export async function listSupplies(organizationId: string, view: SupplyView): Promise<SupplyRequest[]> {
  let q = supabase.from('supply_requests').select('*').eq('organization_id', organizationId)
  if (view !== 'all') q = q.eq('status', view)
  const { data, error } = await q.order('requested_at', { ascending: false }).limit(500)
  if (error) throw error
  return data ?? []
}

export async function countSupplies(organizationId: string): Promise<Record<SupplyStatus, number>> {
  const { data, error } = await supabase.from('supply_requests').select('status').eq('organization_id', organizationId).limit(5000)
  if (error) throw error
  const out: Record<SupplyStatus, number> = { requested: 0, ordered: 0, arrived: 0, closed: 0 }
  for (const r of data ?? []) out[r.status as SupplyStatus]++
  return out
}

export async function addSupply(organizationId: string, summary: string, requester: string | null, store: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('supply_add', { p_org: organizationId, p_summary: summary, p_requester: requester, p_store: store })
  if (error) throw error
  return data as string
}

export async function setSupply(id: string, status: SupplyStatus, ordered?: { from: string | null; order: string | null; expected: string | null }): Promise<void> {
  const { error } = await supabase.rpc('supply_set', { p_request: id, p_status: status, p_from: ordered?.from ?? null, p_order: ordered?.order ?? null, p_expected: ordered?.expected ?? null })
  if (error) throw error
}
