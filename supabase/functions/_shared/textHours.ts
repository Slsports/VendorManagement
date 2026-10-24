// When VMS may text a person (Dana, Oct 24: "no one should receive texts before 8am or after 6 pm unless they
// specifically set it that way themselves"). Each person's hours are profiles.text_from / text_until (Pacific time),
// 8:00 to 18:00 unless they changed them. Pure, shared by task-reminders and the tests.

const TZ = 'America/Los_Angeles'

/** "08:00" / "08:00:00" → minutes after midnight. */
const minutes = (t: string | null | undefined, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}

/** The wall-clock minutes of a moment in Pacific time. */
function pacificMinutes(at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]))
  return Number(p.hour) * 60 + Number(p.minute)
}

/**
 * When a text may go out: `at` itself when it is inside the person's hours, else the next time their hours start.
 * Hours that run past midnight (from 20:00 until 07:00) work too; equal from and until means any time.
 */
export function nextTextTime(at: Date, from?: string | null, until?: string | null): Date {
  const start = minutes(from, 8 * 60)
  const end = minutes(until, 18 * 60)
  if (start === end) return at
  const now = pacificMinutes(at)
  const inside = start < end ? now >= start && now < end : now >= start || now < end
  if (inside) return at
  const wait = (start - now + 24 * 60) % (24 * 60)
  const next = new Date(at.getTime() + wait * 60_000)
  next.setUTCSeconds(0, 0)
  return next
}
