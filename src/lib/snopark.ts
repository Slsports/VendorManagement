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

// ---- receiving a box (Dana, Nov 10) -----------------------------------------------------------------------------
/** The State's shipment sheet (form OHV 145SP) as Claude read it and the person confirmed it. */
export interface SheetKind { from: number | null; to: number | null; books: number | null; permits: number | null }
export interface Sheet { season_label: string | null; shipped_on: string | null; requested?: { day_books: number | null; day_permits: number | null; season_books: number | null; season_permits: number | null }; day: SheetKind; season: SheetKind; unclear?: string[] }
export const EMPTY_SHEET: Sheet = { season_label: null, shipped_on: null, day: { from: null, to: null, books: null, permits: null }, season: { from: null, to: null, books: null, permits: null }, unclear: [] }

export interface Difference { kind: 'day' | 'season'; text: string }

export const SHIPMENT_STATUS: Record<'open' | 'off' | 'balanced' | 'done', { text: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  open: { text: 'Being entered', tone: 'neutral' },
  off: { text: 'Does not match', tone: 'danger' },
  balanced: { text: 'Balances', tone: 'success' },
  done: { text: 'In Lightspeed', tone: 'success' },
}

export interface BookRowInput { key: string; kind: 'day' | 'season'; book_number: string; first_permit: string; last_permit: string }

let rowSeq = 0
export const newRow = (kind: 'day' | 'season', first = '', last = '', book = ''): BookRowInput => ({ key: `r${++rowSeq}`, kind, book_number: book, first_permit: first, last_permit: last })

/**
 * The book rows a confirmed sheet suggests: the sheet's range cut into books of the season's standard size. Only when the
 * range is a whole number of books; the book numbers are typed from the covers.
 */
export function rowsFromSheet(sheet: Sheet, perBook: { day: number; season: number }): BookRowInput[] {
  const out: BookRowInput[] = []
  for (const kind of ['day', 'season'] as const) {
    const k = sheet[kind]
    if (k.from == null || k.to == null || k.to < k.from) continue
    const per = perBook[kind]
    const n = k.to - k.from + 1
    if (n % per !== 0 || n / per > 200) continue
    for (let i = 0; i < n / per; i++) out.push(newRow(kind, String(k.from + i * per), String(k.from + i * per + per - 1)))
  }
  return out
}

/** What is wrong with a row before it is saved: a size that is not a whole book, a missing number. */
export function rowProblem(r: BookRowInput, perBook: { day: number; season: number }): string | null {
  const a = Number(r.first_permit), b = Number(r.last_permit)
  if (!r.book_number.trim()) return 'Book number'
  if (!r.first_permit || !r.last_permit || !Number.isFinite(a) || !Number.isFinite(b)) return 'Permit numbers'
  if (b < a) return 'Last before first'
  const n = b - a + 1
  if (n !== perBook[r.kind]) return `${n} permits; a ${r.kind} book holds ${perBook[r.kind]}`
  return null
}

/** The season-end check as stored on the season. */
export interface SeasonCheck { day: { ls: number; reported: number }; season: { ls: number; reported: number }; off: boolean; through: string; emailed_at?: string | null; email_error?: string | null }

export const ORDER_STATUS: Record<'draft' | 'sent' | 'received', { text: string; tone: 'neutral' | 'warning' | 'success' }> = {
  draft: { text: 'To send', tone: 'warning' },
  sent: { text: 'Sent', tone: 'neutral' },
  received: { text: 'Received', tone: 'success' },
}
