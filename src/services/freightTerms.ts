import { supabase } from '@/lib/supabase'
import type { FreightPromise } from '@/types'

// Freight terms from email (Dana, Nov 7): "If it comes from the vendor and they promise free freight it should log it for
// that order. Free freight is not an always, every order situation." Claude reads the email; this is the "Which order?" step.

export type FreightPromiseRow = FreightPromise & {
  email: { id: string; thread_id: string; subject: string | null; received_at: string; from_name: string | null; from_email: string | null } | null
}

export async function getFreightPromise(id: string): Promise<FreightPromiseRow | null> {
  const { data, error } = await supabase.from('freight_promises')
    .select('*, email:emails!freight_promises_email_id_fkey(id, thread_id, subject, received_at, from_name, from_email)')
    .eq('id', id).maybeSingle()
  if (error) throw error
  return data as FreightPromiseRow | null
}

/** Put the terms on the order a person picked (null: "None of these", they aren't for an order). */
export async function setFreightPromiseOrder(promiseId: string, orderId: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('freight_promise_set_order', { p_promise: promiseId, p_order: orderId })
  if (error) throw error
  return data as string
}

/** A Freight terms card's answer (Dana, Nov 9): the order it goes on, or null for Not for an order. */
export async function answerFreightTermsCard(itemId: string, orderId: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('freight_terms_review_answer', { p_item: itemId, p_order: orderId })
  if (error) throw error
  return data as string
}

/** "Free freight", "Free freight over $1,000", "Half freight", … in plain words. */
export function freightPromiseText(p: Pick<FreightPromise, 'terms' | 'free_over' | 'cap_pct' | 'amount'>): string {
  const m = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
  switch (p.terms) {
    case 'free': return 'Free freight'
    case 'free_over': return p.free_over != null ? `Free freight over ${m(p.free_over)}` : 'Free freight over a minimum'
    case 'half': return 'Half freight'
    case 'capped': return p.cap_pct != null ? `Freight capped at ${p.cap_pct}%` : 'Freight capped'
    case 'charged': return 'Freight charged'
    case 'quoted': return p.amount != null ? `Freight quoted at ${m(p.amount)}` : 'Freight quoted'
  }
}
