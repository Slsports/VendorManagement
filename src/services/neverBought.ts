import { supabase } from '@/lib/supabase'
import { clearPickerCache } from '@/services/mail'

// Never bought from (Dana, Oct 12): companies Claude thinks we have never bought from. Their mail goes to Promotions.

export interface NeverBoughtRow {
  company: string
  sender_ids: string[]
  addresses: string[]
  website: string | null
  phone: string | null
  email_count: number
  latest_at: string | null
  checked_at: string | null
  checked_by: string | null
  note: string | null
}

export async function listNeverBought(organizationId: string): Promise<NeverBoughtRow[]> {
  const { data, error } = await supabase.rpc('list_never_bought', { p_org: organizationId })
  if (error) throw error
  return ((data ?? []) as NeverBoughtRow[]).map((r) => ({ ...r, addresses: r.addresses ?? [], email_count: Number(r.email_count) }))
}

/** "This is…": file the company's mail to a vendor; the company name is kept as an alias. */
export async function neverBoughtIsVendor(senderIds: string[], vendorId: string): Promise<void> {
  const { error } = await supabase.rpc('never_bought_is_vendor', { p_senders: senderIds, p_vendor: vendorId })
  if (error) throw error
}

/** "Make it a vendor": creates the vendor and files the mail there. Returns the new vendor's id. */
export async function neverBoughtMakeVendor(senderIds: string[], name: string, website: string | null, phone: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('never_bought_make_vendor', { p_senders: senderIds, p_name: name, p_website: website, p_phone: phone })
  if (error) throw error
  clearPickerCache()
  return data as string
}

/** "Leave it" marks it checked; checked = false puts it back to check. */
export async function neverBoughtLeave(senderIds: string[], checked = true): Promise<void> {
  const { error } = await supabase.rpc('never_bought_leave', { p_senders: senderIds, p_checked: checked })
  if (error) throw error
}

export interface SenderFiling { id: string; how: 'claude' | 'this_is'; note: string | null; created_at: string; sender: { sender_key: string; is_domain: boolean; display_name: string | null } | null }

/** Mail senders filed to this vendor by Claude or from the Never bought from list, still in place (undoable). */
export async function listVendorFilings(vendorId: string): Promise<SenderFiling[]> {
  const { data, error } = await supabase.from('sender_filings').select('id, how, note, created_at, sender:email_senders!sender_filings_sender_id_fkey(sender_key, is_domain, display_name)')
    .eq('vendor_id', vendorId).is('undone_at', null).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as SenderFiling[]
}

export async function undoSenderFiling(filingId: string): Promise<void> {
  const { error } = await supabase.rpc('undo_sender_filing', { p_filing: filingId })
  if (error) throw error
}
