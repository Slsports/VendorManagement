import { supabase } from '@/lib/supabase'
import type { MySnoozes } from '@/lib/snooze'

export type SnoozeKind = 'thread' | 'review'
const col = (k: SnoozeKind) => (k === 'thread' ? 'thread_id' : 'review_item_id')

/** This person's snoozes of one kind: what is still hidden, and what came back and was not opened yet. */
export async function mySnoozes(profileId: string, kind: SnoozeKind): Promise<MySnoozes> {
  const { data, error } = await supabase.from('snoozes').select('thread_id, review_item_id, until').eq('profile_id', profileId).not(col(kind), 'is', null).limit(2000)
  if (error) throw error
  const now = new Date().toISOString()
  const hidden = new Map<string, string>()
  const back = new Set<string>()
  for (const s of data ?? []) {
    const id = (kind === 'thread' ? s.thread_id : s.review_item_id)!
    if (s.until > now) hidden.set(id, s.until)
    else back.add(id)
  }
  return { hidden, back }
}

export async function snooze(organizationId: string, profileId: string, kind: SnoozeKind, ids: string[], until: Date): Promise<void> {
  if (!ids.length) return
  await supabase.from('snoozes').delete().eq('profile_id', profileId).in(col(kind), ids)
  const { error } = await supabase.from('snoozes').insert(ids.map((id) => ({ organization_id: organizationId, profile_id: profileId, thread_id: kind === 'thread' ? id : null, review_item_id: kind === 'review' ? id : null, until: until.toISOString() })))
  if (error) throw error
}

/** Unsnooze now, or forget a "back from snooze" mark once it has been opened. */
export async function clearSnooze(profileId: string, kind: SnoozeKind, id: string): Promise<void> {
  const { error } = await supabase.from('snoozes').delete().eq('profile_id', profileId).eq(col(kind), id)
  if (error) throw error
}

export interface SnoozeRow { id: string; until: string; woke_by_reply: boolean; profile_id: string; person: { full_name: string } | null; thread_id: string | null; review_item_id: string | null }

/** Snoozes still waiting, soonest back first: one person's, or everyone's. */
export async function listSnoozes(organizationId: string, kind: SnoozeKind, profileId: string | null): Promise<SnoozeRow[]> {
  let q = supabase.from('snoozes').select('id, until, woke_by_reply, profile_id, thread_id, review_item_id, person:profiles!snoozes_profile_id_fkey(full_name)')
    .eq('organization_id', organizationId).not(col(kind), 'is', null).gt('until', new Date().toISOString())
  if (profileId) q = q.eq('profile_id', profileId)
  const { data, error } = await q.order('until').limit(500)
  if (error) throw error
  return (data ?? []) as unknown as SnoozeRow[]
}
