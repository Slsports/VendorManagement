import { describe, expect, it } from 'vitest'
import { availabilityEmail } from './availability'

describe('ask the rep', () => {
  it('lists every item with its Vendor ID and quantity', () => {
    const m = availabilityEmail('LAZY ONE', [{ vid: 'PJ123', name: 'Bear Bellies PJ', qty: 6 }, { vid: null, name: 'Slipper', qty: 0 }])
    expect(m.subject).toContain('LAZY ONE')
    expect(m.body).toContain('PJ123')
    expect(m.body).toContain("(we'd order 6)")
    expect(m.body).toContain('(no Vendor ID)')
    expect(m.body).toContain('2 items')
  })
  it('points to the attached spreadsheet instead of listing the items (Dana, Nov 9)', () => {
    const m = availabilityEmail('LAZY ONE', [{ vid: 'PJ123', name: 'Bear Bellies PJ', qty: 6 }], true)
    expect(m.body).toContain('attached spreadsheet')
    expect(m.body).not.toContain('PJ123')
  })
})
