import { describe, expect, it } from 'vitest'
import { filtersFromParams, filtersToParams, headlineParts, isSearching, parseShortcuts, toSearchArgs } from './mailSearch'

describe('mail search', () => {
  it('reads typed shortcuts and leaves the words', () => {
    const r = parseShortcuts('show order from:sharon has:pdf after:2026-09-01 in:sent')
    expect(r.q).toBe('show order')
    expect(r.filters).toEqual({ from: 'sharon', attach: 'yes', file: 'pdf', since: '2026-09-01', dir: 'out' })
    expect(parseShortcuts('no:attachment boos').filters.attach).toBe('no')
    expect(parseShortcuts('has:spreadsheet').filters.file).toBe('sheet')
  })
  it('keeps the search in the page address', () => {
    const p = filtersToParams(new URLSearchParams('view=all'), { q: 'bellies', with: 'sharon@lazyone.com', withName: 'Sharon Brown', attach: 'yes' })
    expect(p.get('view')).toBe('all')
    const f = filtersFromParams(p)
    expect(f).toMatchObject({ q: 'bellies', with: 'sharon@lazyone.com', withName: 'Sharon Brown', attach: 'yes' })
    expect(isSearching(f)).toBe(true)
    expect(isSearching({ q: '  ' })).toBe(false)
  })
  it('asks the search with the scope and dates', () => {
    const a = toSearchArgs({ q: ' lazy one ', days: '7', attach: 'no', file: 'pdf' }, { box: 'orders', vendorId: 'v1' }, new Date('2026-10-21T12:00:00'))
    expect(a).toEqual({ p_q: 'lazy one', p: { box: 'orders', vendor_id: 'v1', attach: false, file: 'pdf', since: '2026-10-14' } })
  })
  it('marks the matching words', () => {
    expect(headlineParts('Should I <<ship>> this')).toEqual([{ text: 'Should I ', hit: false }, { text: 'ship', hit: true }, { text: ' this', hit: false }])
  })
})
