import { describe, expect, it } from 'vitest'
import { snoozeChoices } from './snooze'

describe('snooze choices', () => {
  it('later today, tomorrow 8 am, in two days, and next Monday', () => {
    const fri = new Date(2026, 9, 9, 14, 30) // Friday Oct 9, 2:30 pm
    const [later, tomorrow, twoDays, monday] = snoozeChoices(fri).map((c) => c.until)
    expect(later!.getHours()).toBe(17)
    expect([tomorrow!.getDate(), tomorrow!.getHours()]).toEqual([10, 8])
    expect(twoDays!.getDate()).toBe(11)
    expect([monday!.getDay(), monday!.getDate(), monday!.getHours()]).toEqual([1, 12, 8])
  })
  it('on a Monday, next Monday is a week away', () => {
    const mon = new Date(2026, 9, 12, 9, 0)
    expect(snoozeChoices(mon)[3]!.until.getDate()).toBe(19)
  })
})
