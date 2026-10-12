// Write a vendor sales report workbook (spec v49 look: Aptos Narrow, boxed cells, green Need, yellow Order, gray TOTAL
// rows with SUM/SUMIF formulas, blue product-line headers, light-green flag rows) from a plan made by salesReport.ts.
import type { Workbook, Worksheet, Fill } from 'exceljs'
import { needOf, type ReportGroup, type ReportPlan, type SalesItem } from './salesReport'

const FONT = 'Aptos Narrow'
const HEAD = ['System ID', 'UPC', 'VENDOR ID', 'DESCRIPTION', 'COST', 'CATEGORY', 'LAST SOLD DATE', 'SOLD', 'IN STOCK', 'NEED', 'ORDER', 'NOTES'] as const
const C = Object.fromEntries(HEAD.map((h, i) => [h, i + 1])) as Record<(typeof HEAD)[number], number>
const L = (n: number) => String.fromCharCode(64 + n)
const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const NEED_FILL = solid('FFDDEDD3'), ORDER_FILL = solid('FFFFFF00'), FLAG_FILL = solid('FFE2EFDA'), TOTAL_FILL = solid('FFD9D9D9'), GROUP_FILL = solid('FF1F4E79')
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } }
const BOX = { top: thin, left: thin, bottom: thin, right: thin }

function header(ws: Worksheet, title: string, cols: readonly string[]) {
  ws.mergeCells(1, 1, 1, cols.length)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { name: FONT, size: 20 }
  t.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 30
  cols.forEach((h, i) => {
    const c = ws.getCell(2, i + 1)
    c.value = h
    c.font = { name: FONT, size: 11, bold: true }
    c.border = BOX
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
}

function itemRow(ws: Worksheet, r: number, x: SalesItem, shade: boolean) {
  const last = x.last ? new Date(`${x.last}T12:00:00`) : 'Never Sold'
  const vals = [x.sid, x.upc, x.vid, x.desc, x.cost, x.cat || '(No Category)', last, x.sold, x.nonInv ? '-' : x.qoh, null, null, x.notes.join(' ')]
  vals.forEach((v, i) => {
    const h = HEAD[i]!
    const c = ws.getCell(r, i + 1)
    c.value = v as never
    c.font = { name: FONT, size: 11 }
    c.border = BOX
    c.alignment = { horizontal: h === 'DESCRIPTION' || h === 'NOTES' ? 'left' : h === 'CATEGORY' ? 'right' : 'center', vertical: 'middle', wrapText: h === 'NOTES' }
    if (h === 'System ID' || h === 'UPC' || h === 'VENDOR ID') c.numFmt = '@'
    if (h === 'COST') c.numFmt = '$#,##0.00'
    if (h === 'LAST SOLD DATE' && last instanceof Date) c.numFmt = 'm/d/yy'
  })
  const need = ws.getCell(r, C.NEED)
  need.value = x.nonInv ? null : { formula: `${L(C.SOLD)}${r}-MAX(0,${L(C['IN STOCK'])}${r})`, result: needOf(x) }
  need.fill = NEED_FILL
  ws.getCell(r, C.ORDER).fill = ORDER_FILL
  if (shade && x.notes.length) for (let i = 1; i <= HEAD.length; i++) if (i !== C.NEED && i !== C.ORDER) ws.getCell(r, i).fill = FLAG_FILL
}

function totalRow(ws: Worksheet, r: number, a: number, b: number, label = 'TOTAL') {
  for (let i = 1; i <= HEAD.length; i++) {
    const c = ws.getCell(r, i)
    c.font = { name: FONT, size: 11, bold: true }
    c.fill = TOTAL_FILL
    c.border = BOX
    c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle' }
  }
  ws.getCell(r, 1).value = label
  for (const h of ['SOLD', 'IN STOCK', 'ORDER'] as const) ws.getCell(r, C[h]).value = b >= a ? { formula: `SUM(${L(C[h])}${a}:${L(C[h])}${b})` } : 0
  ws.getCell(r, C.NEED).value = b >= a ? { formula: `SUMIF(${L(C.NEED)}${a}:${L(C.NEED)}${b},">0")` } : 0
}

function table(ws: Worksheet, title: string, rows: SalesItem[], opts: { total: boolean; groups?: ReportGroup[] | null; shade?: boolean }) {
  header(ws, title, HEAD)
  let r = 3
  const shade = opts.shade ?? true
  if (opts.groups) {
    for (const g of opts.groups) {
      ws.mergeCells(r, 1, r, HEAD.length)
      const c = ws.getCell(r, 1)
      c.value = g.name
      c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = GROUP_FILL
      r++
      const t = r++
      const a = r
      for (const x of g.items) itemRow(ws, r++, x, shade)
      totalRow(ws, t, a, r - 1, `TOTAL — ${g.name}`)
    }
  } else {
    const t = opts.total ? r++ : 0
    const a = r
    for (const x of rows) itemRow(ws, r++, x, shade)
    if (t) totalRow(ws, t, a, r - 1)
  }
  ws.views = [{ state: 'frozen', ySplit: opts.total && !opts.groups ? 3 : 2, zoomScale: 100 }]
  // widths from the content; Notes wrapped and capped
  const all = opts.groups ? opts.groups.flatMap((g) => g.items) : rows
  HEAD.forEach((h, i) => {
    const longest = Math.max(h.length, ...all.map((x) => String([x.sid, x.upc, x.vid, x.desc, x.cost ?? '', x.cat, '00/00/00', x.sold, x.qoh, '', '', x.notes.join(' ')][i] ?? '').length))
    let w = Math.max(longest, h === 'SOLD' || h === 'NEED' || h === 'ORDER' ? 6 : 8) + 2
    if (h === 'NOTES') w = Math.min(Math.max(w, 30), 60)
    ws.getColumn(i + 1).width = Math.min(w, 70)
  })
}

function sizeSummary(ws: Worksheet, plan: ReportPlan) {
  const cols = ['TYPE', '# SKUs', 'SOLD', 'IN STOCK', 'NEED']
  header(ws, plan.title, cols)
  let r = 3
  const cats = [...new Set(plan.summary.map((s) => s.category))]
  for (const cat of cats) {
    ws.mergeCells(r, 1, r, cols.length)
    const g = ws.getCell(r, 1)
    const parts = cat.split('/')
    g.value = parts.length > 1 ? parts.slice(1).join(' / ') : cat || '(No Category)'
    g.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    g.fill = GROUP_FILL
    r++
    const t = r++
    const a = r
    for (const s of plan.summary.filter((x) => x.category === cat)) {
      ;[s.type, s.skus, s.sold, s.inStock, s.need].forEach((v, i) => {
        const c = ws.getCell(r, i + 1)
        c.value = v
        c.font = { name: FONT, size: 11 }
        c.border = BOX
        c.alignment = { horizontal: i === 0 ? 'left' : 'center' }
      })
      ws.getCell(r, 5).fill = NEED_FILL
      r++
    }
    const b = r - 1
    ws.getCell(t, 1).value = 'TOTAL'
    ;['B', 'C', 'D'].forEach((col, i) => { ws.getCell(t, i + 2).value = { formula: `SUM(${col}${a}:${col}${b})` } })
    ws.getCell(t, 5).value = { formula: `SUMIF(E${a}:E${b},">0")` }
    for (let i = 1; i <= cols.length; i++) {
      const c = ws.getCell(t, i)
      c.font = { name: FONT, size: 11, bold: true }
      c.fill = TOTAL_FILL
      c.border = BOX
      c.alignment = { horizontal: i === 1 ? 'left' : 'center' }
    }
    r++
  }
  const note = ws.getCell(r + 1, 1)
  note.value = 'Need per type = sum of each item’s positive Need (Sold − In Stock); overstock in one item never offsets another. Grouped by product line (spec Step 7).'
  note.font = { name: FONT, size: 9, italic: true }
  ws.views = [{ state: 'frozen', ySplit: 2 }]
  ws.getColumn(1).width = Math.max(12, ...plan.summary.map((s) => s.type.length)) + 4
  for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 11
}

/** The formatted report as an .xlsx file. */
export async function buildReportXlsx(plan: ReportPlan): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb: Workbook = new ExcelJS.Workbook()
  wb.creator = 'VMS'
  const total = !plan.byLine
  if (plan.byLine) sizeSummary(wb.addWorksheet('Size Summary'), plan)
  table(wb.addWorksheet('By Category'), plan.title, [...plan.active].sort((a, b) => a.cat.localeCompare(b.cat) || needOf(b) - needOf(a) || a.desc.localeCompare(b.desc)), { total: true, groups: plan.categoryGroups })
  table(wb.addWorksheet('By Description'), plan.title, [...plan.active].sort((a, b) => a.desc.localeCompare(b.desc) || needOf(b) - needOf(a)), { total: true, groups: plan.descriptionGroups })
  table(wb.addWorksheet('Active'), plan.title, plan.active, { total, groups: plan.activeGroups })
  table(wb.addWorksheet('No Data'), plan.title, plan.nodata, { total })
  const flags = wb.addWorksheet('Flags')
  table(flags, plan.title, plan.flagged, { total, shade: false })
  table(wb.addWorksheet('Archived'), plan.title, plan.archived, { total })
  table(wb.addWorksheet('Archived – No Sales (Ignored)'), plan.title, plan.ignored, { total: false, shade: false })
  // Flags is printed black and white: no colored cells below the headers
  flags.eachRow((row, n) => { if (n >= 3) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'none' } }) })
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
