import { supabase } from '@/lib/supabase'
import type { Task } from '@/types'
import type { TablesInsert, TablesUpdate } from '@/types/database'

/** A task with what it is about and who gave, has and finished it. */
export interface TaskRow extends Task {
  vendor: { id: string; name: string } | null
  carrier: { id: string; name: string } | null
  rep_group: { id: string; name: string } | null
  order: { id: string; po_number: string | null; description: string | null } | null
  thread: { id: string; subject: string | null } | null
  assignee: { id: string; full_name: string } | null
  giver: { id: string; full_name: string } | null
  finisher: { id: string; full_name: string } | null
}

const TASK_SELECT = `*,
  vendor:vendors!tasks_vendor_id_fkey(id, name), carrier:carriers!tasks_carrier_id_fkey(id, name), rep_group:rep_groups!tasks_rep_group_id_fkey(id, name),
  order:orders!tasks_order_id_fkey(id, po_number, description), thread:email_threads!tasks_thread_id_fkey(id, subject),
  assignee:profiles!tasks_assigned_to_fkey(id, full_name), giver:profiles!tasks_created_by_fkey(id, full_name), finisher:profiles!tasks_done_by_fkey(id, full_name)`

/** mine = assigned to the person · given = they gave to others · done = finished, theirs or given · all = everyone's open. */
export type TaskView = 'mine' | 'given' | 'done' | 'all'

/** Tasks for one person (null = everyone, the admin's view). RLS limits the rest. */
export async function listTasks(organizationId: string, view: TaskView, personId: string | null): Promise<TaskRow[]> {
  let q = supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId)
  if (view === 'done') {
    q = q.not('done_at', 'is', null)
    if (personId) q = q.or(`assigned_to.eq.${personId},created_by.eq.${personId}`)
    q = q.order('done_at', { ascending: false }).limit(300)
  } else {
    q = q.is('done_at', null)
    if (personId && view === 'mine') q = q.eq('assigned_to', personId)
    if (personId && view === 'given') q = q.eq('created_by', personId).neq('assigned_to', personId)
    q = q.order('due_date', { ascending: true, nullsFirst: false }).order('created_at').limit(1000)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as TaskRow[]
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const { data, error } = await supabase.from('tasks').select(TASK_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data as unknown as TaskRow | null
}

/** Open tasks about one vendor, order or email. */
export async function listTasksAbout(organizationId: string, about: TaskAbout): Promise<TaskRow[]> {
  const col = about.vendor_id ? 'vendor_id' : about.order_id ? 'order_id' : about.thread_id ? 'thread_id' : null
  const id = about.vendor_id ?? about.order_id ?? about.thread_id
  if (!col || !id) return []
  const { data, error } = await supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId).eq(col, id).is('done_at', null)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as unknown as TaskRow[]
}

export interface TaskAbout { vendor_id?: string | null; order_id?: string | null; thread_id?: string | null; carrier_id?: string | null; rep_group_id?: string | null }

/** For the dashboard: reminders that have come for the person, and tasks they gave that someone finished. */
export async function listNotices(organizationId: string, personId: string): Promise<{ reminders: TaskRow[]; finished: TaskRow[] }> {
  const [r, f] = await Promise.all([
    supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId).eq('assigned_to', personId).is('done_at', null)
      .not('remind_at', 'is', null).lte('remind_at', new Date().toISOString()).is('reminder_seen_at', null).order('remind_at'),
    supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId).eq('created_by', personId).not('done_at', 'is', null)
      .is('done_seen_at', null).neq('done_by', personId).order('done_at', { ascending: false }),
  ])
  if (r.error) throw r.error
  if (f.error) throw f.error
  return { reminders: (r.data ?? []) as unknown as TaskRow[], finished: (f.data ?? []) as unknown as TaskRow[] }
}

export async function createTask(row: TablesInsert<'tasks'>): Promise<string> {
  const { data, error } = await supabase.from('tasks').insert(row).select('id').single()
  if (error) throw error
  tasksChanged()
  return data.id
}

export async function updateTask(id: string, changes: TablesUpdate<'tasks'>): Promise<void> {
  const { error } = await supabase.from('tasks').update(changes).eq('id', id)
  if (error) throw error
  tasksChanged()
}

/** Finish a task; a repeating one makes the next (its id is returned). */
export async function completeTask(id: string, note?: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('complete_task', { p_task: id, p_note: note ?? null })
  if (error) throw error
  tasksChanged()
  return data
}

export const reopenTask = (id: string) => updateTask(id, { done_at: null })

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
  tasksChanged()
}

/** Remind again later (a new remind time sends a new reminder). */
export const snoozeTask = (id: string, until: Date) => updateTask(id, { remind_at: until.toISOString() })
export const reminderSeen = (id: string) => updateTask(id, { reminder_seen_at: new Date().toISOString() })
export const finishedSeen = (id: string) => updateTask(id, { done_seen_at: new Date().toISOString() })

export interface ReminderSettings { remind_dashboard: boolean; remind_email: boolean; remind_text: boolean; mobile_phone: string | null }

export async function saveReminderSettings(profileId: string, s: ReminderSettings): Promise<void> {
  const { error } = await supabase.from('profiles').update(s).eq('id', profileId)
  if (error) throw error
}

// Every task list on screen reloads when one changes (the dashboard box, the page, a vendor's tasks).
const EVENT = 'vms:tasks-changed'
export function tasksChanged() { window.dispatchEvent(new Event(EVENT)) }
export function onTasksChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
