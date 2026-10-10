// Snooze (Dana, Oct 9): the choices offered, as times. Mornings are 8 am local.

export interface SnoozeChoice { label: string; until: Date }

const at8 = (d: Date) => { const x = new Date(d); x.setHours(8, 0, 0, 0); return x }

export function snoozeChoices(now: Date): SnoozeChoice[] {
  const tomorrow = at8(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const twoDays = at8(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2))
  const toMonday = ((8 - now.getDay()) % 7) || 7
  const monday = at8(new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday))
  return [
    { label: 'Later today (3 hours)', until: new Date(now.getTime() + 3 * 3600_000) },
    { label: 'Tomorrow morning', until: tomorrow },
    { label: 'In 2 days', until: twoDays },
    { label: 'Next Monday', until: monday },
  ]
}

/** "Tue 8:00 AM", or "Oct 21, 8:00 AM" when more than a week away. */
export function snoozeLabel(until: string | Date, now: Date): string {
  const d = new Date(until)
  const far = d.getTime() - now.getTime() > 6 * 86400_000
  return d.toLocaleString([], far ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export interface MySnoozes {
  /** Snoozed and still hidden: id → until. */
  hidden: Map<string, string>
  /** Came back and not opened yet. */
  back: Set<string>
}

/** For components: the same, against the clock now. */
export const snoozeText = (until: string | Date) => snoozeLabel(until, new Date())
export const snoozeChoicesNow = () => snoozeChoices(new Date())
export const isFuture = (local: string) => !!local && new Date(local).getTime() > Date.now()
