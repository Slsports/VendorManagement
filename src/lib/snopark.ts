// Sno-Park passes (Dana, Nov 5-6, 2026): words and small sums shared by the pages. The State's math lives in the database
// (snopark_report_build) and in the Excel; this only shows it.
import type { SnoparkBook, SnoparkReport, SnoparkReportRow, SnoparkSeason } from '@/types'

export const MAIL_TO = 'OHMVR Division, P.O. Box 942896, Sacramento, CA 94296'

export const KIND_LABELS: Record<SnoparkBook['kind'], string> = { day: 'Day', season: 'Season' }

export const BOOK_STATUS: Record<SnoparkBook['status'], { text: string; tone: 'neutral' | 'warning' | 'success' }> = {
  on_hand: { text: 'On hand', tone: 'neutral' },
  empty: { text: 'On a report', tone: 'warning' },
  returned: { text: 'Returned', tone: 'success' },
}

export const REPORT_STATUS: Record<SnoparkReport['status'], { text: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  open: { text: 'To do', tone: 'warning' },
  ready: { text: 'Ready to mail', tone: 'neutral' },
  mailed: { text: 'Mailed', tone: 'success' },
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "November 2026" for a report's month (a date string, first of the month). */
export function monthName(month: string): string {
  const [y, m] = month.slice(0, 10).split('-')
  return `${MONTHS[Number(m) - 1] ?? month} ${y}`
}

/** What a report is called: "November 2026 report" or "Final report 2026-2027". */
export function reportTitle(r: Pick<SnoparkReport, 'kind' | 'month'>, season?: Pick<SnoparkSeason, 'label'> | null): string {
  return r.kind === 'final' ? `Final report${season ? ` ${season.label}` : ''}` : `${monthName(r.month)} report`
}

export const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "5726 – 5750" */
export const range = (from: number, to: number) => (from === to ? String(from) : `${from} – ${to}`)

export const permitsIn = (b: Pick<SnoparkBook, 'first_permit' | 'last_permit'>) => b.last_permit - b.first_permit + 1

/** The rows of a report split the way the State's form shows them. */
export function splitRows(rows: SnoparkReportRow[]) {
  const sold = rows.filter((r) => r.section === 'sold')
  return { day: sold.filter((r) => r.kind === 'day'), season: sold.filter((r) => r.kind === 'season'), unsold: rows.filter((r) => r.section === 'unsold') }
}

/** Days until a date (negative when past), by the calendar day. */
export function daysUntil(date: string, today = new Date()): number {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`).getTime()
  const t = new Date(`${today.toISOString().slice(0, 10)}T12:00:00Z`).getTime()
  return Math.round((d - t) / 86_400_000)
}

/** The next book number after the last one entered of a kind ("B452" → "B453"), for the Add books form. */
export function nextBookNumber(books: Pick<SnoparkBook, 'kind' | 'book_number' | 'last_permit'>[], kind: SnoparkBook['kind']): { book: string; permit: number } | null {
  const mine = books.filter((b) => b.kind === kind)
  if (!mine.length) return null
  const last = mine.reduce((a, b) => (b.last_permit > a.last_permit ? b : a))
  const m = last.book_number.match(/^(.*?)(\d+)$/)
  if (!m) return { book: '', permit: last.last_permit + 1 }
  return { book: `${m[1]}${String(Number(m[2]) + 1).padStart(m[2]!.length, '0')}`, permit: last.last_permit + 1 }
}
