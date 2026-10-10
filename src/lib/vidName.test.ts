import { describe, expect, it } from 'vitest'
import { itemName, vidOn } from './vidName'

describe('Vendor ID in item names', () => {
  it('the item wins, then the order, then the vendor', () => {
    expect(vidOn(true, null, null)).toBe(true)
    expect(vidOn(true, false, null)).toBe(false)
    expect(vidOn(false, false, true)).toBe(true)
    expect(vidOn(undefined, null)).toBe(false)
  })
  it('adds the Vendor ID in brackets at the end, once', () => {
    expect(itemName('MENS HOODIE NAVY', 'AB1234', true)).toBe('MENS HOODIE NAVY [AB1234]')
    expect(itemName('MENS HOODIE NAVY [AB1234]', 'AB1234', true)).toBe('MENS HOODIE NAVY [AB1234]')
    expect(itemName('MENS HOODIE NAVY', 'AB1234', false)).toBe('MENS HOODIE NAVY')
    expect(itemName('MENS HOODIE NAVY', null, true)).toBe('MENS HOODIE NAVY')
  })
})
