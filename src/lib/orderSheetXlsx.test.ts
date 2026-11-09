import { describe, expect, it } from 'vitest'
import { buildOrderSheet, orderSheetName } from './orderSheetXlsx'

describe('order sheet attachment', () => {
  it('has Vendor ID, UPC, Description and Qty, UPCs kept as text', async () => {
    const ExcelJS = (await import('exceljs')).default
    const buf = await buildOrderSheet([{ name: 'Please add', withCost: true, items: [{ vid: 'PJ123', upc: '012345678905', desc: 'Bear Bellies PJ', qty: 6, cost: 9.5 }] }])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('Please add')!
    expect(ws.getRow(1).values).toEqual([undefined, 'Vendor ID', 'UPC', 'Description', 'Qty', 'Unit cost', 'Total'])
    expect(ws.getRow(2).getCell(2).value).toBe('012345678905')
    expect(ws.getRow(2).getCell(6).value).toBe(57)
  })
  it('names the file plainly', () => {
    expect(orderSheetName('LAZY ONE', 'reorder items', new Date(2026, 10, 9))).toBe('LAZY ONE reorder items 11-9-26.xlsx')
  })
})
