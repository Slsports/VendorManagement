import type { EmailThreadStatus } from '@/types'

export type ThreadState = 'needs' | 'waiting' | 'no_answer' | 'handled'

/** Where a thread stands for the person who owns it. Waiting past the follow-up date reads as "No answer yet". */
export function threadState(t: { status: EmailThreadStatus; follow_up_at: string | null }, now = Date.now()): ThreadState {
  if (t.status === 'handled') return 'handled'
  if (t.status === 'waiting_on_us') return 'needs'
  return t.follow_up_at && new Date(t.follow_up_at).getTime() < now ? 'no_answer' : 'waiting'
}

export const THREAD_STATE_LABELS: Record<ThreadState, { label: string; tone: 'warning' | 'info' | 'danger' | 'neutral' }> = {
  needs: { label: 'Needs an answer', tone: 'warning' },
  waiting: { label: 'Waiting on vendor', tone: 'info' },
  no_answer: { label: 'No answer yet', tone: 'danger' },
  handled: { label: 'Handled', tone: 'neutral' },
}

/** "3 days", "5 hours": how long something has waited. */
export function waited(since: string | null, now = Date.now()): string {
  if (!since) return ''
  const mins = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000))
  if (mins < 60) return `${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Open the same conversation in Gmail (the backup, when something odd happens). */
export function gmailThreadUrl(mailbox: string, gmailThreadId: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${gmailThreadId}`
}

/** "Amy Lee" or the address. */
export function senderLabel(m: { from_name: string | null; from_email: string | null; direction?: string } | null): string {
  if (!m) return ''
  return m.from_name || m.from_email || ''
}

// ---- drafts for reply, reply all, forward and follow-up --------------------------------
interface DraftEmail { id: string; direction: 'in' | 'out' | 'internal'; from_email: string | null; from_name: string | null; to_emails: string[]; cc_emails: string[]; subject: string | null; body_text: string | null; snippet: string | null; received_at: string }
interface DraftThread { id: string; vendor_id: string | null; subject: string | null }

export function prefixSubject(subject: string | null, prefix: 'Re' | 'Fwd'): string {
  const s = (subject ?? '').trim()
  const re = prefix === 'Re' ? /^re:/i : /^(fwd?|fw):/i
  return re.test(s) ? s : `${prefix}: ${s}`.trim()
}

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** The earlier message under a reply, quoted the way Gmail does it. */
export function quote(e: DraftEmail): string {
  const text = (e.body_text || e.snippet || '').slice(0, 6000)
  return `\n\nOn ${when(e.received_at)}, ${e.from_name || e.from_email} wrote:\n${text.split('\n').map((l) => `> ${l}`).join('\n')}`
}

const uniq = (list: string[], minus: string[]) => {
  const skip = new Set(minus.map((a) => a.toLowerCase()))
  const out: string[] = []
  for (const a of list) {
    const k = a.toLowerCase()
    if (!skip.has(k) && !out.includes(k)) out.push(k)
  }
  return out
}

export function replyDraft(t: DraftThread, e: DraftEmail, mailbox: string, all: boolean) {
  const to = e.direction === 'in' && e.from_email ? [e.from_email] : uniq(e.to_emails, [mailbox])
  const cc = all ? uniq([...e.to_emails, ...e.cc_emails, ...(e.direction === 'in' ? [] : [])], [mailbox, ...to]) : []
  return { to, cc, subject: prefixSubject(e.subject ?? t.subject, 'Re'), body: quote(e), thread_id: t.id, reply_to_email_id: e.id, vendor_id: t.vendor_id }
}

export function forwardDraft(t: DraftThread, e: DraftEmail, attachmentCount: number) {
  const header = ['---------- Forwarded message ----------', `From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}`, `Date: ${when(e.received_at)}`, `Subject: ${e.subject ?? ''}`, `To: ${e.to_emails.join(', ')}`].join('\n')
  return {
    to: [], subject: prefixSubject(e.subject ?? t.subject, 'Fwd'), body: `\n\n${header}\n\n${(e.body_text || e.snippet || '').slice(0, 20000)}`,
    forward_email_id: e.id, vendor_id: t.vendor_id,
    note: attachmentCount ? `The ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} on the original go${attachmentCount === 1 ? 'es' : ''} along.` : undefined,
  }
}

/** "Just following up": a reply to our own last message, to the same people. */
export function followUpDraft(t: DraftThread, lastOut: DraftEmail) {
  return {
    to: lastOut.to_emails, cc: lastOut.cc_emails, subject: prefixSubject(lastOut.subject ?? t.subject, 'Re'),
    body: `Hi,\n\nJust following up on my email below. Could you let me know where this stands?\n\nThank you${quote(lastOut)}`,
    thread_id: t.id, reply_to_email_id: lastOut.id, vendor_id: t.vendor_id,
  }
}
