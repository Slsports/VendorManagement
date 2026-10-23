// "VMS:" notes in email (Dana, Oct 23): pure helpers, tested in vmsNote.test.ts.

const FWD_MARK = /-{3,}\s*Forwarded message|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}|^\s*On .{6,120} wrote:\s*$|^\s*From:\s/im

/** The person's note (after "VMS:") and the email under it. Null when the text does not start with "VMS:". */
export function splitVmsNote(body: string | null): { note: string; rest: string } | null {
  const text = (body ?? '').replace(/\r/g, '')
  const m = /^\s*vms\s*:\s*/i.exec(text)
  if (!m) return null
  const after = text.slice(m[0].length)
  const cut = after.search(FWD_MARK)
  const note = (cut >= 0 ? after.slice(0, cut) : after).trim()
  const rest = cut >= 0 ? after.slice(cut).trim() : ''
  return { note: note.slice(0, 2000), rest }
}

/** A date and time in the stores' time zone (Pacific, with daylight saving) as an ISO instant. */
export function pacificIso(date: string, time = '09:00'): string {
  for (const offset of ['-07:00', '-08:00']) {
    const d = new Date(`${date}T${time}:00${offset}`)
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
    if (hour === time) return d.toISOString()
  }
  return new Date(`${date}T${time}:00-08:00`).toISOString()
}

/** Today in Pacific time, YYYY-MM-DD. */
export const pacificToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

/** "Nov 1, 2026" */
export const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** Valid dates only, each once, in order; at most twelve. */
export function cleanDates(dates: { date: string; time: string | null }[]): { date: string; time: string | null }[] {
  const seen = new Set<string>()
  return dates
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !Number.isNaN(new Date(`${d.date}T12:00:00Z`).getTime()))
    .map((d) => ({ date: d.date, time: d.time && /^\d{2}:\d{2}$/.test(d.time) ? d.time : null }))
    .filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12)
}
