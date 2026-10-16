import { describe, expect, it } from 'vitest'
import { lsItemsText, lsSortValue, programState } from './vendors'

describe('Lightspeed items label', () => {
  it('says the counts', () => {
    expect(lsItemsText({ ls_active_items: 1212, ls_archived_items: 1 })).toBe('1,212 active, 1 archived item')
    expect(lsItemsText({ ls_active_items: 0, ls_archived_items: 0 })).toBe('no items')
  })
  it('sorts active (most items) above inactive above none, untied last', () => {
    const v = (ls_status: 'active' | 'inactive' | 'none' | null, a: number, r: number) => lsSortValue({ ls_status, ls_active_items: a, ls_archived_items: r })
    const order = [v('none', 0, 0), v('active', 5, 0), v('inactive', 0, 900), v('active', 50, 2)].sort((x, y) => (y ?? -1) - (x ?? -1))
    expect(order).toEqual([v('active', 50, 2), v('active', 5, 0), v('inactive', 0, 900), v('none', 0, 0)])
    expect(v(null, 0, 0)).toBeNull()
  })
})

describe('program state', () => {
  const today = new Date('2026-10-16T12:00:00')
  it('is active, ending soon or expired', () => {
    expect(programState({ expires_on: null }, today)).toBe('active')
    expect(programState({ expires_on: '2027-01-31' }, today)).toBe('active')
    expect(programState({ expires_on: '2026-11-01' }, today)).toBe('soon')
    expect(programState({ expires_on: '2026-09-30' }, today)).toBe('expired')
  })
})
