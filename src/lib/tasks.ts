// Tasks (Dana, Oct 11): repeat choices, due-date wording and the date helpers the task screens share.
import type { RepeatUnit } from '@/types'

export type RepeatChoice = 'none' | 'weekly' | 'monthly' | 'yearly' | 'custom'

export const REPEAT_CHOICES: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom…' },
]

export const REPEAT_UNITS: { value: RepeatUnit; one: string; many: string }[] = [
  { value: 'day', one: 'day', many: 'days' },
  { value: 'week', one: 'week', many: 'weeks' },
  { value: 'month', one: 'month', many: 'months' },
  { value: 'year', one: 'year', many: 'years' },
]

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface Repeat { every: number | null; unit: RepeatUnit | null; days: number[]; until: string | null }

/** Which of the simple choices a saved repeat is (anything else is Custom). */
export function repeatChoice(r: Repeat): RepeatChoice {
  if (!r.every || !r.unit) return 'none'
  if (r.every !== 1 || r.days.length || r.until) return 'custom'
  return r.unit === 'week' ? 'weekly' : r.unit === 'month' ? 'monthly' : r.unit === 'year' ? 'yearly' : 'custom'
}

/** The repeat a simple choice stands for. */
export function repeatFor(choice: Exclude<RepeatChoice, 'custom'>): Repeat {
  const unit = ({ none: null, weekly: 'week', monthly: 'month', yearly: 'year' } as const)[choice]
  return { every: unit ? 1 : null, unit, days: [], until: null }
}

/** "Every week", "Every 2 weeks on Mon, Thu", "Every 3 months until Dec 31, 2026". */
export function repeatLabel(r: Repeat): string | null {
  if (!r.every || !r.unit) return null
  const u = REPEAT_UNITS.find((x) => x.value === r.unit)!
  let s = r.every === 1 ? `Every ${u.one}` : `Every ${r.every} ${u.many}`
  if (r.unit === 'week' && r.days.length) s += ` on ${[...r.days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(', ')}`
  if (r.until) s += ` until ${dateText(r.until, true)}`
  return s
}

/** A local calendar day as YYYY-MM-DD (not UTC: 9 pm in California is still today). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const asDate = (day: string) => new Date(`${day}T12:00:00`)
const daysBetween = (a: string, b: string) => Math.round((asDate(b).getTime() - asDate(a).getTime()) / 86_400_000)

export function dateText(day: string, withYear = false): string {
  return asDate(day).toLocaleDateString([], withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })
}

export type DueState = 'late' | 'today' | 'soon' | 'later' | 'none'

export function dueState(due: string | null, today: string): DueState {
  if (!due) return 'none'
  const n = daysBetween(today, due)
  return n < 0 ? 'late' : n === 0 ? 'today' : n <= 7 ? 'soon' : 'later'
}

/** "Today", "Tomorrow", "2 days late", "Mon, Oct 14". */
export function dueText(due: string | null, today: string): string {
  if (!due) return 'No date'
  const n = daysBetween(today, due)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n < 0) return `${-n} days late`
  return dateText(due)
}

/** For <input type="datetime-local">: an ISO time shown in local time, and back. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${localDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export function fromLocalInput(local: string): string | null {
  return local ? new Date(local).toISOString() : null
}

/** "Tue, Oct 14, 9:00 AM". */
export function remindText(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** For components: today against the clock now. */
export const todayLocal = () => localDay(new Date())
export const isPast = (iso: string | null) => !!iso && new Date(iso).getTime() <= Date.now()

interface AboutParts {
  vendor?: { name: string } | null; carrier?: { name: string } | null; rep_group?: { name: string } | null
  order?: { po_number: string | null; description: string | null } | null; thread?: { subject: string | null } | null; tag_other?: string | null
}
/** "Ty Inc · PO 1234 · Email: Re: proofs". */
export function aboutText(t: AboutParts): string {
  const order = t.order ? (t.order.po_number ? `PO ${t.order.po_number}` : t.order.description || 'Order') : null
  const thread = t.thread ? `Email: ${t.thread.subject || '(no subject)'}` : null
  return [t.vendor?.name, t.carrier?.name, t.rep_group?.name, order, thread, t.tag_other].filter(Boolean).join(' · ')
}

// ---- Go to it (Dana, Oct 14: "take me there") ----------------------------------------------------------------------
/** Where a task's work is: a page that lands on the step itself, or the pay panel (pay-by tasks pay outside VMS). */
export type TaskTarget = { kind: 'page'; to: string; label: string } | { kind: 'pay'; label: string; bill: 'wwd' | 'order'; id: string }

export function taskTarget(t: { auto_key: string | null; order_id: string | null; thread_id: string | null; vendor_id: string | null; carrier_id: string | null; rep_group_id: string | null }): TaskTarget | null {
  const [kind, id] = (t.auto_key ?? '').split(':')
  if (kind === 'create_po' && id) return t.order_id ? { kind: 'page', to: `/orders/${t.order_id}?do=create-po`, label: 'Create the PO' } : { kind: 'page', to: `/orders/paperwork/${id}`, label: 'Pick the order' }
  if (kind === 'promise' && t.thread_id) return { kind: 'page', to: `/mail/${t.thread_id}?do=reply`, label: 'Reply' }
  if (kind === 'freight_quote' && id) return { kind: 'page', to: `/freight/quotes/${id}`, label: 'Open the freight quote' }
  if (kind === 'lspo' && id) return { kind: 'page', to: `/ls-pos/${id}`, label: 'Open the LS PO' }
  if (kind === 'supply') return { kind: 'page', to: t.thread_id ? `/mail/${t.thread_id}` : '/supplies', label: t.thread_id ? 'Open the request' : 'Open Supplies' }
  if ((kind === 'wwd' || kind === 'order') && id) return { kind: 'pay', label: 'Pay it', bill: kind, id }
  // tasks people make: whatever they are tagged to
  if (t.order_id) return { kind: 'page', to: `/orders/${t.order_id}`, label: 'Open the order' }
  if (t.thread_id) return { kind: 'page', to: `/mail/${t.thread_id}`, label: 'Open the email' }
  if (t.vendor_id) return { kind: 'page', to: `/vendors/${t.vendor_id}`, label: 'Open the vendor' }
  if (t.rep_group_id) return { kind: 'page', to: `/rep-groups/${t.rep_group_id}`, label: 'Open the rep group' }
  if (t.carrier_id) return { kind: 'page', to: `/freight?carrier=${t.carrier_id}`, label: 'Open the freight company' }
  return null
}
