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

describe('a report with Order filled on one tab (WFS, Oct 15)', () => {
  it('uses the tab with the Order quantities, not the first one', () => {
    const head = ['System ID', 'UPC', 'Vendor ID', 'Description', 'Cost', 'Category', 'Last Sold Date', 'Sold', 'In Stock', 'Need', 'Order', 'Notes']
    const s = readSalesSheet([
      { name: 'Size Summary', rows: [['WFS — Report Run 8/21/26'], ['Gender', 'Subcategory', 'Size', '# SKUs', 'Sold', 'In Stock', 'Need', 'Notes'], ['N/A', 'Pads', 'TOTAL', 1, 8, 10, 0, null]] },
      { name: 'Active', rows: [['WFS — Report Run 8/21/26'], head, ['2100', '', 'BG-81', 'BAG', 7, 'CAMP', '08/01/26', 20, 2, 18, null, null]] },
      { name: 'By Category', rows: [['WFS — Report Run 8/21/26'], head, ['2100', '', 'BG-81', 'BAG', 7, 'CAMP', '08/01/26', 20, 2, 18, 18, null], ['2101', '', '983', 'MAT', 4, 'CAMP', '08/01/26', 3, 9, -6, 'NO', null]] },
    ])
    expect(s?.sheet).toBe('By Category')
    expect(s?.column).toBe('order')
    expect(s?.items.map((x) => x.order)).toEqual([18, null])
  })
})
