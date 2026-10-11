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

export const SHIP_STATUS_LABELS: Record<'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception', { label: string; tone: 'success' | 'info' | 'danger' }> = {
  picked_up: { label: 'Picked up', tone: 'info' },
  in_transit: { label: 'In transit', tone: 'info' },
  out_for_delivery: { label: 'Out for delivery', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  exception: { label: 'Shipping problem', tone: 'danger' },
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

/** "wfsports.com" → "Wfsports": a starting point for a new vendor's name; the person corrects it. */
export function nameFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean)
  const label = parts.length >= 3 && ['co', 'com'].includes(parts[parts.length - 2]!) ? parts[parts.length - 3]! : parts[parts.length - 2] ?? parts[0] ?? ''
  return label.split(/[-_]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
}

/**
 * The new-vendor form, filled from an email: name from the sender's company domain (or their From name for
 * free mail), the address as the orders email, the domain as the website. After saving, the email (or every
 * email from that sender) is filed to the new vendor.
 */
/** A new vendor's name, email and website guessed from a sender (the name from a company domain, never a free-mail one). */
export function newVendorPrefill(p: { email?: string | null; displayName?: string | null; senderKey?: string | null; isDomain?: boolean }): { name: string; email: string; website: string } {
  const address = p.email ?? (p.senderKey && !p.isDomain ? p.senderKey : null)
  const domain = p.isDomain && p.senderKey ? p.senderKey : address ? address.split('@')[1] ?? '' : ''
  const free = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|comcast|att|sbcglobal|verizon)\./.test(domain)
  const name = free ? (p.displayName ?? '') : domain ? nameFromDomain(domain) : (p.displayName ?? '')
  return { name, email: address ?? '', website: domain && !free ? domain : '' }
}

export function newVendorFromMailUrl(vendorsRoute: string, p: { email?: string | null; displayName?: string | null; senderKey?: string | null; isDomain?: boolean; emailId?: string; senderId?: string }): string {
  const q = new URLSearchParams()
  const pre = newVendorPrefill(p)
  if (pre.name) q.set('name', pre.name)
  if (pre.email) q.set('email', pre.email)
  if (pre.website) q.set('website', pre.website)
  if (p.emailId) q.set('from_email', p.emailId)
  if (p.senderId) q.set('from_sender', p.senderId)
  return `${vendorsRoute}/new?${q.toString()}`
}

/**
 * Signature logos and pasted pictures (image001.png, ~WRD0249.jpg, attachment-9.png, small pictures):
 * folded away under "+N images" so the real files show first.
 */
export function isInlineImage(a: { file_name: string; mime_type: string | null; size: number | null }): boolean {
  const pic = /^image\//i.test(a.mime_type ?? '') || /\.(png|jpe?g|gif|bmp|webp)$/i.test(a.file_name)
  if (!pic) return false
  return /^(image|img|attachment|outlook|logo|signature|banner)[-_ ]?\d*\.[a-z]+$/i.test(a.file_name) || /^~WRD\d+/i.test(a.file_name) || /^\d+ \(\d+\)\.[a-z]+$/i.test(a.file_name) || (a.size ?? 0) < 40_000
}

const QUOTE_START = [
  /^On .{4,200}wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{3,}\s*Forwarded message\s*-{3,}/im,
  /^_{10,}\s*$/m,
  /^From: .+\r?\n(Sent|Date): /m,
  /^-{10,}\s*$/m,
  /^>/m,
]

/** What the person wrote, and the quoted earlier emails below it (folded away in the thread view). */
export function splitQuoted(text: string): { fresh: string; quoted: string } {
  let cut = text.length
  for (const re of QUOTE_START) {
    const m = re.exec(text)
    if (m && m.index < cut) cut = m.index
  }
  const fresh = text.slice(0, cut).trimEnd()
  // Nothing of its own above the quote (a bare forward): show it all.
  if (fresh.replace(/\s+/g, '').length < 2) return { fresh: text, quoted: '' }
  return { fresh, quoted: text.slice(cut).trim() }
}

/**
 * Where an order being worked on stands (Dana, Oct 8): Completed when marked done; Needs an answer when the
 * vendor wrote and nobody has answered (or set it to Working since); Working when set by hand; Waiting on
 * rep when we wrote last.
 */
export function workingStatus(t: { status: EmailThreadStatus; working_done_at: string | null; working_mark_at: string | null; last_in_at: string | null }): 'needs' | 'waiting' | 'working' | 'completed' {
  if (t.working_done_at) return 'completed'
  const vendorWroteSince = !t.working_mark_at || (!!t.last_in_at && t.last_in_at > t.working_mark_at)
  if (t.status === 'waiting_on_us' && vendorWroteSince) return 'needs'
  if (t.working_mark_at) return 'working'
  return t.status === 'waiting_on_vendor' ? 'waiting' : 'working'
}

export const WORKING_STATUS_LABELS: Record<'needs' | 'waiting' | 'working' | 'completed', { label: string; tone: 'warning' | 'info' | 'brand' | 'success' }> = {
  needs: { label: 'Needs an answer', tone: 'warning' },
  waiting: { label: 'Waiting on rep', tone: 'info' },
  working: { label: 'Working', tone: 'brand' },
  completed: { label: 'Completed', tone: 'success' },
}

/** On the Team page, waiting longer than this turns red: three days, to allow for days off (Dana, Oct 8). */
export const LATE_MS = 3 * 86_400_000

// ---- all mail with one person (Dana, Oct 10) ----
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'cox.net', 'charter.net', 'protonmail.com', 'proton.me'])
export const emailDomain = (email: string) => email.trim().toLowerCase().split('@')[1] ?? ''
/** Gmail, Yahoo and the like: "everyone at this company" makes no sense there. */
export const isFreeMail = (email: string) => FREE_MAIL.has(emailDomain(email))
/** Our own addresses (orders@, dana@…): clicking them would list everything. */
export const isOurAddress = (email: string | null | undefined) => !!email && emailDomain(email) === 'shaverlakesports.com'
/** The page listing every email with this address. */
export const mailWithUrl = (route: string, email: string, company = false) => `${route}?email=${encodeURIComponent(email.trim().toLowerCase())}${company ? '&company=1' : ''}`

// ---- links in plain-text mail (Dana, Oct 11: "links are not live to click on") ----
export type TextPart = { kind: 'text' | 'url' | 'email'; text: string; href?: string }
const LINK = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+\.[^\s<>"]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

/** Plain text split into text, web addresses and email addresses. Trailing punctuation stays text. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(LINK)) {
    let hit = m[0]
    const trail = /[.,;:!?)\]}>'"]+$/.exec(hit)?.[0] ?? ''
    if (trail) hit = hit.slice(0, -trail.length)
    const at = m.index!
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) })
    if (hit.includes('@') && !/^(https?:|www\.)/i.test(hit)) parts.push({ kind: 'email', text: hit, href: `mailto:${hit}` })
    else parts.push({ kind: 'url', text: hit, href: /^www\./i.test(hit) ? `https://${hit}` : hit })
    last = at + hit.length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
