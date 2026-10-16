import { describe, expect, it } from 'vitest'
import { buildInventoryXlsx, inventoryFileName, sortCountLines } from './inventoryXlsx'

describe('the inventory count sheet (spec v15, Vendor ID next to Description)', () => {
  it('names the file, sorts category then description, and writes the columns', async () => {
    expect(inventoryFileName(new Date(2026, 7, 17), 'Camping Minus Coghlan')).toBe('8-17-26 CAMPING MINUS COGHLAN INVENTORY.xlsx')
    const lines = sortCountLines([
      { system_sku: '2', upc: '', vendor_name: 'COGHLAN', vendor_item_id: 'C2', description: 'TENT STAKES', category_path: 'CAMPING/TENTS', in_stock: 3 },
      { system_sku: '1', upc: '0123', vendor_name: 'COGHLAN', vendor_item_id: 'C1', description: 'STOVE', category_path: 'CAMPING/COOKING', in_stock: -1 },
    ])
    expect(lines.map((l) => l.description)).toEqual(['STOVE', 'TENT STAKES'])
    const bytes = await buildInventoryXlsx(lines)
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes)
    const ws = wb.getWorksheet('Inventory')!
    expect(ws.getRow(1).values).toEqual([undefined, 'SYSTEM ID', 'ITEM UPC', 'VENDOR', 'DESCRIPTION', 'VENDOR ID', 'CATEGORY', 'IN STOCK', 'FLOOR', 'BACK STOCK', 'BINS', 'TOTAL'])
    expect(ws.getCell(2, 4).value).toBe('STOVE')
    expect(ws.getCell(2, 5).value).toBe('C1')
    expect(ws.getCell(2, 7).value).toBe(-1)
    expect(ws.getCell(2, 11).value).toBeNull()
  })
})
