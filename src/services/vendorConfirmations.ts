import { supabase } from '@/lib/supabase'
import type { VendorConfirmation } from '@/types'

// Vendors confirming their own info (Dana, Oct 13).

export type ConfirmState = 'confirmed' | 'waiting' | 'no_answer' | 'bad_email' | 'not_asked'
export const CONFIRM_STATE_LABELS: Record<ConfirmState, string> = { confirmed: 'Confirmed', waiting: 'Waiting', no_answer: 'No answer', bad_email: 'Bad email', not_asked: 'Not asked yet' }

export type ConfirmationRow = VendorConfirmation & { vendor: { id: string; name: string } | null }

export async function listConfirmations(organizationId: string, vendorId?: string): Promise<ConfirmationRow[]> {
  let q = supabase.from('vendor_confirmations').select('*, vendor:vendors!vendor_confirmations_vendor_id_fkey(id, name)').eq('organization_id', organizationId)
  if (vendorId) q = q.eq('vendor_id', vendorId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(3000)
  if (error) throw error
  return (data ?? []) as unknown as ConfirmationRow[]
}

export async function confirmStates(organizationId: string): Promise<Map<string, ConfirmState>> {
  const { data, error } = await supabase.rpc('vendor_confirm_states', { p_org: organizationId })
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.vendor_id, r.state as ConfirmState]))
}

/** Emails to every contact at vendors we buy from (or one vendor), in Mail › Drafts. Returns how many. */
export async function prepareConfirmations(organizationId: string, vendorId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('vendor_confirm_prepare', { p_org: organizationId, p_vendor: vendorId ?? null })
  if (error) throw error
  return data as number
}

export async function saveConfirmEmail(organizationId: string, subject: string, body: string): Promise<void> {
  const { error } = await supabase.from('organizations').update({ confirm_email_subject: subject, confirm_email_body: body }).eq('id', organizationId)
  if (error) throw error
}

export async function listVendorSells(vendorId: string): Promise<{ id: string; category: string; source: string; confirmed_at: string | null }[]> {
  const { data, error } = await supabase.from('vendor_sells').select('id, category, source, confirmed_at').eq('vendor_id', vendorId).order('category')
  if (error) throw error
  return data ?? []
}
