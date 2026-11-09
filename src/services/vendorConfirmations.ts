import { supabase } from '@/lib/supabase'
import { buyCategories, wwdLines, type BuyCategory, type WwdLine } from '@/lib/vendorSells'
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

/**
 * What a vendor sells, from both sides (Dana, Nov 6): our LS categories for their items, and Worldwide's Product Lines from
 * the portal. Each list in its own system's words; no matching between them ("I'd rather see too much than not enough").
 */
export async function vendorSellsFromSources(vendorId: string): Promise<{ ls: BuyCategory[]; lsMatched: boolean; wwd: WwdLine[] }> {
  const [{ data: v, error }, { data: portal, error: e2 }] = await Promise.all([
    supabase.from('vendors').select('lightspeed_vendor_id').eq('id', vendorId).maybeSingle(),
    supabase.from('wwd_portal_vendors').select('number, data').eq('vendor_id', vendorId),
  ])
  if (error) throw error
  if (e2) throw e2
  const items: { category_path: string | null; archived: boolean }[] = []
  if (v?.lightspeed_vendor_id) {
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error: e3 } = await supabase.from('ls_items').select('category_path, archived').eq('default_vendor_id', v.lightspeed_vendor_id).range(from, from + 999)
      if (e3) throw e3
      items.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
  }
  return { ls: buyCategories(items), lsMatched: !!v?.lightspeed_vendor_id, wwd: wwdLines((portal ?? []).map((p) => ({ number: p.number, data: p.data }))) }
}
