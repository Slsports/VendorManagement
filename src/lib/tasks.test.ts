import { describe, expect, it } from 'vitest'
import { aboutText, dueState, dueText, fromLocalInput, localDay, repeatChoice, repeatFor, repeatLabel, toLocalInput } from './tasks'

describe('repeats', () => {
  it('names the simple choices and custom ones', () => {
    expect(repeatChoice({ every: null, unit: null, days: [], until: null })).toBe('none')
    expect(repeatChoice(repeatFor('weekly'))).toBe('weekly')
    expect(repeatChoice({ every: 2, unit: 'week', days: [], until: null })).toBe('custom')
    expect(repeatChoice({ every: 1, unit: 'week', days: [1], until: null })).toBe('custom')
    expect(repeatChoice({ every: 1, unit: 'day', days: [], until: null })).toBe('custom')
  })
  it('reads like a sentence', () => {
    expect(repeatLabel(repeatFor('none'))).toBeNull()
    expect(repeatLabel(repeatFor('monthly'))).toBe('Every month')
    expect(repeatLabel({ every: 2, unit: 'week', days: [4, 1], until: null })).toBe('Every 2 weeks on Mon, Thu')
    expect(repeatLabel({ every: 3, unit: 'day', days: [], until: '2026-12-31' })).toMatch(/^Every 3 days until Dec 31, 2026$/)
  })
})

describe('due dates', () => {
  const today = '2026-10-14'
  it('says late, today, tomorrow', () => {
    expect(dueState('2026-10-12', today)).toBe('late')
    expect(dueState(today, today)).toBe('today')
    expect(dueState('2026-10-20', today)).toBe('soon')
    expect(dueState('2026-11-20', today)).toBe('later')
    expect(dueState(null, today)).toBe('none')
    expect(dueText('2026-10-12', today)).toBe('2 days late')
    expect(dueText('2026-10-13', today)).toBe('Yesterday')
    expect(dueText('2026-10-15', today)).toBe('Tomorrow')
    expect(dueText(null, today)).toBe('No date')
  })
  it('uses the local day and local times', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    const iso = fromLocalInput('2026-10-14T09:00')!
    expect(toLocalInput(iso)).toBe('2026-10-14T09:00')
    expect(fromLocalInput('')).toBeNull()
  })
})

describe('aboutText', () => {
  it('lists what a task is about', () => {
    expect(aboutText({ vendor: { name: 'Ty' }, order: { po_number: '12', description: null }, tag_other: 'Marina' })).toBe('Ty · PO 12 · Marina')
    expect(aboutText({ thread: { subject: null } })).toBe('Email: (no subject)')
    expect(aboutText({})).toBe('')
  })
})
