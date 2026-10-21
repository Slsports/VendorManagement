import { supabase } from '@/lib/supabase'
import { vendorOrderAddresses } from '@/services/addOns'
import type { AskItem } from '@/lib/availability'
import type { AvailabilityAsk } from '@/types'
import type { Json } from '@/types/database'

/** Start an ask from the suggested order (Dana, Oct 21): the items; the email is written and sent by the person. */
export async function createAvailabilityAsk(vendorId: string, reportId: string | null, items: AskItem[]): Promise<string> {
  const { data, error } = await supabase.rpc('availability_ask_create', { p_vendor: vendorId, p_report: reportId, p_items: items as unknown as Json })
  if (error) throw error
  return data as string
}

/** The vendor's newest ask that went out, with the conversation and the rep's reply. */
export async function latestAvailabilityAsk(vendorId: string): Promise<(AvailabilityAsk & { reply_thread: string | null }) | null> {
  const { data, error } = await supabase.from('availability_asks').select('*').eq('vendor_id', vendorId).neq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data ? { ...data, reply_thread: data.thread_id } : null
}

/** Who gets the ask: the vendor's reps first, else its ordering addresses. */
export async function repAddresses(vendorId: string): Promise<string[]> {
  const { data, error } = await supabase.from('vendor_emails').select('email, roles, contact_type, former_at').eq('vendor_id', vendorId)
  if (error) throw error
  const reps = (data ?? []).filter((r) => !r.former_at && ((r.roles ?? []).some((x: string) => /rep|sales/i.test(x)) || /rep|sales/i.test(r.contact_type ?? '')))
  if (reps.length) return [...new Set(reps.map((r) => (r.email ?? '').trim().toLowerCase()).filter(Boolean))]
  return vendorOrderAddresses(vendorId)
}
