import { describe, expect, it } from 'vitest'
import { lsReasonLabel } from './lightspeed'

describe('lsReasonLabel', () => {
  it('says LS reasons in plain words, others as LS writes them', () => {
    expect(lsReasonLabel('manualAdjustQOH')).toBe('Quantity typed in by hand')
    expect(lsReasonLabel('removeInventoryForTransaction')).toBe('Sold')
    expect(lsReasonLabel('somethingNew')).toBe('somethingNew')
  })
})
