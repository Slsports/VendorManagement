import { supabase } from '@/lib/supabase'
import type { EmailSenderKind, EmailThreadStatus, MailAccount } from '@/types'

export interface NamedRef { id: string; name: string }

// Pickers on many review cards share one load per page visit.
const cache = new Map<string, Promise<NamedRef[]>>()
function once(key: string, load: () => Promise<NamedRef[]>): Promise<NamedRef[]> {
  if (!cache.has(key)) cache.set(key, load().catch((e) => { cache.delete(key); throw e }))
  return cache.get(key)!
}

/** Active vendors, id and name, A–Z (for "Pick another vendor"). */
export function listVendorNames(organizationId: string): Promise<NamedRef[]> {
  return once(`v:${organizationId}`, async () => {
    const out: NamedRef[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('vendors').select('id, name').eq('organization_id', organizationId).eq('is_active', true).order('name').range(from, from + 999)
      if (error) throw error
      out.push(...(data ?? []))
      if (!data || data.length < 1000) return out
    }
  })
}

export function listRepGroupNames(organizationId: string): Promise<NamedRef[]> {
  return once(`r:${organizationId}`, async () => {
    const { data, error } = await supabase.from('rep_groups').select('id, name').eq('organization_id', organizationId).eq('is_active', true).order('name')
    if (error) throw error
    return data ?? []
  })
}

/** Answer a sender proposal. Returns how many emails were linked. */
export async function resolveEmailSender(senderId: string, kind: Exclude<EmailSenderKind, 'unknown'>, vendorId?: string | null, repGroupId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('resolve_email_sender', { p_sender: senderId, p_kind: kind, p_vendor: vendorId ?? null, p_rep_group: repGroupId ?? null })
  if (error) throw error
  return data ?? 0
}

export async function setEmailVendor(emailId: string, vendorId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_email_vendor', { p_email: emailId, p_vendor: vendorId })
  if (error) throw error
}

export async function assignEmailThread(threadId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_email_thread', { p_thread: threadId, p_profile: profileId })
  if (error) throw error
}

export async function setEmailThreadStatus(threadId: string, status: EmailThreadStatus): Promise<void> {
  const { error } = await supabase.rpc('set_email_thread_status', { p_thread: threadId, p_status: status })
  if (error) throw error
}

export interface MailStatus extends MailAccount {
  emails: number
  matched: number
  senders_waiting: number
}

export async function getMailStatus(organizationId: string): Promise<MailStatus | null> {
  const { data, error } = await supabase.from('mail_accounts').select('*').eq('organization_id', organizationId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error: e } = await q
    if (e) throw e
    return n ?? 0
  }
  const [emails, matched, senders] = await Promise.all([
    count(supabase.from('emails').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)),
    count(supabase.from('emails').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).not('vendor_id', 'is', null)),
    count(supabase.from('email_senders').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('kind', 'unknown')),
  ])
  return { ...data, emails, matched, senders_waiting: senders }
}

export async function setFollowUpDays(organizationId: string, days: number): Promise<void> {
  const { error } = await supabase.from('mail_accounts').update({ follow_up_days: days }).eq('organization_id', organizationId)
  if (error) throw error
}

/** Ask the sync to run now (signed-in admin, manager or buyer). */
export async function syncMailNow(): Promise<void> {
  const { error } = await supabase.functions.invoke('gmail-sync', { body: {} })
  if (error) throw error
}
