// The items of an email from the suggested order, as an Excel file attached to it (Dana, Nov 9: "I dont want it put
// inline in the email. I want it attached as an excel spreadsheet"). One sheet per list; the header row stays on screen.
import type { Workbook } from 'exceljs'

export interface SheetItem { vid: string | null; upc: string | null; desc: string; qty: number; cost?: number | null }
export interface SheetList { name: string; items: SheetItem[]; qtyHead?: string; withCost?: boolean }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** File name safe for every mail program: "LAZY ONE items for Shaver Lake Sports 11-9-26.xlsx". */
export function orderSheetName(vendorName: string, what: string, on = new Date()): string {
  const d = `${on.getMonth() + 1}-${on.getDate()}-${String(on.getFullYear()).slice(2)}`
  return `${vendorName} ${what} ${d}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function buildOrderSheet(lists: SheetList[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb: Workbook = new ExcelJS.Workbook()
  wb.creator = 'Shaver Lake Sports'
  for (const list of lists) {
    const ws = wb.addWorksheet(list.name.slice(0, 31))
    const heads = ['Vendor ID', 'UPC', 'Description', list.qtyHead ?? 'Qty', ...(list.withCost ? ['Unit cost', 'Total'] : [])]
    ws.addRow(heads)
    ws.getRow(1).font = { bold: true }
    for (const i of list.items) {
      ws.addRow([i.vid ?? '', i.upc ?? '', i.desc, i.qty, ...(list.withCost ? [i.cost ?? null, i.cost != null ? Math.round(i.cost * i.qty * 100) / 100 : null] : [])])
    }
    // UPCs and Vendor IDs stay text, so Excel keeps leading zeros
    ws.getColumn(1).numFmt = '@'
    ws.getColumn(2).numFmt = '@'
    ws.getColumn(1).width = 16
    ws.getColumn(2).width = 15
    ws.getColumn(3).width = 48
    ws.getColumn(4).width = 10
    if (list.withCost) { ws.getColumn(5).width = 11; ws.getColumn(6).width = 11; ws.getColumn(5).numFmt = '$#,##0.00'; ws.getColumn(6).numFmt = '$#,##0.00' }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** The spreadsheet as a file to attach. */
export async function orderSheetFile(lists: SheetList[], fileName: string): Promise<File> {
  return new File([await buildOrderSheet(lists)], fileName, { type: XLSX_MIME })
}
