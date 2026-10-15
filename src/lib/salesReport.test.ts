import { describe, expect, it } from 'vitest'
import { activeRows, initialsOf, lineOf, lsVendorsIn, matchLsVendor, needOf, planReport, readExport, readFormattedReport, reportFileName, runText, type SalesItem } from './salesReport'
import { suggestOrder, suggestionTotal } from './suggestedOrder'
import { buildReportXlsx } from './salesReportXlsx'

const RUN = new Date(2026, 9, 11)
const row = (sid: string, o: Partial<Record<string, unknown>> = {}) => ({
  'Item System ID': sid, 'Item UPC': `0${sid}`, 'Item Default Vendor': 'PARICON - WWD', 'Item Default Vendor ID': `V${sid}`,
  'Item Description': `ITEM ${sid}`, 'Item Default Cost': 2.5, 'Item Category': 'WINTERSPORTS/SLEDS', 'Item Include Archived': 'true',
  'Archived (Yes / No) (Yes / No)': 'No', 'Sale Line Quantity Sold': 10, 'Item Metrics Quantity on Hand': 4, 'Item Metrics Days Since Sold': 3, ...o,
})

describe('reading an LS export', () => {
  it('reads the columns, dedupes System IDs and dates the last sale', () => {
    const items = readExport([row('1'), row('1'), row('2', { 'Item Metrics Quantity on Hand': "'-", 'Item Metrics Days Since Sold': '' })], RUN)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ sid: '1', vid: 'V1', lsVendor: 'PARICON - WWD', sold: 10, qoh: 4, last: '2026-10-08', archived: false })
    expect(items[1]).toMatchObject({ nonInv: true, qoh: 0, last: null })
    expect(needOf(items[0]!)).toBe(6)
  })
  it('says what is missing from a wrong file', () => {
    expect(() => readExport([{ Name: 'x' }], RUN)).toThrow(/System ID/)
  })
  it('finds this vendor among the LS vendors in the file', () => {
    const names = lsVendorsIn(readExport([row('1'), row('2', { 'Item Default Vendor': 'SLIPPERY RACER' }), row('3', { 'Item Default Vendor': 'SLIPPERY RACER' })], RUN)).map((v) => v.name)
    expect(names).toEqual(['SLIPPERY RACER', 'PARICON - WWD'])
    expect(matchLsVendor(names, 'Paricon')).toBe('PARICON - WWD')
    expect(matchLsVendor(names, 'Slippery Racer Inc')).toBe('SLIPPERY RACER')
    expect(matchLsVendor(names, 'Ty')).toBeNull()
  })
})

describe('the report plan', () => {
  const items = readExport([
    row('1'),
    row('2', { 'Sale Line Quantity Sold': 0, 'Item Metrics Quantity on Hand': 0 }),
    row('3', { 'Archived (Yes / No) (Yes / No)': 'Yes', 'Sale Line Quantity Sold': 0, 'Item Metrics Quantity on Hand': 0 }),
    row('4', { 'Archived (Yes / No) (Yes / No)': 'Yes', 'Item Metrics Quantity on Hand': 2 }),
    row('5', { 'Item Default Vendor ID': 'V1', 'Item Category': '' }),
  ], RUN)
  const plan = planReport(items, 'PARICON', runText(RUN))
  it('puts every item on one tab', () => {
    expect(plan.active.map((x) => x.sid).sort()).toEqual(['1', '5'])
    expect(plan.nodata.map((x) => x.sid)).toEqual(['2'])
    expect(plan.ignored.map((x) => x.sid)).toEqual(['3'])
    expect(plan.archived.map((x) => x.sid)).toEqual(['4'])
    expect(plan.title).toBe('PARICON — Report Run 10/11/26')
  })
  it('adds the flag notes, duplicates with their Active row', () => {
    const one = plan.active.find((x) => x.sid === '1')!
    const five = plan.active.find((x) => x.sid === '5')!
    const pos = activeRows(plan)
    expect(one.notes[0]).toBe(`Duplicate – matches row ${pos.get('5')} on Active tab (same Vendor ID). Review which listing to keep — consider merging in LS.`)
    expect(five.notes).toContain('Category missing in LS — verify/correct.')
    expect(plan.archived[0]!.notes[0]).toMatch(/Archived item still shows stock/)
    expect(plan.nodata[0]!.notes[0]).toMatch(/Zero sales, zero stock/)
    expect(plan.duplicates).toBe(1)
  })
  it('groups product lines and names the file', () => {
    expect(lineOf('SLIPPERY RACER SNOWBALL MAKER - GREEN SR102G', 'SLIPPERY RACER')).toBe('SNOWBALL MAKER')
    expect(reportFileName('DP', RUN, 'Paricon', 365)).toBe('DP_10-11-26_PARICON_SALES 365 DAYS.xlsx')
    expect(initialsOf('Dana Powell')).toBe('DP')
  })
  it('writes a workbook with the spec tabs', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await buildReportXlsx(plan))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['By Category', 'By Description', 'Active', 'No Data', 'Flags', 'Archived', 'Archived – No Sales (Ignored)'])
    const active = wb.getWorksheet('Active')!
    expect(active.getCell(2, 10).value).toBe('NEED')
    expect(active.getCell(3, 1).value).toBe('TOTAL')
    expect((active.getCell(4, 10).value as { formula: string }).formula).toBe('H4-MAX(0,I4)')
  })
})

describe('the suggested order', () => {
  const item = (sid: string, vid: string, sold: number, qoh: number): SalesItem => ({ sid, upc: '', lsVendor: 'X', vid, desc: `ITEM ${sid}`, cost: 2, cat: '', archived: false, sold, nonInv: false, qoh, last: null, notes: [] })
  it('takes what is coming in off the need', () => {
    const lines = suggestOrder([item('1', '08800', 30, 5), item('2', 'B2', 10, 2), item('3', 'C3', 1, 9)], [
      { vid: '8800', desc: null, qty: 20, orderId: 'o1', orderLabel: 'PO 1', stage: 'confirmed', expected: '2026-11-01' },
      { vid: null, desc: 'item 2', qty: 3, orderId: 'o2', orderLabel: 'PO 2', stage: 'placed', expected: null },
    ])
    expect(lines.map((l) => [l.sid, l.need, l.onOrder, l.suggested])).toEqual([['1', 25, 20, 5], ['2', 8, 3, 5]])
    expect(lines.find((l) => l.sid === '1')!.from[0]).toMatchObject({ orderLabel: 'PO 1', stage: 'confirmed' })
    expect(suggestionTotal(lines)).toEqual({ units: 10, cost: 20, items: 2 })
  })
})

describe('an already formatted report (WFS v3, Oct 15)', () => {
  const head = ['System ID', 'UPC', 'Vendor ID', 'Description', 'Cost', 'Category', 'Last Sold Date', 'Sold', 'In Stock', 'Need', 'Order', 'Notes']
  it('reads its item tabs back, each System ID once, archived from the Archived tabs', () => {
    const r = readFormattedReport([
      { name: 'Size Summary', rows: [['WFS — Report Run 8/21/26'], ['Gender', 'Subcategory', 'Size', '# SKUs', 'Sold', 'In Stock', 'Need', 'Notes']] },
      { name: 'By Category', rows: [['WFS — Report Run 8/21/26'], head, ['2100', '7163', 'BG-81', 'BAG', 7, 'CAMP', '08/03/26', 5, 11, -6, 'NO', null]] },
      { name: 'Active', rows: [['WFS — Report Run 8/21/26'], head, ['2100', '7163', 'BG-81', 'BAG', 7, 'CAMP', '08/03/26', 5, 11, -6, null, null]] },
      { name: 'Archived - No Sales (Ignored)', rows: [['WFS — Report Run 8/21/26 — ARCHIVED'], head, ['2999', null, null, 'SKILLET', 10.5, '(No Category)', 'Never Sold', 0, 0, 0, null, null]] },
    ])
    expect(r?.runDate).toBe('2026-08-21')
    expect(r?.items.map((x) => [x.sid, x.archived, x.last, x.sold, x.qoh])).toEqual([['2100', false, '2026-08-03', 5, 11], ['2999', true, null, 0, 0]])
  })
  it('is not a raw LS export', () => {
    expect(readFormattedReport([{ name: 'Sheet1', rows: [['Item System ID', 'Description', 'Quantity Sold', 'Quantity on Hand']] }])).toBeNull()
  })
})
