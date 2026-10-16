// The physical inventory count sheet (Inventory Report Formatting Spec v15, docs/inventory-report-spec.md), with a
// VENDOR ID column next to DESCRIPTION (Dana, Oct 16). One sheet, an Excel table, sorted category then description,
// every item in (zero and negative stock stay), FLOOR / BACK STOCK / BINS / TOTAL left blank for the pen.
import type { Workbook } from 'exceljs'

export interface CountLine { system_sku: string; upc: string; vendor_name: string; vendor_item_id: string; description: string; category_path: string; in_stock: number }

const FONT = 'Aptos Narrow'
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } }
// A SYSTEM ID, B ITEM UPC, C VENDOR, D DESCRIPTION, E VENDOR ID, F CATEGORY, G IN STOCK, H FLOOR, I BACK STOCK, J BINS, K TOTAL
const COLS = [
  { head: 'SYSTEM ID', width: 15.86, hdrAlign: 'center', hdrWrap: false, align: 'left', wrap: false, fill: null, hdrBorder: { right: thin, bottom: thin }, border: { right: thin, top: thin, bottom: thin } },
  { head: 'ITEM UPC', width: 14.14, hdrAlign: 'center', hdrWrap: false, align: 'left', wrap: false, fill: null },
  { head: 'VENDOR', width: 17, hdrAlign: 'left', hdrWrap: true, align: 'left', wrap: true, fill: null },
  { head: 'DESCRIPTION', width: 30.29, hdrAlign: 'center', hdrWrap: true, align: 'left', wrap: true, fill: null },
  { head: 'VENDOR ID', width: 14, hdrAlign: 'center', hdrWrap: false, align: 'left', wrap: false, fill: null },
  { head: 'CATEGORY', width: 30, hdrAlign: 'center', hdrWrap: false, align: 'right', wrap: true, fill: null },
  { head: 'IN STOCK', width: 11.86, hdrAlign: 'center', hdrWrap: true, align: 'center', wrap: false, fill: null },
  { head: 'FLOOR', width: 10.57, hdrAlign: 'center', hdrWrap: false, align: 'center', wrap: false, fill: 'FFFBE3D6' },
  { head: 'BACK STOCK', width: 11.43, hdrAlign: 'center', hdrWrap: true, align: 'center', wrap: true, fill: 'FFBDD7EE' },
  { head: 'BINS', width: 8.57, hdrAlign: 'center', hdrWrap: false, align: 'center', wrap: false, fill: 'FFDCEDD5' },
  { head: 'TOTAL', width: 10.57, hdrAlign: 'center', hdrWrap: false, align: 'center', wrap: false, fill: 'FFFFFF00', hdrBorder: { left: thin, bottom: thin }, border: { left: thin, top: thin, bottom: thin } },
] as const

/** "M-D-YY NAME INVENTORY.xlsx" (spec §2). */
export function inventoryFileName(run: Date, name: string): string {
  const d = `${run.getMonth() + 1}-${run.getDate()}-${String(run.getFullYear()).slice(2)}`
  const clean = name.toUpperCase().replace(/_/g, ' ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*INVENTORY$/, '')
  return `${d} ${clean} INVENTORY.xlsx`
}

export const sortCountLines = (lines: CountLine[]) => [...lines].sort((a, b) => a.category_path.localeCompare(b.category_path) || a.description.localeCompare(b.description))

/** The count sheet as an .xlsx file. */
export async function buildInventoryXlsx(lines: CountLine[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb: Workbook = new ExcelJS.Workbook()
  wb.creator = 'VMS'
  const ws = wb.addWorksheet('Inventory')
  const rows = sortCountLines(lines)
  const box = { top: thin, left: thin, bottom: thin, right: thin }
  COLS.forEach((c, i) => {
    const cell = ws.getCell(1, i + 1)
    cell.value = c.head
    cell.font = { name: FONT, size: 11, bold: true }
    cell.alignment = { horizontal: c.hdrAlign, vertical: 'middle', wrapText: c.hdrWrap }
    cell.border = ('hdrBorder' in c ? c.hdrBorder : { left: thin, right: thin, bottom: thin }) as never
    if (c.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } }
    ws.getColumn(i + 1).width = c.width
  })
  ws.getRow(1).height = 30
  rows.forEach((l, r) => {
    const vals = [l.system_sku, l.upc, l.vendor_name, l.description, l.vendor_item_id, l.category_path, l.in_stock, null, null, null, null]
    vals.forEach((v, i) => {
      const c = COLS[i]!
      const cell = ws.getCell(r + 2, i + 1)
      cell.value = v as never
      cell.font = { name: FONT, size: 11 }
      cell.alignment = { horizontal: c.align, vertical: 'middle', wrapText: c.wrap }
      cell.border = ('border' in c ? c.border : box) as never
      if (i <= 1 || i === 4) cell.numFmt = '@'
      if (c.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } }
    })
  })
  if (rows.length) {
    ws.addTable({
      name: 'Table1', ref: 'A1', headerRow: true, totalsRow: false,
      style: { theme: 'TableStyleLight15', showRowStripes: true, showColumnStripes: false },
      columns: COLS.map((c) => ({ name: c.head, filterButton: true })),
      rows: rows.map((l) => [l.system_sku, l.upc, l.vendor_name, l.description, l.vendor_item_id, l.category_path, l.in_stock, null, null, null, null]),
    })
    // the table rewrote the body: put the fonts, fills and borders back
    rows.forEach((_l, r) => COLS.forEach((c, i) => {
      const cell = ws.getCell(r + 2, i + 1)
      cell.font = { name: FONT, size: 11 }
      cell.alignment = { horizontal: c.align, vertical: 'middle', wrapText: c.wrap }
      cell.border = ('border' in c ? c.border : box) as never
      if (i <= 1 || i === 4) cell.numFmt = '@'
      if (c.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } }
    }))
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
