import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { OrderCheck, VendorLink } from '@/types'

// Order paperwork checks (Dana, Oct 10): confirmation vs our order, invoice vs the final confirmation.

export interface CheckRow { what: string; ours: string | null; theirs: string | null; ok: boolean; note: string | null }

export type OrderCheckRow = OrderCheck & {
  vendor: { id: string; name: string } | null
  order: { id: string; po_number: string | null; order_date: string | null; description: string | null; est_cost: number | null; status: string } | null
  document: { id: string; label: string; file_name: string | null; storage_path: string | null; mime_type: string | null; url: string | null } | null
  assignee: { full_name: string } | null
  email: { id: string; thread_id: string } | null
}

const SELECT = '*, vendor:vendors!order_checks_vendor_id_fkey(id, name), order:orders!order_checks_order_id_fkey(id, po_number, order_date, description, est_cost, status), document:vendor_links!order_checks_document_id_fkey(id, label, file_name, storage_path, mime_type, url), assignee:profiles!order_checks_assigned_to_fkey(full_name), email:emails!order_checks_email_id_fkey(id, thread_id)'

/** Waiting on a person (to review, pick the order, or a failed read): one person's, or everyone's. Oldest first. */
export async function listOpenChecks(organizationId: string, profileId: string | null): Promise<OrderCheckRow[]> {
  let q = supabase.from('order_checks').select(SELECT).eq('organization_id', organizationId).in('status', ['to_review', 'needs_order', 'failed'])
  if (profileId) q = q.eq('assigned_to', profileId)
  const { data, error } = await q.order('created_at').limit(100)
  if (error) throw error
  return (data ?? []) as unknown as OrderCheckRow[]
}

/** Still with Claude (reading or comparing): shown so nobody wonders where a document went. */
export async function countChecksInProgress(organizationId: string): Promise<number> {
  const { count, error } = await supabase.from('order_checks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).in('status', ['reading', 'comparing'])
  if (error) throw error
  return count ?? 0
}

export async function listOrderChecks(orderId: string): Promise<OrderCheckRow[]> {
  const { data, error } = await supabase.from('order_checks').select(SELECT).eq('order_id', orderId).not('status', 'in', '(not_paperwork,dismissed)').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as OrderCheckRow[]
}

export async function getOrderCheck(id: string): Promise<OrderCheckRow> {
  const { data, error } = await supabase.from('order_checks').select(SELECT).eq('id', id).single()
  if (error) throw error
  return data as unknown as OrderCheckRow
}

export type CheckAction = 'set_order' | 'assign' | 'done' | 'sent' | 'recheck' | 'dismiss' | 'reopen'

export async function orderCheckAction(checkId: string, action: CheckAction, opts: { order?: string | null; profile?: string | null; thread?: string | null } = {}): Promise<void> {
  const { error } = await supabase.rpc('order_check_action', { p_check: checkId, p_action: action, p_order: opts.order ?? null, p_profile: opts.profile ?? null, p_thread: opts.thread ?? null })
  if (error) throw error
}

/** Ask Claude to read and compare now (one check, or the next waiting). Takes a minute; the scheduler also runs it. */
export async function runOrderChecks(checkId?: string): Promise<void> {
  const { error } = await supabase.functions.invoke('order-check', { body: checkId ? { check_id: checkId } : {} })
  if (error) throw await functionError(error)
}

/** Start it and do not wait: the page refreshes when it is done. */
export function kickOrderChecks(checkId?: string): void {
  void runOrderChecks(checkId).catch((err) => console.warn('order-check:', err))
}

export const checkRows = (c: Pick<OrderCheck, 'rows'>): CheckRow[] => (Array.isArray(c.rows) ? (c.rows as unknown as CheckRow[]) : [])
export const checkIssues = (c: Pick<OrderCheck, 'issues'>): string[] => (Array.isArray(c.issues) ? (c.issues as unknown as string[]) : [])

/** The documents a check was compared against. */
export async function listCheckDocuments(ids: string[]): Promise<VendorLink[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('vendor_links').select('*').in('id', ids)
  if (error) throw error
  return data ?? []
}
