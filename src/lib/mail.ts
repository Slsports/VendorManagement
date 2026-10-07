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
