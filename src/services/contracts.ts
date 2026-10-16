import { supabase } from '@/lib/supabase'
import type { AccountingContract, AccountingContractPayment } from '@/types'
import type { TablesInsert, TablesUpdate } from '@/types/database'

export interface ContractRow extends AccountingContract {
  payments: AccountingContractPayment[]
  contact: { id: string; company: string; person: string } | null
  procedure: { id: string; title: string } | null
}

const SELECT = '*, payments:accounting_contract_payments(*), contact:accounting_contacts!accounting_contracts_contact_id_fkey(id, company, person), procedure:accounting_procedures!accounting_contracts_procedure_id_fkey(id, title)'

const sortPayments = (c: ContractRow): ContractRow => ({ ...c, payments: [...(c.payments ?? [])].sort((a, b) => a.due_on.localeCompare(b.due_on)) })

/** The contracts tracker (Dana, Oct 16): licenses, leases, loans, with their payments and renewals. */
export async function listContracts(organizationId: string): Promise<ContractRow[]> {
  const { data, error } = await supabase.from('accounting_contracts').select(SELECT).eq('organization_id', organizationId).order('term_end', { ascending: true, nullsFirst: false }).order('label')
  if (error) throw error
  return ((data ?? []) as unknown as ContractRow[]).map(sortPayments)
}

export async function getContract(id: string): Promise<ContractRow | null> {
  const { data, error } = await supabase.from('accounting_contracts').select(SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? sortPayments(data as unknown as ContractRow) : null
}

export async function saveContract(organizationId: string, id: string | null, row: TablesUpdate<'accounting_contracts'>): Promise<string> {
  if (id) {
    const { error } = await supabase.from('accounting_contracts').update(row).eq('id', id)
    if (error) throw error
    return id
  }
  const { data, error } = await supabase.from('accounting_contracts').insert({ organization_id: organizationId, label: row.label ?? 'New contract', ...row } as TablesInsert<'accounting_contracts'>).select('id').single()
  if (error) throw error
  return data.id
}

export async function savePayment(organizationId: string, contractId: string, id: string | null, row: { label: string; due_on: string; amount: number | null; paid_on: string | null; paid_from: string; notes: string }) {
  if (id) {
    const { error } = await supabase.from('accounting_contract_payments').update(row).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('accounting_contract_payments').insert({ organization_id: organizationId, contract_id: contractId, ...row })
    if (error) throw error
  }
}

export async function deletePayment(id: string) {
  const { error } = await supabase.from('accounting_contract_payments').delete().eq('id', id)
  if (error) throw error
}

/** The check went out: stamps the payment and closes its task. */
export async function paymentPaid(paymentId: string, paidOn: string, paidFrom: string) {
  const { error } = await supabase.rpc('accounting_contract_payment_paid', { p_payment: paymentId, p_paid_on: paidOn, p_paid_from: paidFrom })
  if (error) throw error
}

export async function followUpDone(contractId: string) {
  const { error } = await supabase.rpc('accounting_contract_followup_done', { p_contract: contractId })
  if (error) throw error
}

/** Payment, renewal and follow-up tasks for everything coming up (also runs daily on its own). */
export async function syncContractTasks(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('accounting_sync_contract_tasks', { p_org: organizationId })
  if (error) throw error
  return data ?? 0
}

export const CONTRACT_KINDS: readonly AccountingContract['kind'][] = ['license', 'lease', 'loan', 'contract', 'other']
export const CONTRACT_KIND_LABELS: Record<AccountingContract['kind'], string> = { license: 'License', lease: 'Lease', loan: 'Loan', contract: 'Contract', other: 'Other' }
export const CONTRACT_STATUS_LABELS: Record<AccountingContract['status'], string> = { pending: 'Pending', active: 'Active', expired: 'Expired', ended: 'Ended' }

/** The next unpaid payment, if any. */
export function nextPayment(c: ContractRow): AccountingContractPayment | null {
  return c.payments.find((p) => !p.paid_on) ?? null
}
