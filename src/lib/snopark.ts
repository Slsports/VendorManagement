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
/** One range on the sheet with the books it came in (Dana, Nov 10): the entry for receiving. */
export interface SheetRow { key: string; kind: 'day' | 'season'; from: string; to: string; first_book: string; last_book: string }
export interface Sheet { season_label: string | null; shipped_on: string | null; requested?: { day_books: number | null; day_permits: number | null; season_books: number | null; season_permits: number | null }; day: SheetKind; season: SheetKind; rows?: { kind: 'day' | 'season'; from: number; to: number; books: number; first_book: string; last_book: string }[]; unclear?: string[] }
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
export const newSheetRow = (kind: 'day' | 'season', from = '', to = ''): SheetRow => ({ key: `s${++rowSeq}`, kind, from, to, first_book: '', last_book: '' })

/** The sheet's rows to edit: the saved rows, else one row per kind from what Claude read. */
export function sheetRowsOf(sheet: Sheet | null): SheetRow[] {
  if (!sheet) return []
  if (sheet.rows?.length) return sheet.rows.map((r) => ({ ...newSheetRow(r.kind, String(r.from), String(r.to)), first_book: r.first_book ?? '', last_book: r.last_book ?? '' }))
  const out: SheetRow[] = []
  for (const kind of ['day', 'season'] as const) {
    const k = sheet[kind]
    if (k.from != null && k.to != null) out.push(newSheetRow(kind, String(k.from), String(k.to)))
  }
  return out
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

/** A sheet row's size: how many whole books its range holds, or why it cannot be used. */
export function sheetRowBooks(r: SheetRow, per: number): { n: number; permits: number; error: string | null } {
  const from = Number(r.from), to = Number(r.to)
  if (!r.from || !r.to || !Number.isFinite(from) || !Number.isFinite(to)) return { n: 0, permits: 0, error: 'From and Including permit numbers' }
  if (to < from) return { n: 0, permits: 0, error: 'Including is before From' }
  const permits = to - from + 1
  if (permits % per !== 0) return { n: Math.floor(permits / per), permits, error: `${permits} permits is not a whole number of ${r.kind} books of ${per}; ask the State` }
  return { n: permits / per, permits, error: null }
}

/**
 * The books a box holds, from the sheet's rows (Dana, Nov 10: "we enter the from and including permit numbers … vms puts
 * in how many books and total permits and then we put in the book number range"). Each row becomes n whole books
 * numbered from its first book; the last book number has to land on n, else the reason comes back.
 */
export function booksFromSheetRows(rows: SheetRow[], perBook: { day: number; season: number }): { books: BookRowInput[]; error: string | null } {
  const out: BookRowInput[] = []
  for (const r of rows) {
    const per = perBook[r.kind]
    const size = sheetRowBooks(r, per)
    const label = `${r.kind} range ${r.from || '?'} to ${r.to || '?'}`
    if (size.error) return { books: [], error: `${label}: ${size.error}.` }
    const first = parseBookNumber(r.first_book)
    if (!first) return { books: [], error: `${label}: the first book number should end in digits, like DB 543.` }
    if (r.last_book.trim()) {
      const last = parseBookNumber(r.last_book)
      if (!last || last.prefix.trim().toUpperCase() !== first.prefix.trim().toUpperCase()) return { books: [], error: `${label}: the last book number should look like the first one (${r.first_book.trim()}).` }
      const count = last.num - first.num + 1
      if (count !== size.n) return { books: [], error: `${label} is ${size.n} book${size.n === 1 ? '' : 's'} of ${per}, but ${r.first_book.trim()} to ${r.last_book.trim()} is ${count} book${count === 1 ? '' : 's'}. A book may be missing from the box; check the covers against the sheet.` }
    }
    const from = Number(r.from)
    for (let i = 0; i < size.n; i++) out.push(newRow(r.kind, String(from + i * per), String(from + i * per + per - 1), bookNumberAfter(r.first_book, i)))
  }
  if (!out.length) return { books: [], error: 'Enter at least one range from the sheet.' }
  const seen = new Set<string>()
  for (const b of out) {
    const k = `${b.kind}:${b.book_number.toUpperCase()}`
    if (seen.has(k)) return { books: [], error: `Book ${b.book_number} comes up twice; check the book number ranges.` }
    seen.add(k)
  }
  return { books: out, error: null }
}

/** The sheet as saved from the rows: the rows themselves plus one range per kind for the check and the summaries. */
export function sheetFromRows(base: Sheet, rows: SheetRow[], perBook: { day: number; season: number }): Sheet {
  const out: Sheet = { ...base, unclear: [], rows: rows.map((r) => ({ kind: r.kind, from: Number(r.from), to: Number(r.to), books: sheetRowBooks(r, perBook[r.kind]).n, first_book: r.first_book.trim(), last_book: r.last_book.trim() })) }
  for (const kind of ['day', 'season'] as const) {
    const mine = rows.filter((r) => r.kind === kind)
    const n = mine.reduce((t, r) => t + sheetRowBooks(r, perBook[kind]).n, 0)
    const permits = mine.reduce((t, r) => t + sheetRowBooks(r, perBook[kind]).permits, 0)
    out[kind] = mine.length ? { from: Math.min(...mine.map((r) => Number(r.from))), to: Math.max(...mine.map((r) => Number(r.to))), books: n, permits } : { from: null, to: null, books: null, permits: null }
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

/** A book cover as VMS read it from a photo. */
export interface CoverReading { kind: 'day' | 'season'; book_number: string; first_permit: number | null; last_permit: number | null; position: string | null }

/**
 * The covers onto the sheet's rows (Dana, Nov 11): a cover whose beginning permit is a row's From is that row's first book,
 * one whose ending permit is the row's Including is its last book. Covers that fit no row are named.
 */
export function applyCovers(rows: SheetRow[], covers: CoverReading[], perBook: { day: number; season: number } = { day: 25, season: 10 }): { rows: SheetRow[]; placed: number; unplaced: string[] } {
  let placed = 0
  const unplaced: string[] = []
  const next = rows.map((r) => ({ ...r }))
  for (const c of covers) {
    let hit = false
    const pos = c.position?.match(/(\d+)\s*of\s*(\d+)/i)
    for (const r of next) {
      if (r.kind !== c.kind || !r.from || !r.to) continue
      const from = Number(r.from), to = Number(r.to)
      const n = sheetRowBooks(r, perBook[r.kind]).n
      if (c.first_permit === from) { r.first_book = c.book_number.trim(); hit = true }
      if (c.last_permit === to) { r.last_book = c.book_number.trim(); hit = true }
      if (!hit && c.first_permit != null && c.last_permit != null && c.first_permit >= from && c.last_permit <= to) hit = true   // a middle book: fine, nothing to fill
      // the permit numbers were cut off in the photo, but the sticker says "20 of 20" and the row holds 20 books
      if (!hit && c.first_permit == null && c.last_permit == null && pos && Number(pos[2]) === n) {
        if (Number(pos[1]) === n) { r.last_book = c.book_number.trim(); hit = true }
        else if (Number(pos[1]) === 1) { r.first_book = c.book_number.trim(); hit = true }
      }
    }
    if (hit) placed++
    else unplaced.push(`${c.book_number.trim()} (${c.kind}${c.first_permit != null ? ` ${c.first_permit}` : ''}${c.last_permit != null ? `–${c.last_permit}` : ''})`)
  }
  return { rows: next, placed, unplaced }
}
