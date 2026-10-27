import { supabase } from '@/lib/supabase'
import type { CreditRequest } from '@/types'

export type CreditRequestRow = CreditRequest & { requester: { full_name: string | null } | null; email: { thread_id: string } | null }

/** The credits we asked this vendor for (Dana, Oct 27): open ones first, then received, newest first. */
export async function listCreditRequests(vendorId: string): Promise<CreditRequestRow[]> {
  const { data, error } = await supabase.from('credit_requests').select('*, requester:profiles!credit_requests_requested_by_fkey(full_name), email:emails!credit_requests_email_id_fkey(thread_id)')
    .eq('vendor_id', vendorId).order('requested_on', { ascending: false }).limit(50)
  if (error) throw error
  return (data ?? []) as unknown as CreditRequestRow[]
}
