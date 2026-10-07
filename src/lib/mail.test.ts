import { describe, expect, it } from 'vitest'
import { threadState, waited } from './mail'

describe('mail helpers', () => {
  const now = new Date('2026-10-08T12:00:00Z').getTime()
  it('reads a thread waiting past its follow-up date as no answer yet', () => {
    expect(threadState({ status: 'waiting_on_vendor', follow_up_at: '2026-10-07T00:00:00Z' }, now)).toBe('no_answer')
    expect(threadState({ status: 'waiting_on_vendor', follow_up_at: '2026-10-10T00:00:00Z' }, now)).toBe('waiting')
    expect(threadState({ status: 'waiting_on_us', follow_up_at: null }, now)).toBe('needs')
    expect(threadState({ status: 'handled', follow_up_at: null }, now)).toBe('handled')
  })
  it('says how long something waited', () => {
    expect(waited('2026-10-08T11:30:00Z', now)).toBe('30 min')
    expect(waited('2026-10-07T12:00:00Z', now)).toBe('24 hours')
    expect(waited('2026-10-03T12:00:00Z', now)).toBe('5 days')
  })
})
