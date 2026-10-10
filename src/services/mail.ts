import { supabase } from '@/lib/supabase'
import type { Email, EmailAttachment, EmailSenderKind, EmailThreadStatus, MailAccount, MailView } from '@/types'
import { TEST_LOGIN_PATTERN } from '@/services/reviews'

export interface NamedRef { id: string; name: string }
export interface VendorRef extends NamedRef { is_active: boolean }

// Pickers on many review cards share one load per page visit.
const cache = new Map<string, Promise<NamedRef[]>>()
function once<T extends NamedRef>(key: string, load: () => Promise<T[]>): Promise<T[]> {
  if (!cache.has(key)) cache.set(key, load().catch((e) => { cache.delete(key); throw e }))
  return cache.get(key)! as Promise<T[]>
}

/** Forget the cached picker lists after a vendor or rep group is added, renamed or reactivated. */
export function clearPickerCache() {
  cache.clear()
}

/** Every vendor, id, name and active flag, A–Z. Pickers show the inactive ones grayed out. */
export function listVendorNames(organizationId: string): Promise<VendorRef[]> {
  return once(`v:${organizationId}`, async () => {
    const out: VendorRef[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('vendors').select('id, name, is_active').eq('organization_id', organizationId).is('merged_into_id', null).order('name').range(from, from + 999)
      if (error) throw error
      out.push(...(data ?? []))
      if (!data || data.length < 1000) return out
    }
  })
}

export function listRepGroupNames(organizationId: string): Promise<NamedRef[]> {
  return once(`r:${organizationId}`, async () => {
    const { data, error } = await supabase.from('rep_groups').select('id, name').eq('organization_id', organizationId).eq('is_active', true).order('name')
    if (error) throw error
    return data ?? []
  })
}

/** Answer a sender proposal. Returns how many emails were linked. */
export async function resolveEmailSender(senderId: string, kind: Exclude<EmailSenderKind, 'unknown' | 'carrier'>, vendorId?: string | null, repGroupId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('resolve_email_sender', { p_sender: senderId, p_kind: kind, p_vendor: vendorId ?? null, p_rep_group: repGroupId ?? null })
  if (error) throw error
  return data ?? 0
}

export async function setEmailVendor(emailId: string, vendorId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_email_vendor', { p_email: emailId, p_vendor: vendorId })
  if (error) throw error
}

export async function assignEmailThread(threadId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_email_thread', { p_thread: threadId, p_profile: profileId })
  if (error) throw error
}

export async function setEmailThreadStatus(threadId: string, status: EmailThreadStatus): Promise<void> {
  const { error } = await supabase.rpc('set_email_thread_status', { p_thread: threadId, p_status: status })
  if (error) throw error
}

export interface MailStatus extends MailAccount {
  emails: number
  matched: number
  senders_waiting: number
}

export async function getMailStatus(organizationId: string): Promise<MailStatus | null> {
  const { data, error } = await supabase.from('mail_accounts').select('*').eq('organization_id', organizationId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error: e } = await q
    if (e) throw e
    return n ?? 0
  }
  const [emails, matched, senders] = await Promise.all([
    count(supabase.from('emails').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)),
    count(supabase.from('emails').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).not('vendor_id', 'is', null)),
    count(supabase.from('email_senders').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('kind', 'unknown')),
  ])
  return { ...data, emails, matched, senders_waiting: senders }
}

export async function setFollowUpDays(organizationId: string, days: number): Promise<void> {
  const { error } = await supabase.from('mail_accounts').update({ follow_up_days: days }).eq('organization_id', organizationId)
  if (error) throw error
}

/** Ask the sync to run now (signed-in admin, manager or buyer). */
export async function syncMailNow(): Promise<void> {
  const { error } = await supabase.functions.invoke('gmail-sync', { body: {} })
  if (error) throw error
}

// ---- threads -------------------------------------------------------------------
export type ShipStatus = 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception'

export interface ThreadRow {
  id: string
  gmail_thread_id: string
  subject: string | null
  status: EmailThreadStatus
  view: MailView
  vendor_id: string | null
  owner_id: string | null
  message_count: number
  last_message_at: string | null
  follow_up_at: string | null
  /** From a carrier's status update (Dana, Oct 8): shown as Delivered, In transit… */
  ship_status?: ShipStatus | null
  /** The Deleted tab: when and by whom. */
  deleted_at?: string | null
  deleted_by_person?: { full_name: string } | null
  vendor: { id: string; name: string } | null
  owner: { id: string; full_name: string } | null
  /** The newest message: who, a line of it, and whether it came in or went out. */
  last: { from_name: string | null; from_email: string | null; snippet: string | null; direction: 'in' | 'out' | 'internal'; has_attachments: boolean } | null
}

export interface ThreadFilters {
  /** Needs attention, Offers & catalogs, Freight (carrier mail, Trevor's), or everything. */
  view?: MailView | 'freight' | 'all'
  /** 'all' | 'mine' | 'none' | a profile id */
  who: string
  /** needs: waiting on us · waiting · no_answer (waiting past the follow-up date) · handled · open (not handled) · all */
  status: 'needs' | 'waiting' | 'no_answer' | 'handled' | 'open' | 'all' | 'deleted' | 'snoozed'
  vendorId?: string
  unmatched?: boolean
  q?: string
  /** Snooze (Dana, Oct 9): leave these out (snoozed by me), or show only these (the Snoozed tab). */
  hideIds?: string[]
  onlyIds?: string[]
}

const THREAD_SELECT = 'id, gmail_thread_id, subject, status, view, vendor_id, owner_id, message_count, last_message_at, follow_up_at, ship_status, vendor:vendors(id, name), owner:profiles!email_threads_owner_id_fkey(id, full_name)'

async function withLastMessage(rows: Omit<ThreadRow, 'last'>[]): Promise<ThreadRow[]> {
  if (!rows.length) return []
  const last = new Map<string, ThreadRow['last']>()
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id)
    const { data, error } = await supabase.from('emails').select('thread_id, from_name, from_email, snippet, direction, has_attachments, received_at').in('thread_id', ids).order('received_at', { ascending: false })
    if (error) throw error
    for (const e of data ?? []) if (!last.has(e.thread_id)) last.set(e.thread_id, e)
  }
  return rows.map((r) => ({ ...r, last: last.get(r.id) ?? null }))
}

/** Conversations this person has snoozed that are still hidden. */
async function snoozedThreadIds(profileId: string): Promise<string[]> {
  const { data, error } = await supabase.from('snoozes').select('thread_id').eq('profile_id', profileId).not('thread_id', 'is', null).gt('until', new Date().toISOString()).limit(1000)
  if (error) throw error
  return (data ?? []).map((r) => r.thread_id!)
}

/** Threads for the Mail page, newest first, at most `limit`. */
/** "Mine": what the person owns, plus all freight for those who also see freight (Dana while Trevor is new). */
const mine = (me: string, seesFreight?: boolean) => (seesFreight ? `owner_id.eq.${me},carrier_id.not.is.null` : `owner_id.eq.${me}`)

export async function listThreads(organizationId: string, me: string | undefined, f: ThreadFilters, limit = 300, seesFreight = false): Promise<ThreadRow[]> {
  let q = supabase.from('email_threads').select(f.status === 'deleted' ? `${THREAD_SELECT}, deleted_at, deleted_by_person:profiles!email_threads_deleted_by_fkey(full_name)` : THREAD_SELECT).eq('organization_id', organizationId).not('last_message_at', 'is', null)
  q = f.status === 'deleted' ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
  if (f.who === 'mine' && me) q = q.or(mine(me, seesFreight))
  else if (f.who === 'none') q = q.is('owner_id', null)
  else if (f.who !== 'all') q = q.eq('owner_id', f.who)
  if (f.status === 'needs') q = q.eq('status', 'waiting_on_us')
  else if (f.status === 'waiting') q = q.eq('status', 'waiting_on_vendor')
  else if (f.status === 'no_answer') q = q.eq('status', 'waiting_on_vendor').lt('follow_up_at', new Date().toISOString())
  else if (f.status === 'handled') q = q.eq('status', 'handled')
  else if (f.status === 'open') q = q.neq('status', 'handled')
  if (f.view === 'freight') q = q.not('carrier_id', 'is', null)
  else if (f.view && f.view !== 'all') q = q.eq('view', f.view)
  if (f.vendorId) q = q.or(`vendor_id.eq.${f.vendorId},tagged_vendor_ids.cs.{${f.vendorId}}`)
  if (f.unmatched) q = q.is('vendor_id', null)
  if (f.hideIds?.length) q = q.not('id', 'in', `(${f.hideIds.join(',')})`)
  if (f.onlyIds) q = q.in('id', f.onlyIds.length ? f.onlyIds : ['00000000-0000-0000-0000-000000000000'])
  if (f.q?.trim()) q = q.ilike('subject', `%${f.q.trim().replace(/[%_]/g, '')}%`)
  const { data, error } = await q.order('last_message_at', { ascending: false }).limit(limit)
  if (error) throw error
  return withLastMessage((data ?? []) as unknown as Omit<ThreadRow, 'last'>[])
}

/** A vendor's threads, newest first. */
export function listVendorThreads(organizationId: string, vendorId: string, limit = 50): Promise<ThreadRow[]> {
  return listThreads(organizationId, undefined, { who: 'all', status: 'all', vendorId }, limit)
}

/** What is waiting on this person: vendor replies to answer, and sent mail with no answer past the follow-up date. */
/** Dashboard: replies waiting on `me` (everyone's when null), and mail with no answer past its follow-up date. */
export async function listMailForMe(organizationId: string, me: string | null, seesFreight = false): Promise<{ needs: ThreadRow[]; noAnswer: ThreadRow[] }> {
  const now = new Date().toISOString()
  let a = supabase.from('email_threads').select(THREAD_SELECT).eq('organization_id', organizationId).is('deleted_at', null).eq('view', 'attention').eq('status', 'waiting_on_us')
  let b = supabase.from('email_threads').select(THREAD_SELECT).eq('organization_id', organizationId).is('deleted_at', null).eq('status', 'waiting_on_vendor').lt('follow_up_at', now)
  if (me) { a = a.or(mine(me, seesFreight)); b = b.or(mine(me, seesFreight)) }
  const hidden = me ? await snoozedThreadIds(me) : []
  if (hidden.length) { a = a.not('id', 'in', `(${hidden.join(',')})`); b = b.not('id', 'in', `(${hidden.join(',')})`) }
  const [ra, rb] = await Promise.all([a.order('last_message_at', { ascending: false }).limit(50), b.order('follow_up_at', { ascending: true }).limit(50)])
  if (ra.error) throw ra.error
  if (rb.error) throw rb.error
  const [needs, noAnswer] = await Promise.all([withLastMessage((ra.data ?? []) as unknown as Omit<ThreadRow, 'last'>[]), withLastMessage((rb.data ?? []) as unknown as Omit<ThreadRow, 'last'>[])])
  return { needs, noAnswer }
}

/** The number on Mail in the side menu: threads waiting on this person. */
export async function countMailForMe(organizationId: string, me: string, seesFreight = false): Promise<number> {
  const now = new Date().toISOString()
  const who = seesFreight ? `or(owner_id.eq.${me},carrier_id.not.is.null)` : `owner_id.eq.${me}`
  const hidden = await snoozedThreadIds(me)
  let q = supabase.from('email_threads').select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId).is('deleted_at', null).eq('view', 'attention')
    .or(`and(${who},status.eq.waiting_on_us),and(${who},status.eq.waiting_on_vendor,follow_up_at.lt.${now})`)
  if (hidden.length) q = q.not('id', 'in', `(${hidden.join(',')})`)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export interface ThreadDetail {
  thread: ThreadRow & { working_by?: string | null; working_done_at?: string | null; carrier_id?: string | null; art_status?: 'waiting' | 'needs_changes' | 'approved' | null; art_since?: string | null; art_note?: string | null }
  emails: (Email & { attachments: EmailAttachment[] })[]
}

export async function getThread(threadId: string): Promise<ThreadDetail | null> {
  const { data: t, error } = await supabase.from('email_threads').select(`${THREAD_SELECT}, working_by, working_done_at, carrier_id, art_status, art_since, art_note`).eq('id', threadId).maybeSingle()
  if (error) throw error
  if (!t) return null
  const { data: emails, error: e2 } = await supabase.from('emails').select('*, attachments:email_attachments(*)').eq('thread_id', threadId).order('received_at', { ascending: true })
  if (e2) throw e2
  const list = (emails ?? []) as unknown as ThreadDetail['emails']
  const lastE = list[list.length - 1]
  return {
    thread: { ...(t as unknown as Omit<ThreadRow, 'last'>), last: lastE ? { from_name: lastE.from_name, from_email: lastE.from_email, snippet: lastE.snippet, direction: lastE.direction, has_attachments: lastE.has_attachments } : null },
    emails: list,
  }
}

export async function getMailbox(organizationId: string): Promise<string | null> {
  const { data, error } = await supabase.from('mail_accounts').select('mailbox').eq('organization_id', organizationId).maybeSingle()
  if (error) throw error
  return data?.mailbox ?? null
}

// ---- sending and reading through Gmail ----------------------------------------------
export interface SendEmailInput {
  thread_id?: string | null
  reply_to_email_id?: string | null
  forward_email_id?: string | null
  vendor_id?: string | null
  to: string[]
  cc?: string[]
  subject: string
  body: string
  attachments?: { name: string; mime: string; base64: string }[]
  vendor_link_ids?: string[]
}

async function functionError(error: unknown): Promise<Error> {
  // supabase-js wraps a non-2xx answer; the function's own message is in the response body.
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.error) return new Error(body.error)
    } catch { /* fall through */ }
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** Send from orders@ as the signed-in person; returns the conversation it landed in. */
export async function sendEmail(input: SendEmailInput): Promise<{ thread_id: string; email_id: string }> {
  const { data, error } = await supabase.functions.invoke('gmail-send', { body: input })
  if (error) throw await functionError(error)
  return data
}

/** The formatted (HTML) version of a message, fetched from Gmail. */
export async function fetchEmailHtml(emailId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('gmail-read', { body: { action: 'html', email_id: emailId } })
  if (error) throw await functionError(error)
  return (data as { html: string }).html
}

/** An attachment's bytes from Gmail, for the in-app viewer and downloads. */
export async function fetchAttachment(attachmentId: string): Promise<Blob> {
  // A plain fetch, not functions.invoke: invoke would read a PDF as text and spoil it.
  const { data: s } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${s.session?.access_token ?? ''}` },
    body: JSON.stringify({ action: 'attachment', attachment_id: attachmentId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Could not open the attachment (${res.status})`)
  }
  return res.blob()
}

/** Copy an attachment into the vendor's documents (folder by kind, and the year folder). */
export async function fileAttachmentToVendor(attachmentId: string, vendorId: string, kind: string, label?: string, year?: number): Promise<void> {
  const { error } = await supabase.functions.invoke('gmail-read', { body: { action: 'file', attachment_id: attachmentId, vendor_id: vendorId, kind, label, doc_year: year } })
  if (error) throw await functionError(error)
}

/** Everyone's signature, for Settings > Mail (admins edit them). */
export async function listSignatures(organizationId: string): Promise<{ id: string; full_name: string; email: string; email_signature: string | null }[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, email_signature').eq('organization_id', organizationId).eq('is_active', true).not('email', 'ilike', TEST_LOGIN_PATTERN).order('full_name')
  if (error) throw error
  return data ?? []
}

export async function saveSignature(profileId: string, signature: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ email_signature: signature.trim() || null }).eq('id', profileId)
  if (error) throw error
}

export async function linkThreadToOrder(threadId: string, orderId: string | null): Promise<void> {
  const { error } = await supabase.rpc('link_email_thread_order', { p_thread: threadId, p_order: orderId })
  if (error) throw error
}

/** Move a conversation between Needs attention and Offers & catalogs; VMS learns the sender. Returns how many of their other emails moved too. */
export async function setThreadView(threadId: string, view: MailView): Promise<number> {
  const { data, error } = await supabase.rpc('set_email_thread_view', { p_thread: threadId, p_view: view, p_teach: true })
  if (error) throw error
  return data ?? 0
}

/** Settings > Mail: sort every email again with what VMS knows now. Returns how many changed. */
export async function reclassifyAllMail(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('mail_reclassify_all', { p_org: organizationId })
  if (error) throw error
  return data ?? 0
}

export interface AiUsageSummary { cost: number; calls: number; items: number; byPurpose: Record<string, { cost: number; items: number }> }

/** What Claude cost this calendar month, for Settings > Mail. */
export async function getAiUsageThisMonth(organizationId: string): Promise<AiUsageSummary> {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabase.from('ai_usage').select('purpose, cost_usd, items').eq('organization_id', organizationId).gte('created_at', start.toISOString()).limit(10000)
  if (error) throw error
  const out: AiUsageSummary = { cost: 0, calls: 0, items: 0, byPurpose: {} }
  for (const r of data ?? []) {
    out.cost += Number(r.cost_usd)
    out.calls += 1
    out.items += r.items
    const p = (out.byPurpose[r.purpose] ??= { cost: 0, items: 0 })
    p.cost += Number(r.cost_usd)
    p.items += r.items
  }
  return out
}

// ---- one email, many vendors ---------------------------------------------------------------
export interface ThreadTag { email_id: string; vendor_id: string; name: string; how: 'auto' | 'ai' | 'manual' }

/** The vendors a conversation's emails are tagged to, one entry per vendor. */
export async function listThreadTags(threadId: string): Promise<ThreadTag[]> {
  const { data, error } = await supabase.from('email_vendor_tags').select('email_id, vendor_id, how, vendors(name), emails!inner(thread_id)').eq('emails.thread_id', threadId)
  if (error) throw error
  const seen = new Map<string, ThreadTag>()
  for (const r of (data ?? []) as unknown as { email_id: string; vendor_id: string; how: ThreadTag['how']; vendors: { name: string } | null }[]) {
    if (!seen.has(r.vendor_id)) seen.set(r.vendor_id, { email_id: r.email_id, vendor_id: r.vendor_id, how: r.how, name: r.vendors?.name ?? 'Vendor' })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function tagEmailVendor(emailId: string, vendorId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('tag_email_vendor', { p_email: emailId, p_vendor: vendorId, p_on: on })
  if (error) throw error
}

// ---- a sender's emails, one by one, in the review queue ------------------------------------
export interface SenderEmail {
  id: string; thread_id: string; subject: string | null; from_name: string | null; from_email: string | null; received_at: string
  snippet: string | null; has_attachments: boolean; vendor_id: string | null; disposition: 'marketing' | 'other' | null
  vendors: { name: string } | null
}

export async function listSenderEmails(senderId: string): Promise<SenderEmail[]> {
  const { data, error } = await supabase.from('emails')
    .select('id, thread_id, subject, from_name, from_email, received_at, snippet, has_attachments, vendor_id, disposition, vendors:vendors!emails_vendor_id_fkey(name)')
    .eq('sender_id', senderId).order('received_at', { ascending: false }).limit(500)
  if (error) throw error
  return (data ?? []) as unknown as SenderEmail[]
}

/** The whole message, for reading it in the review panel. */
export async function getEmailBody(emailId: string): Promise<{ body_text: string | null; attachments: { id: string; file_name: string }[] }> {
  const { data, error } = await supabase.from('emails').select('body_text, attachments:email_attachments(id, file_name)').eq('id', emailId).single()
  if (error) throw error
  return data as unknown as { body_text: string | null; attachments: { id: string; file_name: string }[] }
}

/** Handle some of a sender's emails: file them to a vendor, or mark them Marketing or Other. */
export async function reviewSenderEmails(senderId: string, emailIds: string[], action: 'vendor' | 'marketing' | 'other', vendorId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('review_sender_emails', { p_sender: senderId, p_email_ids: emailIds, p_action: action, p_vendor: vendorId ?? null })
  if (error) throw error
  return data ?? 0
}


/** "Does this need an answer?" card (review queue): yes keeps it in Needs an answer, no handles it. */
export async function answerMailReply(itemId: string, needsAnswer: boolean): Promise<void> {
  const { error } = await supabase.rpc('answer_mail_reply', { p_item: itemId, p_needs_answer: needsAnswer })
  if (error) throw error
}

export type WorkingStatus = 'needs' | 'waiting' | 'working' | 'completed'

export interface WorkingRow extends ThreadRow {
  working_by: string | null
  working_since: string | null
  working_mark_at: string | null
  working_done_at: string | null
  last_in_at: string | null
  last_out_at: string | null
  working_person: { id: string; full_name: string } | null
}

/** Conversations flagged "Working on order" by `who` (everyone's when null). Completed ones only when asked. */
export async function listWorkingOrders(organizationId: string, who: string | null, includeCompleted = false): Promise<WorkingRow[]> {
  let q = supabase.from('email_threads')
    .select(`${THREAD_SELECT}, working_by, working_since, working_mark_at, working_done_at, last_in_at, last_out_at, working_person:profiles!email_threads_working_by_fkey(id, full_name)`)
    .eq('organization_id', organizationId).is('deleted_at', null).not('working_by', 'is', null)
  if (who) q = q.eq('working_by', who)
  if (!includeCompleted) q = q.is('working_done_at', null)
  const { data, error } = await q.order('last_message_at', { ascending: false }).limit(200)
  if (error) throw error
  return withLastMessage((data ?? []) as unknown as Omit<ThreadRow, 'last'>[]) as Promise<WorkingRow[]>
}

export async function setWorkingOrder(threadId: string, action: 'flag' | 'working' | 'complete' | 'reopen' | 'unflag'): Promise<void> {
  const { error } = await supabase.rpc('set_working_order', { p_thread: threadId, p_action: action })
  if (error) throw error
}

/** Delete conversations: to Gmail's Trash for orders@ (30 days) and out of VMS's lists. Restore brings them back. */
export async function trashThreads(threadIds: string[], restore = false): Promise<number> {
  const { data, error } = await supabase.functions.invoke('gmail-read', { body: { action: restore ? 'untrash' : 'trash', thread_ids: threadIds } })
  if (error) throw await functionError(error)
  return (data as { count: number }).count
}

// ---- artwork approvals (Dana, Oct 10) ----
export type ArtStatus = 'waiting' | 'needs_changes' | 'approved'
export interface ArtRow { id: string; subject: string | null; art_status: ArtStatus; art_since: string | null; art_note: string | null; vendor: { id: string; name: string } | null; owner: { full_name: string } | null }

/** Conversations with artwork waiting on our approval (or waiting on a new proof after changes), oldest first. */
export async function listArtApprovals(organizationId: string): Promise<ArtRow[]> {
  const { data, error } = await supabase.from('email_threads')
    .select('id, subject, art_status, art_since, art_note, vendor:vendors(id, name), owner:profiles!email_threads_owner_id_fkey(full_name)')
    .eq('organization_id', organizationId).is('deleted_at', null).in('art_status', ['waiting', 'needs_changes'])
    .order('art_since', { ascending: true, nullsFirst: false }).limit(50)
  if (error) throw error
  return (data ?? []) as unknown as ArtRow[]
}

/** Approved / Needs changes / Artwork to approve, or 'none' when it is not an artwork approval. */
export async function setArtStatus(threadId: string, status: ArtStatus | 'none'): Promise<void> {
  const { error } = await supabase.rpc('set_art_status', { p_thread: threadId, p_status: status })
  if (error) throw error
}
