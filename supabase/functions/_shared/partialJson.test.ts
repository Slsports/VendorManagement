import { describe, expect, it } from 'vitest'
import { cutAnswer, wholeObjects } from './partialJson'

describe('a reading cut off at its length limit', () => {
  const cut = '{"doc_type":"invoice","po_number":"PC1","total":901.6,"lines":[{"vendor_item_id":"PT 6934","description":"Tee, \\"Red\\" {XS}","quantity":4},{"vendor_item_id":"PT 6935","quantity":6},{"vendor_item_id":"PS 18500","descri'

  it('keeps the header and every finished line', () => {
    const got = cutAnswer(cut)
    expect(got?.head).toMatchObject({ doc_type: 'invoice', po_number: 'PC1', total: 901.6 })
    expect(got?.head).not.toHaveProperty('lines')
    expect(got?.lines).toEqual([
      { vendor_item_id: 'PT 6934', description: 'Tee, "Red" {XS}', quantity: 4 },
      { vendor_item_id: 'PT 6935', quantity: 6 },
    ])
  })

  it('stops at the end of the list', () => {
    expect(wholeObjects('{"lines":[{"a":1}],"note":{"b":2}}', '"lines":[')).toEqual([{ a: 1 }])
  })

  it('gives nothing when there are no lines yet', () => {
    expect(cutAnswer('{"doc_type":"inv')).toBeNull()
    expect(wholeObjects('{"lines":[{"a":', '"lines":[')).toEqual([])
  })
})
