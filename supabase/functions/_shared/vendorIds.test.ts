import { describe, expect, it } from 'vitest'
import { cutOffVids } from './vendorIds.ts'

describe('Vendor IDs from a paper', () => {
  it('a cut-off Item Code stops where the print stops', () => {
    const r = cutOffVids({ lines: [{ vendor_item_id: 'PS 317 BL.../R5700-2-F' }, { vendor_item_id: 'PS 317 BL…' }, { vendor_item_id: 'PT 100/R5388-2-L' }, { vendor_item_id: '...' }, { vendor_item_id: null }] })
    expect(r.lines.map((l) => l.vendor_item_id)).toEqual(['PS 317 BL/R5700-2-F', 'PS 317 BL', 'PT 100/R5388-2-L', null, null])
  })
})
