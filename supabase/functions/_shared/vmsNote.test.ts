import { describe, expect, it } from 'vitest'
import { cleanDates, longDay, pacificIso, splitVmsNote } from './vmsNote.ts'

describe('VMS: notes', () => {
  it('reads only a note that starts with VMS:, and splits off the forwarded email', () => {
    const r = splitVmsNote('VMS: Please create a task reminder on Nov 1, 2026 and Dec 15, 2026\n\n---------- Forwarded message ---------\nFrom: Rep <rep@x.com>\nSubject: Backorders\n\nItems A1, B2')
    expect(r?.note).toBe('Please create a task reminder on Nov 1, 2026 and Dec 15, 2026')
    expect(r?.rest).toContain('Items A1, B2')
    expect(splitVmsNote('  vms : remind me')?.note).toBe('remind me')
    expect(splitVmsNote('Claude: please do it')).toBeNull()
    expect(splitVmsNote('Hi Claude, VMS: later in the text')).toBeNull()
  })
  it('reminds at 9 am Pacific, summer or winter', () => {
    expect(pacificIso('2026-11-01')).toBe('2026-11-01T17:00:00.000Z')
    expect(pacificIso('2026-10-30')).toBe('2026-10-30T16:00:00.000Z')
    expect(pacificIso('2027-03-21', '14:30')).toBe('2027-03-21T21:30:00.000Z')
  })
  it('keeps good dates once, in order', () => {
    expect(cleanDates([{ date: '2027-01-30', time: null }, { date: '2026-11-01', time: '8:00' }, { date: '2026-11-01', time: null }, { date: 'soon', time: null }]))
      .toEqual([{ date: '2026-11-01', time: null }, { date: '2027-01-30', time: null }])
    expect(longDay('2026-12-15')).toBe('Dec 15, 2026')
  })
})
