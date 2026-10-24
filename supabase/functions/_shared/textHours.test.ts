import { describe, expect, it } from 'vitest'
import { nextTextTime } from './textHours.ts'

// Oct 24, 2026 is daylight time: Pacific = UTC-7
const pac = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 24, h + 7, m))

describe('text hours', () => {
  it('inside 8 am to 6 pm: right away', () => {
    expect(nextTextTime(pac(9, 30))).toEqual(pac(9, 30))
    expect(nextTextTime(pac(17, 59))).toEqual(pac(17, 59))
  })
  it('at night: waits for 8 am', () => {
    expect(nextTextTime(pac(0, 46)).toISOString()).toBe(pac(8).toISOString())
    expect(nextTextTime(pac(18, 0)).toISOString()).toBe(new Date(pac(8).getTime() + 24 * 3600_000).toISOString())
  })
  it("the person's own hours win", () => {
    expect(nextTextTime(pac(6, 30), '06:00', '21:00')).toEqual(pac(6, 30))
    expect(nextTextTime(pac(5, 0), '06:00:00', '21:00:00').toISOString()).toBe(pac(6).toISOString())
    expect(nextTextTime(pac(2, 0), '00:00', '00:00')).toEqual(pac(2, 0))
  })
})
