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

/** How many whole books the sheet's range holds for a kind; null when it is no whole number of books. */
export function sheetBooks(sheet: Sheet, kind: 'day' | 'season', per: number): { from: number; to: number; n: number } | null {
  const k = sheet[kind]
  if (k.from == null || k.to == null || k.to < k.from) return null
  const n = k.to - k.from + 1
  if (n % per !== 0 || n / per > 500) return null
  return { from: k.from, to: k.to, n: n / per }
}

/** "DB 543" → { prefix: "DB ", num: 543, width: 3 }; null when the number does not end in digits. */
export function parseBookNumber(text: string): { prefix: string; num: number; width: number } | null {
  const m = text.trim().match(/^(.*?)(\d+)$/)
  if (!m) return null
  return { prefix: m[1]!, num: Number(m[2]), width: m[2]!.length }
}

/** The book number that comes n after another: "DB 543" + 2 → "DB 545". */
export function bookNumberAfter(first: string, n: number): string {
  const b = parseBookNumber(first)
  if (!b) return ''
  return `${b.prefix}${String(b.num + n).padStart(b.width, '0')}`
}

/**
 * The book rows from a confirmed sheet (Dana, Nov 10: "put in the first book number and last book number in Day passes
 * and in the season books - that will autofill all the permit numbers and log the book numbers to correspond with the
 * permit numbers"). The sheet's range is cut into whole books; the book numbers run from the first one given. The last
 * book number must land on the sheet's count, else the reason comes back as an error.
 */
export function rowsFromSheet(sheet: Sheet, perBook: { day: number; season: number }, books: { day?: { first: string; last: string }; season?: { first: string; last: string } }): { rows: BookRowInput[]; error: string | null } {
  const out: BookRowInput[] = []
  for (const kind of ['day', 'season'] as const) {
    const range = sheetBooks(sheet, kind, perBook[kind])
    const given = books[kind]
    if (!range) {
      if (given?.first.trim()) return { rows: [], error: `The sheet's ${kind} range is not a whole number of books of ${perBook[kind]}; check the sheet's numbers first.` }
      continue
    }
    if (!given?.first.trim()) return { rows: [], error: `The sheet says ${range.n} ${kind} book${range.n === 1 ? '' : 's'} (permits ${range.from} to ${range.to}): enter the first ${kind} book number.` }
    const first = parseBookNumber(given.first)
    if (!first) return { rows: [], error: `The ${kind} book number should end in digits, like DB 543.` }
    if (given.last.trim()) {
      const last = parseBookNumber(given.last)
      if (!last || last.prefix.trim().toUpperCase() !== first.prefix.trim().toUpperCase()) return { rows: [], error: `The last ${kind} book number should look like the first one (${given.first.trim()}).` }
      const count = last.num - first.num + 1
      if (count !== range.n) return { rows: [], error: `${given.first.trim()} to ${given.last.trim()} is ${count} ${kind} book${count === 1 ? '' : 's'}, but the sheet's range (${range.from} to ${range.to}) is ${range.n}. Check the book numbers on the covers or the sheet.` }
    }
    for (let i = 0; i < range.n; i++) out.push(newRow(kind, String(range.from + i * perBook[kind]), String(range.from + i * perBook[kind] + perBook[kind] - 1), bookNumberAfter(given.first, i)))
  }
  if (!out.length) return { rows: [], error: 'The sheet has no permit ranges to cut into books.' }
  return { rows: out, error: null }
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
