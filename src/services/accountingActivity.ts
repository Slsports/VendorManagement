import { supabase } from '@/lib/supabase'
import type { AccountingDocument } from '@/types'

/** One line of an accounting activity feed: a date, plain words, and where it opens. */
export interface AccountingFeedItem {
  key: string
  at: string
  kind: 'email' | 'document' | 'task' | 'payment'
  text: string
  to?: string
  doc?: Pick<AccountingDocument, 'id' | 'file_name' | 'mime_type' | 'storage_path'>
}

const sortKey = (at: string) => (at.length === 10 ? `${at}T12:00:00` : at)
const money = (n: number | string | null | undefined) => (n == null ? '' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const first = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] || null

type EmailRow = { id: string; thread_id: string; direction: string; from_name: string | null; from_email: string | null; subject: string | null; received_at: string; has_attachments: boolean }
type TaskRow = { id: string; title: string; created_at: string; due_date: string | null; done_at: string | null; done_note: string | null; closed_how: string | null; thread_id: string | null }

function emailItem(e: EmailRow): AccountingFeedItem {
  const who = e.direction === 'out' ? 'We' : first(e.from_name) ?? e.from_email ?? 'They'
  const verb = e.direction === 'out' ? 'sent' : 'wrote'
  return { key: `e:${e.id}`, at: e.received_at, kind: 'email', text: `${who} ${verb}: ${e.subject || '(no subject)'}${e.has_attachments ? ' (with a file)' : ''}`, to: `/mail/${e.thread_id}` }
}

function taskItems(t: TaskRow): AccountingFeedItem[] {
  if (t.closed_how === 'mistake') return []
  const out: AccountingFeedItem[] = [{ key: `t:${t.id}:made`, at: t.created_at, kind: 'task', text: `Task made: ${t.title}${t.due_date ? ` (due ${new Date(`${t.due_date}T12:00:00`).toLocaleDateString()})` : ''}`, to: `/tasks?task=${t.id}` }]
  if (t.done_at) {
    const who = t.closed_how === 'vms' ? 'VMS closed' : 'Closed'
    out.push({ key: `t:${t.id}:done`, at: t.done_at, kind: 'task', text: `${who} the task "${t.title}"${t.done_note ? `: ${t.done_note.length > 140 ? `${t.done_note.slice(0, 140)}…` : t.done_note}` : ''}`, to: `/tasks?task=${t.id}` })
  }
  return out
}

function docItem(d: AccountingDocument): AccountingFeedItem {
  const at = d.doc_date || d.created_at
  const how = d.source === 'email' ? 'Filed from an email' : d.source === 'dropbox' ? 'Filed from Dropbox' : 'Filed'
  return { key: `d:${d.id}`, at, kind: 'document', text: `${how}: ${d.file_name}${d.personal ? ' (personal)' : ''}`, doc: { id: d.id, file_name: d.file_name, mime_type: d.mime_type, storage_path: d.storage_path } }
}

/**
 * Everything on one insurance policy (Dana, Nov 13): its papers, every task made and closed and why, the premiums and
 * payments by term, the autopays drafted and confirmed, and the emails those came from. Newest first.
 */
export async function policyActivityFeed(policyId: string, limit: number): Promise<AccountingFeedItem[]> {
  const [docs, tasks, terms, pays] = await Promise.all([
    supabase.from('accounting_documents').select('*').eq('policy_id', policyId).order('created_at', { ascending: false }).limit(limit * 2),
    supabase.from('tasks').select('id, title, created_at, due_date, done_at, done_note, closed_how, thread_id').eq('policy_id', policyId).order('created_at', { ascending: false }).limit(limit * 2),
    supabase.from('accounting_policy_terms').select('id, term_label, premium, paid_on, paid_amount, paid_from, paid_email_id, notes').eq('policy_id', policyId),
    supabase.from('autopay_payments').select('id, pay_on, amount, payee, email_id, confirmed_email_id, task_id').eq('policy_id', policyId).order('pay_on', { ascending: false }).limit(limit),
  ])
  for (const r of [docs, tasks, terms, pays]) if (r.error) throw r.error
  const emailIds = new Set<string>()
  for (const d of docs.data ?? []) if (d.email_id) emailIds.add(d.email_id)
  for (const t of terms.data ?? []) if (t.paid_email_id) emailIds.add(t.paid_email_id)
  for (const p of pays.data ?? []) { if (p.email_id) emailIds.add(p.email_id); if (p.confirmed_email_id) emailIds.add(p.confirmed_email_id) }
  const emails = emailIds.size
    ? await supabase.from('emails').select('id, thread_id, direction, from_name, from_email, subject, received_at, has_attachments').in('id', [...emailIds])
    : { data: [] as EmailRow[], error: null }
  if (emails.error) throw emails.error
  const thread = new Map((emails.data ?? []).map((e) => [e.id, e.thread_id]))
  const items: AccountingFeedItem[] = [
    ...(docs.data ?? []).map((d) => docItem(d as AccountingDocument)),
    ...(tasks.data ?? []).flatMap((t) => taskItems(t as TaskRow)),
    ...(emails.data ?? []).map((e) => emailItem(e as EmailRow)),
    ...(terms.data ?? []).flatMap((t) => {
      const out: AccountingFeedItem[] = []
      if (t.paid_on) out.push({ key: `term:${t.id}:paid`, at: t.paid_on, kind: 'payment', text: `Paid ${money(t.paid_amount ?? t.premium)} for ${t.term_label}${t.paid_from ? ` (${t.paid_from})` : ''}`, to: t.paid_email_id && thread.get(t.paid_email_id) ? `/mail/${thread.get(t.paid_email_id)}` : undefined })
      return out
    }),
    ...(pays.data ?? []).flatMap((p) => {
      const out: AccountingFeedItem[] = []
      out.push({ key: `pay:${p.id}`, at: p.pay_on, kind: 'payment', text: `Autopay of ${money(p.amount)} to ${p.payee} due to draft${p.confirmed_email_id ? ', confirmed by their email' : ''}`, to: p.email_id && thread.get(p.email_id) ? `/mail/${thread.get(p.email_id)}` : undefined })
      return out
    }),
  ]
  return items.sort((a, b) => (sortKey(a.at) < sortKey(b.at) ? 1 : sortKey(a.at) > sortKey(b.at) ? -1 : 0)).slice(0, limit)
}

/**
 * Everything with one accounting company (Dana, Nov 13): the emails in and out, the papers filed from them, and the
 * tasks those emails made and how they closed. Newest first.
 */
export async function contactActivityFeed(organizationId: string, contactId: string, limit: number): Promise<AccountingFeedItem[]> {
  const contact = await supabase.from('accounting_contacts').select('id, company').eq('id', contactId).maybeSingle()
  if (contact.error) throw contact.error
  const threads = await supabase.from('email_threads').select('id').eq('organization_id', organizationId).eq('accounting_contact_id', contactId).order('last_message_at', { ascending: false }).limit(200)
  if (threads.error) throw threads.error
  const threadIds = (threads.data ?? []).map((t) => t.id)
  const company = contact.data?.company?.trim() ?? ''
  const [emails, docs, tasks] = await Promise.all([
    threadIds.length
      ? supabase.from('emails').select('id, thread_id, direction, from_name, from_email, subject, received_at, has_attachments').in('thread_id', threadIds).order('received_at', { ascending: false }).limit(limit * 2)
      : Promise.resolve({ data: [] as EmailRow[], error: null }),
    company
      ? supabase.from('accounting_documents').select('*').eq('organization_id', organizationId).or(`contact_id.eq.${contactId},party.ilike.${company.replace(/[,()]/g, ' ')}`).order('created_at', { ascending: false }).limit(limit * 2)
      : supabase.from('accounting_documents').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }).limit(limit * 2),
    threadIds.length
      ? supabase.from('tasks').select('id, title, created_at, due_date, done_at, done_note, closed_how, thread_id').in('thread_id', threadIds).order('created_at', { ascending: false }).limit(limit * 2)
      : Promise.resolve({ data: [] as TaskRow[], error: null }),
  ])
  for (const r of [emails, docs, tasks]) if (r.error) throw r.error
  const items: AccountingFeedItem[] = [
    ...(emails.data ?? []).map((e) => emailItem(e as EmailRow)),
    ...(docs.data ?? []).map((d) => docItem(d as AccountingDocument)),
    ...(tasks.data ?? []).flatMap((t) => taskItems(t as TaskRow)),
  ]
  return items.sort((a, b) => (sortKey(a.at) < sortKey(b.at) ? 1 : sortKey(a.at) > sortKey(b.at) ? -1 : 0)).slice(0, limit)
}
