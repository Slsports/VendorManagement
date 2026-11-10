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
  it('cuts a confirmed sheet into whole books numbered from the first book, and checks the last one', async () => {
    const { rowsFromSheet, EMPTY_SHEET, bookNumberAfter } = await import('./snopark')
    const sheet = { ...EMPTY_SHEET, day: { from: 7751, to: 7825, books: 3, permits: 75 }, season: { from: 10591, to: 10610, books: 2, permits: 20 } }
    const ok = rowsFromSheet(sheet, per, { day: { first: 'DB 543', last: 'DB 545' }, season: { first: 'SB 1130', last: '' } })
    expect(ok.error).toBeNull()
    expect(ok.rows.map((r) => `${r.book_number}:${r.first_permit}-${r.last_permit}`)).toEqual(['DB 543:7751-7775', 'DB 544:7776-7800', 'DB 545:7801-7825', 'SB 1130:10591-10600', 'SB 1131:10601-10610'])
    expect(rowsFromSheet(sheet, per, { day: { first: 'DB 543', last: 'DB 546' }, season: { first: 'SB 1130', last: '' } }).error).toMatch(/4 day books, but the sheet's range/)
    expect(rowsFromSheet(sheet, per, { day: { first: '', last: '' } }).error).toMatch(/enter the first day book number/)
    expect(rowsFromSheet({ ...EMPTY_SHEET, day: { from: 7751, to: 7774, books: 1, permits: 24 } }, per, { day: { first: 'DB 1', last: '' } }).error).toMatch(/not a whole number of books/)
    expect(bookNumberAfter('B0099', 1)).toBe('B0100')
  })
  it('names what is wrong with a row before it is saved', async () => {
    const { rowProblem, newRow } = await import('./snopark')
    expect(rowProblem({ ...newRow('day', '7751', '7775'), book_number: 'DB 543' }, per)).toBeNull()
    expect(rowProblem({ ...newRow('day', '7751', '7774'), book_number: 'DB 543' }, per)).toBe('24 permits; a day book holds 25')
    expect(rowProblem(newRow('day', '7751', '7775'), per)).toBe('Book number')
    expect(rowProblem({ ...newRow('season', '20', '11'), book_number: 'S1' }, per)).toBe('Last before first')
  })
})
