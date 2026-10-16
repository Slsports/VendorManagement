import { supabase } from '@/lib/supabase'
import type { AccountingPolicy, AccountingPolicyRecipient, AccountingPolicySend, AccountingPolicyTerm } from '@/types'
import type { TablesInsert, TablesUpdate } from '@/types/database'

// ---- policies ------------------------------------------------------------------------------------------------------

export interface PolicyRow extends AccountingPolicy {
  terms: AccountingPolicyTerm[]
  agent: { id: string; company: string; person: string } | null
}

const POLICY_SELECT = '*, terms:accounting_policy_terms(*), agent:accounting_contacts!accounting_policies_agent_contact_id_fkey(id, company, person)'

/** The insurance tracker (Dana, Oct 16): every policy with its years, renewal first. */
export async function listPolicies(organizationId: string, includeInactive = false): Promise<PolicyRow[]> {
  let q = supabase.from('accounting_policies').select(POLICY_SELECT).eq('organization_id', organizationId)
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q.order('renewal_date', { ascending: true, nullsFirst: false }).order('sort_order').order('label')
  if (error) throw error
  return ((data ?? []) as unknown as PolicyRow[]).map(sortTerms)
}

export async function getPolicy(id: string): Promise<PolicyRow | null> {
  const { data, error } = await supabase.from('accounting_policies').select(POLICY_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? sortTerms(data as unknown as PolicyRow) : null
}

function sortTerms(p: PolicyRow): PolicyRow {
  return { ...p, terms: [...(p.terms ?? [])].sort((a, b) => b.term_label.localeCompare(a.term_label)) }
}

export async function savePolicy(organizationId: string, id: string | null, row: TablesUpdate<'accounting_policies'>): Promise<string> {
  if (id) {
    const { error } = await supabase.from('accounting_policies').update(row).eq('id', id)
    if (error) throw error
    return id
  }
  const { data, error } = await supabase.from('accounting_policies').insert({ organization_id: organizationId, label: row.label ?? 'New policy', ...row } as TablesInsert<'accounting_policies'>).select('id').single()
  if (error) throw error
  return data.id
}

export async function saveTerm(organizationId: string, policyId: string, id: string | null, row: { term_label: string; premium: number | null; paid_on: string | null; paid_from: string; notes: string }): Promise<void> {
  if (id) {
    const { error } = await supabase.from('accounting_policy_terms').update(row).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('accounting_policy_terms').insert({ organization_id: organizationId, policy_id: policyId, ...row })
    if (error) throw error
  }
}

export async function deleteTerm(id: string) {
  const { error } = await supabase.from('accounting_policy_terms').delete().eq('id', id)
  if (error) throw error
}

/** Renewal tasks 30 days ahead for everything renewing within 45 days (also runs daily on its own). */
export async function syncPolicyTasks(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('accounting_sync_policy_tasks', { p_org: organizationId })
  if (error) throw error
  return data ?? 0
}

/** "Renewed": the new year's premium and payment, the renewal date moves a year on, the renewal task closes. */
export async function policyRenewed(policyId: string, input: { term: string; premium: number | null; paidOn: string | null; paidFrom: string; newRenewal: string | null; newNumber: string | null }) {
  const { error } = await supabase.rpc('accounting_policy_renewed', { p_policy: policyId, p_term: input.term, p_premium: input.premium, p_paid_on: input.paidOn, p_paid_from: input.paidFrom, p_new_renewal: input.newRenewal, p_new_number: input.newNumber })
  if (error) throw error
}

/** The policy paper for a year came in: a "Send … to …" task per person who needs it. */
export async function policyReceived(policyId: string, term: string, documentId: string | null = null): Promise<number> {
  const { data, error } = await supabase.rpc('accounting_policy_received', { p_policy: policyId, p_term: term, p_document: documentId })
  if (error) throw error
  return data ?? 0
}

// ---- who needs proof ------------------------------------------------------------------------------------------------

export async function listRecipients(organizationId: string, status?: AccountingPolicyRecipient['status']): Promise<AccountingPolicyRecipient[]> {
  let q = supabase.from('accounting_policy_recipients').select('*').eq('organization_id', organizationId)
  if (status) q = q.eq('status', status)
  const { data, error } = await q.order('company').order('person')
  if (error) throw error
  return data ?? []
}

export async function getRecipient(id: string): Promise<{ recipient: AccountingPolicyRecipient; sends: AccountingPolicySend[] } | null> {
  const { data, error } = await supabase.from('accounting_policy_recipients').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const { data: sends, error: serr } = await supabase.from('accounting_policy_sends').select('*').eq('recipient_id', id).order('sent_on', { ascending: false }).limit(100)
  if (serr) throw serr
  return { recipient: data, sends: sends ?? [] }
}

export async function saveRecipient(organizationId: string, id: string | null, row: TablesUpdate<'accounting_policy_recipients'>): Promise<string> {
  const clean = { ...row, email: (row.email ?? '').trim().toLowerCase() }
  if (id) {
    const { error } = await supabase.from('accounting_policy_recipients').update(clean).eq('id', id)
    if (error) throw error
    return id
  }
  const { data, error } = await supabase.from('accounting_policy_recipients').insert({ organization_id: organizationId, ...clean } as TablesInsert<'accounting_policy_recipients'>).select('id').single()
  if (error) throw error
  return data.id
}

/** Look through billing@ for people who asked for proof of insurance and are not on the list yet. */
export async function proposeRecipients(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('accounting_propose_recipients', { p_org: organizationId })
  if (error) throw error
  return data ?? 0
}

/** Proof went out (we sent it, or the agent did): logged, stamped on the recipient, the send task closed. */
export async function recordSend(recipientId: string, input: { policyId: string | null; term: string | null; sentBy: 'us' | 'agent'; sentOn?: string; emailId?: string | null; note?: string }) {
  const { error } = await supabase.rpc('accounting_record_send', { p_recipient: recipientId, p_policy: input.policyId, p_term: input.term, p_sent_by: input.sentBy, p_sent_on: input.sentOn ?? new Date().toISOString().slice(0, 10), p_email: input.emailId ?? null, p_note: input.note ?? '' })
  if (error) throw error
}

/** The newest email in a conversation we just sent (to log which email carried the proof). */
export async function latestSentEmailId(threadId: string): Promise<string | null> {
  const { data, error } = await supabase.from('emails').select('id').eq('thread_id', threadId).eq('direction', 'out').order('received_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}
