import { supabase } from '@/lib/supabase'
import { tasksChanged } from '@/services/tasks'

// A payment email that names no invoice numbers (Dana, Nov 11): VMS marks the invoices from the same conversation; when
// there are none, a task asks which of the vendor's unpaid invoices it paid.

export interface PaymentChoice {
  id: string; label: string; doc_number: string | null; doc_date: string | null; doc_total: number | null
  received_at: string | null; storage_path: string | null; file_name: string | null; mime_type: string | null
}

/** The vendor's unpaid invoices from the 120 days before the payment email. */
export async function listPaymentChoices(emailId: string): Promise<PaymentChoice[]> {
  const { data, error } = await supabase.rpc('payment_notice_choices', { p_email: emailId })
  if (error) throw error
  return (data ?? []) as PaymentChoice[]
}

/** Mark the ticked invoices paid from that email; none = "None of these". Returns how many were marked. */
export async function markPaymentInvoices(emailId: string, linkIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('payment_notice_pick', { p_email: emailId, p_links: linkIds })
  if (error) throw error
  tasksChanged()
  return data as number
}
