import { supabase } from '@/lib/supabase'
import type { AskChat, AskMessage, ChangeRequest } from '@/types'

/** A chat in the list, with whose it is (Dana reads everyone's, Nov 5). */
export type AskChatRow = AskChat & { owner: { full_name: string | null; email: string } | null }

/** My chats, or (for Dana) everyone's or one person's. Newest first. */
export async function listAskChats(organizationId: string, ownerId: string | null): Promise<AskChatRow[]> {
  let q = supabase.from('ask_chats').select('*, owner:profiles!ask_chats_owner_id_fkey(full_name, email)')
    .eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(200)
  if (ownerId) q = q.eq('owner_id', ownerId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as AskChatRow[]
}

export async function listAskMessages(chatId: string): Promise<AskMessage[]> {
  const { data, error } = await supabase.from('ask_messages').select('*').eq('chat_id', chatId).order('created_at')
  if (error) throw error
  return data ?? []
}

/** Ask a question: starts the answer and returns at once; the answer fills in while Claude looks things up. */
export async function askVms(input: { message: string; chatId?: string | null; vendorId?: string | null; orderId?: string | null }): Promise<{ chat_id: string; message_id: string }> {
  const { data, error } = await supabase.functions.invoke('ask-vms', {
    body: { message: input.message, chat_id: input.chatId ?? null, vendor_id: input.vendorId ?? null, order_id: input.orderId ?? null },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null)
      if (body?.error) throw new Error(body.error)
    }
    throw error
  }
  return data
}

/** What I spent on Ask VMS today (the limit is $5 a day per person). */
export async function myAskSpend(): Promise<number> {
  const { data, error } = await supabase.rpc('ask_my_spend')
  if (error) throw error
  return Number(data ?? 0)
}

export async function renameAskChat(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('ask_chats').update({ title }).eq('id', id)
  if (error) throw error
}

export async function deleteAskChat(id: string): Promise<void> {
  const { error } = await supabase.from('ask_chats').delete().eq('id', id)
  if (error) throw error
}

export type ChangeRequestRow = ChangeRequest & { requester: { full_name: string | null; email: string } | null }

/** Requests to change VMS: Dana sees all of them, everyone else their own. Waiting first. */
export async function listChangeRequests(organizationId: string): Promise<ChangeRequestRow[]> {
  const { data, error } = await supabase.from('change_requests').select('*, requester:profiles!change_requests_requested_by_fkey(full_name, email)')
    .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  const rows = (data ?? []) as unknown as ChangeRequestRow[]
  return [...rows.filter((r) => r.status === 'waiting'), ...rows.filter((r) => r.status !== 'waiting')]
}

/** Dana approves, turns down, or marks a request built; the person who asked gets her answer as a task. */
export async function decideChangeRequest(id: string, status: 'approved' | 'declined' | 'built', note: string): Promise<void> {
  const { error } = await supabase.rpc('change_request_decide', { p_id: id, p_status: status, p_note: note })
  if (error) throw error
}

/** People whose chats Dana can pick in the Showing box. */
export async function listAskPeople(organizationId: string): Promise<{ id: string; full_name: string | null; email: string }[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, role, ask_vms, is_active').eq('organization_id', organizationId).eq('is_active', true).order('full_name')
  if (error) throw error
  return (data ?? []).filter((p) => p.role === 'admin' || p.ask_vms)
}
