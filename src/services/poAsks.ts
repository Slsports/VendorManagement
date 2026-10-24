import { supabase } from '@/lib/supabase'
import type { PoAsk } from '@/types'

// "Please use our PO" (Dana, Oct 24): each email asking a vendor to add or use our PO, and what they answered.

export type PoAskRow = PoAsk & { check: { doc_number: string | null; document_id: string } | null; ask_email: { thread_id: string } | null; answer_email: { thread_id: string } | null }

const SELECT = '*, check:order_checks!po_asks_check_id_fkey(doc_number, document_id), ask_email:emails!po_asks_ask_email_id_fkey(thread_id), answer_email:emails!po_asks_answer_email_id_fkey(thread_id)'

export async function poAsksForOrder(orderId: string): Promise<PoAskRow[]> {
  const { data, error } = await supabase.from('po_asks').select(SELECT).eq('order_id', orderId).order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as PoAskRow[]
}

export async function poAskForCheck(checkId: string): Promise<PoAskRow | null> {
  const { data, error } = await supabase.from('po_asks').select(SELECT).eq('check_id', checkId).maybeSingle()
  if (error) throw error
  return data as unknown as PoAskRow | null
}

/** Keep our PO in Lightspeed (the other answer, Change it, goes through the lightspeed function). */
export async function keepLsPoReference(itemId: string) {
  const { error } = await supabase.rpc('ls_po_reference_answer', { p_item: itemId, p_changed: false })
  if (error) throw error
}

/** What the order shows for an ask, in plain words. */
export function poAskLine(a: Pick<PoAsk, 'status' | 'kind' | 'their_po' | 'our_po' | 'asked_at' | 'answered_at' | 'answer_note'>): string {
  const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '')
  const asked = a.kind === 'add' ? `Asked them to add our PO ${a.our_po}` : `Asked to use our PO ${a.our_po} instead of ${a.their_po ?? 'theirs'}`
  switch (a.status) {
    case 'drafted': return `The email asking them to ${a.kind === 'add' ? 'add' : 'use'} our PO is ready in Mail › Drafts (not sent yet)`
    case 'asked': return `${asked} on ${day(a.asked_at)}. No answer yet.`
    case 'yes': return `${asked} on ${day(a.asked_at)}. They said yes on ${day(a.answered_at)}${a.answer_note ? `: ${a.answer_note}` : ''}. Waiting for the updated confirmation.`
    case 'replaced': return `${asked} on ${day(a.asked_at)}. Their updated confirmation shows our PO; the old one is in Confirmations › Old.`
    case 'too_late': return `${asked} on ${day(a.asked_at)}. They said it was too late on ${day(a.answered_at)}${a.answer_note ? `: ${a.answer_note}` : ''}. The order uses their PO.`
  }
}
