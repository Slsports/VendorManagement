import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { ItemChange, ItemChangeDecision } from '@/types'

// Unavailable items on vendor confirmations (Dana, Oct 18): what the vendor said, the decision in Review, and what was
// written to Lightspeed.

export async function getItemChange(id: string): Promise<ItemChange> {
  const { data, error } = await supabase.from('item_changes').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function listCheckItemChanges(checkId: string): Promise<ItemChange[]> {
  const { data, error } = await supabase.from('item_changes').select('*').eq('check_id', checkId).order('created_at')
  if (error) throw error
  return data ?? []
}

/** Decide, then write it to Lightspeed (nothing to write for Leave as is). Returns what Lightspeed said. */
export async function decideItemChange(id: string, decision: ItemChangeDecision, opts: { backDate?: string | null; reason?: string | null; replacement?: string | null } = {}): Promise<{ status: string; error: string | null }> {
  const { error } = await supabase.rpc('item_change_decide', { p_change: id, p_decision: decision, p_back_date: opts.backDate || null, p_reason: opts.reason || null, p_replacement: opts.replacement || null })
  if (error) throw error
  if (decision === 'leave' || decision === 'find_replacement') return { status: 'not_needed', error: null }
  return writeItemChangeToLs(id)
}

export async function writeItemChangeToLs(id: string): Promise<{ status: string; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('lightspeed', { body: { action: 'item_change_write', change_id: id } })
  if (error) throw await functionError(error)
  return data as { status: string; error: string | null }
}

/** The people who can choose DNR (Dana, Trevor and Jarrett for now). */
export async function listDnrPeople(organizationId: string): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name').eq('organization_id', organizationId).eq('can_dnr', true).eq('is_active', true).order('full_name')
  if (error) throw error
  return data ?? []
}

export async function askForDnr(id: string, to: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('item_change_dnr_request', { p_change: id, p_to: to, p_reason: reason })
  if (error) throw error
}
