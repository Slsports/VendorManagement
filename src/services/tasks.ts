import { supabase } from '@/lib/supabase'
import type { Task } from '@/types'
import type { TablesInsert, TablesUpdate } from '@/types/database'

/** A task with what it is about and who gave, has and finished it. */
export interface TaskRow extends Task {
  procedure?: { id: string; title: string } | null
  policy?: { id: string; label: string } | null
  recipient?: { id: string; company: string; person: string } | null
  contract?: { id: string; label: string } | null
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
  assignee:profiles!tasks_assigned_to_fkey(id, full_name), giver:profiles!tasks_created_by_fkey(id, full_name), finisher:profiles!tasks_done_by_fkey(id, full_name),
  procedure:accounting_procedures!tasks_procedure_id_fkey(id, title), policy:accounting_policies!tasks_policy_id_fkey(id, label), recipient:accounting_policy_recipients!tasks_recipient_id_fkey(id, company, person), contract:accounting_contracts!tasks_contract_id_fkey(id, label)`

/**
 * mine = assigned to the person · given = they gave to others · all = everyone's open · done = a person ticked it done ·
 * request = Claude closed it because Dana asked · vms = VMS closed it on its own (Dana, Oct 23: kept apart so she can check
 * them).
 */
export type TaskView = 'mine' | 'given' | 'done' | 'request' | 'vms' | 'all'
export const CLOSED_VIEWS = ['done', 'request', 'vms'] as const
const CLOSED_HOW = { done: 'person', request: 'request', vms: 'vms' } as const

/** Tasks for one person (null = everyone, the admin's view). RLS limits the rest. */
export async function listTasks(organizationId: string, view: TaskView, personId: string | null): Promise<TaskRow[]> {
  // Accounting tasks (Dana, Oct 16) live in the Accounting area, not here.
  let q = supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId).eq('area', 'general')
  if (view === 'done' || view === 'request' || view === 'vms') {
    q = q.not('done_at', 'is', null).eq('closed_how', CLOSED_HOW[view])
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

/** Accounting tasks (Dana, Oct 16): open ones, finished ones, or those due in a date range (the calendar). */
export async function listAccountingTasks(organizationId: string, opts: { view: 'open' | 'done' | 'range'; from?: string; to?: string }): Promise<TaskRow[]> {
  let q = supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId).eq('area', 'accounting')
  if (opts.view === 'open') q = q.is('done_at', null).order('due_date', { ascending: true, nullsFirst: false }).order('created_at').limit(1000)
  else if (opts.view === 'done') q = q.not('done_at', 'is', null).order('done_at', { ascending: false }).limit(300)
  else q = q.gte('due_date', opts.from ?? '1900-01-01').lte('due_date', opts.to ?? '2999-12-31').order('due_date').limit(2000)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as TaskRow[]
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

// ---- pay-by tasks (Dana, Oct 14): the bill, "I paid it", and the pay pages ----
export interface PayBill { vendor: string | null; number: string | null; po: string | null; amount: number | null; discount: number | null; terms: string | null; due: string | null; order_id: string | null; paid: boolean; via: 'edenred' | 'billcom' }

export async function getPayBill(bill: 'wwd' | 'order' | 'billcom', id: string): Promise<PayBill | null> {
  if (bill === 'billcom') {
    const { data, error } = await supabase.from('billcom_bills').select('vendor_name, invoice_number, amount, due_amount, due_date, payment_status').eq('bill_id', id).maybeSingle()
    if (error) throw error
    if (!data) return null
    return { vendor: data.vendor_name, number: data.invoice_number, po: null, amount: data.due_amount ?? data.amount, discount: null, terms: null, due: data.due_date, order_id: null, paid: data.payment_status === 'PAID', via: 'billcom' }
  }
  if (bill === 'wwd') {
    const { data, error } = await supabase.from('wwd_invoices').select('wwd_vendor_name, vendor_invoice_number, po_number, amount, discount, terms, due_date, order_id, paid_date, sheet_paid_date, vendor:vendors!wwd_invoices_vendor_id_fkey(name)').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return null
    const v = data.vendor as unknown as { name: string } | null
    return { vendor: v?.name ?? data.wwd_vendor_name, number: data.vendor_invoice_number, po: data.po_number, amount: data.amount, discount: data.discount, terms: data.terms, due: data.due_date, order_id: data.order_id, paid: !!(data.paid_date || data.sheet_paid_date), via: 'edenred' }
  }
  const { data, error } = await supabase.from('orders').select('po_number, est_cost, final_cost, ar_due, ar_due_date, billing_route, paid_date, status, vendor:vendors!orders_vendor_id_fkey(name)').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const v = data.vendor as unknown as { name: string } | null
  return { vendor: v?.name ?? null, number: null, po: data.po_number, amount: data.final_cost ?? data.est_cost, discount: null, terms: data.ar_due, due: data.ar_due_date, order_id: id, paid: !!data.paid_date || data.status === 'paid', via: data.billing_route === 'worldwide' ? 'edenred' : 'billcom' }
}

/** "I paid it": the bill is marked paid now and the task is done (the payment import adds the number later). Admin. */
export async function markTaskPaid(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('task_mark_paid', { p_task: taskId })
  if (error) throw error
  tasksChanged()
}

export async function savePayLinks(organizationId: string, edenred: string | null, billcom: string | null): Promise<void> {
  const { error } = await supabase.rpc('org_set_pay_links', { p_org: organizationId, p_edenred: edenred, p_billcom: billcom })
  if (error) throw error
}
