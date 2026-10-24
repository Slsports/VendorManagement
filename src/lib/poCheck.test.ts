import { describe, expect, it } from 'vitest'
import { poCodeDefault, poSame, poState } from './poCheck'

const v = { name: 'PO208 YAKTEST', po_code: 'YAKT' }

describe('PO on a confirmation', () => {
  it('ours, with case, dashes and extra words aside', () => {
    expect(poState('yakt-101226 early buy', 'YAKT101226', v).state).toBe('ours')
  })
  it('ours written another way: no leading zeros, or a shorter vendor name', () => {
    expect(poSame('OKUMA9126', 'OKUMA090126')).toBe(true)
    expect(poSame('planet101926', 'PLANETCOTTON101926')).toBe(true)
    expect(poSame('LAZY9226', 'LAZYONE090226')).toBe(true)
    expect(poSame('OKUMA9127', 'OKUMA090126')).toBe(false)
    expect(poSame('WW Show 9-2026', 'SONA090226')).toBe(false)
    expect(poState('OKUMA9126', 'OKUMA090126', { name: 'OKUMA', po_code: null }).state).toBe('ours')
  })
  it('someone else\'s number when the order has ours', () => {
    expect(poState('1250540', 'YAKT101226', v).state).toBe('not_ours')
  })
  it('in our naming while the order has no PO yet, with or without leading zeros', () => {
    expect(poState('YAKT101326', null, v).state).toBe('fits')
    expect(poState('YAKT91226', null, v).state).toBe('fits')
    expect(poState('Panthermrtn9126', null, { name: 'PANTHER MARTIN', po_code: null }).state).toBe('fits')
    expect(poState('26569', null, v).state).toBe('off')
  })
  it('with a PO abbreviation set, ours start with it', () => {
    const pc = { name: 'PLANET COTTON', po_code: 'PLANET' }
    expect(poState('PLANET51026', null, pc).state).toBe('fits')
    expect(poState('PC51026', null, pc).state).toBe('off')
  })
  it('off our naming, and missing', () => {
    expect(poState('NCDXZQN3DZ', null, v).state).toBe('off')
    expect(poState('N/A', null, v).state).toBe('missing')
    expect(poState(null, 'YAKT101226', v).state).toBe('missing')
  })
  it('an example from the order date', () => {
    expect(poState(null, null, v, '2026-10-12').example).toBe('YAKT101226')
  })
  it('the default code from the vendor name', () => {
    expect(poCodeDefault('Planet Cotton')).toBe('PLANETCOTTON')
    expect(poCodeDefault('Atwood Rope Manufacturing - WWD')).toBe('ATWOOD')
  })
})
