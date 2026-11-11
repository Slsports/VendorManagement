import { describe, expect, it } from 'vitest'
import { daysUntil, monthName, money, nextBookNumber, range, reportTitle, splitRows } from './snopark'

describe('snopark', () => {
  it('names months and reports', () => {
    expect(monthName('2026-11-01')).toBe('November 2026')
    expect(reportTitle({ kind: 'monthly', month: '2026-11-01' })).toBe('November 2026 report')
    expect(reportTitle({ kind: 'final', month: '2027-05-01' }, { label: '2026-2027' })).toBe('Final report 2026-2027')
  })
  it('formats money and ranges', () => {
    expect(money(13468)).toBe('$13,468.00')
    expect(money('330')).toBe('$330.00')
    expect(range(5726, 5750)).toBe('5726 – 5750')
    expect(range(10, 10)).toBe('10')
  })
  it('counts days to a due date', () => {
    expect(daysUntil('2026-12-15', new Date('2026-12-10T20:00:00Z'))).toBe(5)
    expect(daysUntil('2026-12-15', new Date('2026-12-16T02:00:00Z'))).toBe(-1)
  })
  it('suggests the next book', () => {
    expect(nextBookNumber([], 'day')).toBeNull()
    expect(nextBookNumber([{ kind: 'day', book_number: 'B450', last_permit: 5750 }, { kind: 'day', book_number: 'B451', last_permit: 5775 }], 'day')).toEqual({ book: 'B452', permit: 5776 })
    expect(nextBookNumber([{ kind: 'season', book_number: '0099', last_permit: 10 }], 'season')).toEqual({ book: '0100', permit: 11 })
  })
  it('splits a report the way the form shows it', () => {
    const row = (section: 'sold' | 'unsold', kind: 'day' | 'season') => ({ id: '', organization_id: '', report_id: '', book_id: null, section, kind, book_number: null, from_permit: 1, to_permit: 2, qty: 2, amount: 0, commission: 0, due: 0, sort: 0 })
    const s = splitRows([row('sold', 'day'), row('sold', 'season'), row('unsold', 'day')])
    expect(s.day).toHaveLength(1)
    expect(s.season).toHaveLength(1)
    expect(s.unsold).toHaveLength(1)
  })
})

describe('receiving a box (Nov 10)', () => {
  const per = { day: 25, season: 10 }
  it('makes the books from the sheet rows, numbered from the first book, and checks the last one', async () => {
    const { booksFromSheetRows, newSheetRow, sheetFromRows, EMPTY_SHEET, bookNumberAfter } = await import('./snopark')
    const rows = [{ ...newSheetRow('day', '7751', '7825'), first_book: 'DB 543', last_book: 'DB 545' }, { ...newSheetRow('day', '9001', '9025'), first_book: 'DB 600', last_book: '' }, { ...newSheetRow('season', '10591', '10610'), first_book: 'SB 1130', last_book: 'SB 1131' }]
    const ok = booksFromSheetRows(rows, per)
    expect(ok.error).toBeNull()
    expect(ok.books.map((r) => `${r.book_number}:${r.first_permit}-${r.last_permit}`)).toEqual(['DB 543:7751-7775', 'DB 544:7776-7800', 'DB 545:7801-7825', 'DB 600:9001-9025', 'SB 1130:10591-10600', 'SB 1131:10601-10610'])
    expect(booksFromSheetRows([{ ...rows[0]!, last_book: 'DB 546' }], per).error).toMatch(/is 3 books of 25, but DB 543 to DB 546 is 4 books/)
    expect(booksFromSheetRows([{ ...rows[0]!, first_book: '' }], per).error).toMatch(/first book number/)
    expect(booksFromSheetRows([{ ...newSheetRow('day', '7751', '7774'), first_book: 'DB 1', last_book: '' }], per).error).toMatch(/not a whole number/)
    const sheet = sheetFromRows(EMPTY_SHEET, rows, per)
    expect(sheet.day).toEqual({ from: 7751, to: 9025, books: 4, permits: 100 })
    expect(sheet.rows?.[0]).toEqual({ kind: 'day', from: 7751, to: 7825, books: 3, first_book: 'DB 543', last_book: 'DB 545' })
    expect(bookNumberAfter('B0099', 1)).toBe('B0100')
  })
  it('puts the photographed covers on the sheet rows by their permit numbers', async () => {
    const { applyCovers, newSheetRow } = await import('./snopark')
    const rows = [newSheetRow('day', '5151', '5650'), newSheetRow('season', '8631', '8730')]
    const r = applyCovers(rows, [
      { kind: 'season', book_number: 'S 0864', first_permit: 8631, last_permit: 8640, position: '1 of 10' },
      { kind: 'season', book_number: 'S 0873', first_permit: 8721, last_permit: 8730, position: '10 of 10' },
      { kind: 'day', book_number: 'D 0207', first_permit: 5151, last_permit: 5175, position: '1 of 20' },
      { kind: 'day', book_number: 'D 0226', first_permit: 5626, last_permit: 5650, position: '20 of 20' },
      { kind: 'day', book_number: 'D 0999', first_permit: 9001, last_permit: 9025, position: null },
    ])
    expect(r.rows.map((x) => `${x.first_book}..${x.last_book}`)).toEqual(['D 0207..D 0226', 'S 0864..S 0873'])
    expect(r.placed).toBe(4)
    expect(r.unplaced).toEqual(['D 0999 (day 9001–9025)'])
  })
  it('names what is wrong with a row before it is saved', async () => {
    const { rowProblem, newRow } = await import('./snopark')
    expect(rowProblem({ ...newRow('day', '7751', '7775'), book_number: 'DB 543' }, per)).toBeNull()
    expect(rowProblem({ ...newRow('day', '7751', '7774'), book_number: 'DB 543' }, per)).toBe('24 permits; a day book holds 25')
    expect(rowProblem(newRow('day', '7751', '7775'), per)).toBe('Book number')
    expect(rowProblem({ ...newRow('season', '20', '11'), book_number: 'S1' }, per)).toBe('Last before first')
  })
})
