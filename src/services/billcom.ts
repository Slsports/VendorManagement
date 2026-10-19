import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { Tables } from '@/types/database'

// Bill.com, light (Dana, Oct 19): Settings (admin), the bills due, and what was sent but not entered yet.
export interface BillcomStatus {
  set_up: boolean; dev_key: string | null; org_bill_id: string | null; username: string | null; inbox_address: string; base_url: string
  connected: boolean; connected_at: string | null; connected_by: string | null; last_sync_at: string | null; last_error: string | null
  bills_seen: number | null; unpaid: number; sample: { list_keys?: string[]; bill_keys?: string[]; invoice_keys?: string[] } | null
  sync?: { bills: number; tasks: number }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('billcom', { body })
  if (error) throw await functionError(error)
  return data as T
}
export const billcomStatus = () => call<BillcomStatus>({ action: 'status' })
export const saveBillcom = (f: { dev_key: string; org_bill_id: string; username: string; password: string; base_url: string; inbox_address: string }) => call<BillcomStatus>({ action: 'save', ...f })
export const testBillcom = () => call<BillcomStatus>({ action: 'test' })
export const syncBillcomNow = () => call<BillcomStatus>({ action: 'sync_now' })
export const disconnectBillcom = () => call<BillcomStatus>({ action: 'disconnect' })

export type BillcomBill = Tables<'billcom_bills'>
export type BillcomWaiting = { email_id: string; thread_id: string | null; vendor_name: string | null; file_name: string | null; doc_number: string | null; doc_total: number | null; sent_at: string }

/** Unpaid bills due within `days` (and overdue), soonest first. */
export async function listBillcomDue(organizationId: string, days = 7): Promise<BillcomBill[]> {
  const to = new Date(); to.setDate(to.getDate() + days)
  const { data, error } = await supabase.from('billcom_bills').select('*').eq('organization_id', organizationId).is('gone_at', null).eq('archived', false)
    .not('payment_status', 'in', '(PAID,SCHEDULED,IN_PROCESS)').lte('due_date', to.toISOString().slice(0, 10)).order('due_date').limit(50)
  if (error) throw error
  return data ?? []
}

/** Forwarded to Bill.com's inbox but not a bill there yet. */
export async function listBillcomWaiting(organizationId: string): Promise<BillcomWaiting[]> {
  const { data, error } = await supabase.rpc('billcom_waiting', { p_org: organizationId })
  if (error) throw error
  return (data ?? []) as BillcomWaiting[]
}

/** Send an invoice email to Bill.com again (admin), after a failed forward. */
export async function resendBillcomForward(forwardId: string): Promise<{ status: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('billcom-forward', { body: { forward_id: forwardId } })
  if (error) throw await functionError(error)
  return data as { status: string; error?: string }
}

export async function listBillcomForwards(organizationId: string, limit = 20): Promise<(Tables<'billcom_forwards'> & { vendor: { name: string } | null; email: { subject: string | null; thread_id: string } | null })[]> {
  const { data, error } = await supabase.from('billcom_forwards').select('*, vendor:vendors(name), email:emails(subject, thread_id)').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as never
}
