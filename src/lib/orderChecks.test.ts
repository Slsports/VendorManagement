import { describe, expect, it } from 'vitest'
import { checkStatusText, daysWaiting, priceIn } from './orderChecks'

describe('order paperwork words', () => {
  it('says where a check stands', () => {
    expect(checkStatusText({ status: 'to_review', result: 'issues', issues: ['a', 'b'], outcome: null }).text).toBe('2 issues to review')
    expect(checkStatusText({ status: 'to_review', result: 'match', issues: [], outcome: null }).tone).toBe('success')
    expect(checkStatusText({ status: 'done', result: 'issues', issues: ['a'], outcome: 'sent' }).text).toBe('Done, email sent')
  })
  it('counts whole days', () => {
    expect(daysWaiting('2026-10-01T12:00:00Z', Date.parse('2026-10-03T13:00:00Z'))).toBe(2)
  })
})

describe('the price in a check row (usual charges, Oct 15)', () => {
  it('takes the first dollar amount', () => {
    expect(priceIn('Tags - No Retails, 144 at $0.15 = $21.60')).toBe(0.15)
    expect(priceIn('4 pcs at $8.00 = $32.00')).toBe(8)
    expect(priceIn('no price given')).toBeNull()
  })
})
