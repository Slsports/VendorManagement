import { supabase } from '@/lib/supabase'
import { listThreads, type ThreadRow } from '@/services/mail'
import type { AccountingCategory, AccountingContact } from '@/types'

export type ContactStatus = AccountingContact['status']

export interface ContactAddress { address: string; is_domain: boolean }

/** Contacts (Dana, Oct 16): everyone proposed from billing@ or added by hand, by status. Merged ones are hidden. */
export async function listAccountingContacts(organizationId: string, status?: ContactStatus): Promise<AccountingContact[]> {
  let q = supabase.from('accounting_contacts').select('*').eq('organization_id', organizationId).is('merged_into', null)
  if (status) q = q.eq('status', status)
  const { data, error } = await q.order('company').order('person')
  if (error) throw error
  return data ?? []
}

export async function countAccountingContacts(organizationId: string): Promise<Record<ContactStatus, number>> {
  const one = async (status: ContactStatus) => {
    const { count, error } = await supabase.from('accounting_contacts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).is('merged_into', null).eq('status', status)
    if (error) throw error
    return count ?? 0
  }
  const [proposed, confirmed, ignored] = await Promise.all([one('proposed'), one('confirmed'), one('ignored')])
  return { proposed, confirmed, ignored }
}

export async function getAccountingContact(id: string): Promise<{ contact: AccountingContact; addresses: ContactAddress[] } | null> {
  const { data, error } = await supabase.from('accounting_contacts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const { data: addrs, error: aerr } = await supabase.from('accounting_contact_addresses').select('address, is_domain').eq('contact_id', id).order('is_domain', { ascending: false }).order('address')
  if (aerr) throw aerr
  return { contact: data, addresses: addrs ?? [] }
}

export interface ContactInput {
  company: string
  person: string
  role: string
  category: AccountingCategory
  phones: string[]
  notes: string
  status: ContactStatus
  /** Email addresses, lower-cased; a bare domain (no @) means every address at that company. */
  addresses: string[]
}

/** Create or update a contact and its addresses, then re-match the mail so the conversations follow. */
export async function saveAccountingContact(organizationId: string, id: string | null, input: ContactInput): Promise<string> {
  const row = { company: input.company.trim(), person: input.person.trim(), role: input.role.trim(), category: input.category, phones: input.phones.map((p) => p.trim()).filter(Boolean), notes: input.notes.trim(), status: input.status }
  let contactId = id
  if (contactId) {
    const { error } = await supabase.from('accounting_contacts').update(row).eq('id', contactId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('accounting_contacts').insert({ organization_id: organizationId, ...row }).select('id').single()
    if (error) throw error
    contactId = data.id
  }
  const wanted = [...new Set(input.addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  const { data: current, error: cerr } = await supabase.from('accounting_contact_addresses').select('address').eq('contact_id', contactId)
  if (cerr) throw cerr
  const have = new Set((current ?? []).map((a) => a.address))
  const gone = [...have].filter((a) => !wanted.includes(a))
  if (gone.length) {
    const { error } = await supabase.from('accounting_contact_addresses').delete().eq('contact_id', contactId).in('address', gone)
    if (error) throw error
  }
  const add = wanted.filter((a) => !have.has(a))
  if (add.length) {
    const { error } = await supabase.from('accounting_contact_addresses').upsert(add.map((address) => ({ organization_id: organizationId, address, is_domain: !address.includes('@'), contact_id: contactId! })), { onConflict: 'organization_id,address' })
    if (error) throw error
  }
  await rematchAccountingMail(organizationId)
  return contactId
}

export async function setAccountingContactStatus(id: string, status: ContactStatus) {
  const { error } = await supabase.from('accounting_contacts').update({ status }).eq('id', id)
  if (error) throw error
}

export async function mergeAccountingContacts(fromId: string, intoId: string) {
  const { error } = await supabase.rpc('accounting_merge_contacts', { p_from: fromId, p_into: intoId })
  if (error) throw error
}

/** Look through the billing@ mail for people not on the list yet. Returns how many were proposed. */
export async function proposeAccountingContacts(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('accounting_propose_contacts', { p_org: organizationId })
  if (error) throw error
  return data ?? 0
}

/** Match every billing@ conversation to its contact again (after a contact changes) and refresh the counts. */
export async function rematchAccountingMail(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('accounting_rematch_all', { p_org: organizationId })
  if (error) throw error
  const { error: rerr } = await supabase.rpc('accounting_recount', { p_org: organizationId })
  if (rerr) throw rerr
  return data ?? 0
}

export async function setThreadContact(threadId: string, contactId: string | null) {
  const { error } = await supabase.rpc('accounting_set_thread_contact', { p_thread: threadId, p_contact: contactId })
  if (error) throw error
}

/** One contact's conversations, newest first. */
export function listContactThreads(organizationId: string, mailboxId: string, contactId: string, limit = 100): Promise<ThreadRow[]> {
  return listThreads(organizationId, undefined, { who: 'all', status: 'all', view: 'all', mailbox: mailboxId, contactId }, limit)
}
