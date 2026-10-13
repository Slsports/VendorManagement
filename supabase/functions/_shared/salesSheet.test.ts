import { describe, expect, it } from 'vitest'
import { readSalesSheet, sheetForClaude } from './salesSheet'

const head = ['System ID', 'UPC', 'VENDOR ID', 'DESCRIPTION', 'COST', 'CATEGORY', 'LAST SOLD DATE', 'SOLD', 'IN STOCK', 'NEED', 'ORDER', 'NOTES']

describe('sales report spreadsheets', () => {
  it('reads the Order column when Dana filled it in', () => {
    const s = readSalesSheet([{ name: 'By Category', rows: [
      ['WORLD FAMOUS SPORTS'], head,
      ['1', '', 'BG-81', 'DUFFEL BAG 81', 9.5, 'BAGS', '', 20, 2, 18, 18, ''],
      ['2', '', '983', 'CAMP CHAIR', 12, 'CHAIRS', '', 14, 2, 12, 12, ''],
      ['3', '', '555', 'TARP', 5, 'TARPS', '', 3, 5, -2, null, ''],
      ['TOTAL', '', '', '', '', '', '', 37, 9, 28, 30, ''],
    ] }])
    expect(s?.column).toBe('order')
    expect(s?.items.map((x) => [x.vid, x.order])).toEqual([['BG-81', 18], ['983', 12], ['555', null]])
    expect(sheetForClaude(s!).split('\n')[1]).toBe('BG-81\tDUFFEL BAG 81\t20\t2\t18\t18')
  })
  it('falls back to Need when Order is empty, and skips sheets without the item header', () => {
    const s = readSalesSheet([
      { name: 'Summary', rows: [['Type', 'SKUs'], ['Bags', 3]] },
      { name: 'By Description', rows: [head, ['1', '', 'BG-81', 'DUFFEL', 9.5, '', '', 20, 2, 18, '', '']] },
    ])
    expect(s).toMatchObject({ column: 'need', sheet: 'By Description' })
    expect(s?.items[0]?.need).toBe(18)
  })
  it('gives up on a sheet with no Need or Order column', () => {
    expect(readSalesSheet([{ name: 'x', rows: [['VENDOR ID', 'DESCRIPTION'], ['A', 'B']] }])).toBeNull()
  })
})
