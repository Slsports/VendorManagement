import { describe, expect, it } from 'vitest'
import { cleanPhones, phonesOf, phoneText, phoneTypeLabel, telHref } from './phones'

describe('phones', () => {
  it('labels Other with what was typed', () => {
    expect(phoneTypeLabel({ number: '1', type: 'other', label: 'Warehouse' })).toBe('Warehouse')
    expect(phoneTypeLabel({ number: '1', type: 'other' })).toBe('Other')
    expect(phoneTypeLabel({ number: '1', type: 'cell' })).toBe('Cell')
  })
  it('dials the digits and the extension', () => {
    expect(telHref({ number: '(800) 541-2929', type: 'work', ext: '12' })).toBe('tel:8005412929,12')
    expect(phoneText({ number: '(800) 541-2929', type: 'work', ext: '12' })).toBe('(800) 541-2929 ext. 12')
  })
  it('falls back to the old phone field and drops blank rows', () => {
    expect(phonesOf({ phones: [], phone: '559-841-2740' })).toEqual([{ number: '559-841-2740', type: 'work' }])
    expect(cleanPhones([{ number: ' ', type: 'cell' }, { number: '559 ', type: 'work', label: 'x' }])).toEqual([{ number: '559', type: 'work' }])
  })
})
