import { describe, expect, it } from 'vitest'
import { markItemStatus, markerOf, outOfStockIn, replacementIn } from './itemStatus'
import { orderNeed, planReport, type SalesItem } from './salesReport'

const item = (sid: string, o: Partial<SalesItem> = {}): SalesItem => ({
  sid, upc: `0${sid}`, lsVendor: 'BECKER', vid: `V${sid}`, desc: `ITEM ${sid}`, cost: 2, cat: 'TOYS', archived: false, sold: 10, nonInv: false, qoh: 4, last: '2026-10-01', notes: [], ...o,
})

describe('reading the LS name and note', () => {
  it('knows the markers', () => {
    expect(markerOf('**BAD SELLER')).toBe('dnr')
    expect(markerOf('*OLD STYLE')).toBe('discontinued')
    expect(markerOf('BECKER 63377 LARGE *')).toBe('discontinued')
    expect(markerOf('PLAIN ITEM')).toBeNull()
  })
  it('finds the replacement Vendor ID but not vague words', () => {
    expect(replacementIn('REPLACED WITH 63360')).toBe('63360')
    expect(replacementIn('replaced by #A-12.')).toBe('A-12')
    expect(replacementIn('Replaced with new styles')).toBeNull()
    expect(replacementIn('11/2025 - Discontinued - no replacement')).toBeNull()
  })
  it('reads out of stock with the back date', () => {
    expect(outOfStockIn('OUT OF STOCK AT VENDOR 10/18/26, BACK 11/15/26')).toEqual({ since: '10/18/26', back: '11/15/26' })
    expect(outOfStockIn('out of stock')).toEqual({ since: null, back: null })
    expect(outOfStockIn('To order Assorted use #71235')).toBeNull()
  })
})

describe('marking the report items', () => {
  it('carries a discontinued item’s need to its replacement and gives DNR items no need', () => {
    const old = item('1', { desc: '*OLD STYLE', vid: '63300', lsNote: 'REPLACED WITH 63360', sold: 12, qoh: 2 })
    const neu = item('2', { desc: 'NEW STYLE', vid: '63360', sold: 3, qoh: 0 })
    const bad = item('3', { desc: '**POOR SELLER', lsNote: 'Nobody buys these', sold: 5, qoh: 0 })
    const oos = item('4', { desc: 'POPULAR', lsNote: 'OUT OF STOCK AT VENDOR 10/18/26, BACK 11/15/26' })
    const plain = item('5', { lsNote: 'To order Assorted use #71235' })
    const counts = markItemStatus([old, neu, bad, oos, plain])
    expect(counts).toEqual({ discontinued: 1, dnr: 1, outOfStock: 1, replaced: 1 })
    expect(old.status).toBe('discontinued')
    expect(old.replacementVid).toBe('63360')
    expect(orderNeed(old)).toBe(0)
    expect(neu.carried).toBe(10)
    expect(orderNeed(neu)).toBe(13)
    expect(neu.notes[0]).toContain('REPLACES 63300 OLD STYLE (sold 12, need 10)')
    expect(bad.status).toBe('dnr')
    expect(orderNeed(bad)).toBe(0)
    expect(bad.notes[0]).toContain('DO NOT REORDER')
    expect(oos.status).toBe('out_of_stock')
    expect(oos.backDate).toBe('11/15/26')
    expect(plain.status).toBeUndefined()
    expect(plain.notes[0]).toContain('LS note')
  })
  it('says when the replacement is not on the report', () => {
    const old = item('1', { desc: '*OLD', lsNote: 'REPLACED WITH 99999' })
    markItemStatus([old])
    expect(old.notes[0]).toContain('not on this report')
  })
  it('keeps the marked items on the Flags tab and out of the need totals', () => {
    const old = item('1', { desc: '*OLD', vid: '63300', lsNote: 'REPLACED WITH 63360', sold: 12, qoh: 2, cat: 'TOYS/SLEDS' })
    const neu = item('2', { desc: 'NEW', vid: '63360', sold: 3, qoh: 0, cat: 'TOYS/SLEDS' })
    markItemStatus([old, neu])
    const plan = planReport([old, neu], 'BECKER', '10/18/26')
    expect(plan.flagged.map((x) => x.sid).sort()).toEqual(['1', '2'])
  })
})
