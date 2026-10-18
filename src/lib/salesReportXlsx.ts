// Write a sales report workbook (spec v49 look: Aptos Narrow, boxed cells, green Need, yellow Order, gray TOTAL rows
// with SUM/SUMIF formulas, blue product-line headers, light-green flag rows) from a plan made by salesReport.ts.
// Vendor reports: System ID … By Description tab. Category reports: a VENDOR column and a By Vendor tab. Stores kept
// apart: a SOLD and an IN STOCK column per store, then the combined NEED.
import type { Workbook, Worksheet, Fill } from 'exceljs'
import { needOf, orderNeed, type ReportGroup, type ReportPlan, type SalesItem } from './salesReport'

const FONT = 'Aptos Narrow'
const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const NEED_FILL = solid('FFDDEDD3'), ORDER_FILL = solid('FFFFFF00'), FLAG_FILL = solid('FFE2EFDA'), TOTAL_FILL = solid('FFD9D9D9'), GROUP_FILL = solid('FF1F4E79')
// Dana, Oct 18: discontinued and DNR rows in salmon, out-of-stock rows in light blue, so they stand out from the flag green
const STOP_FILL = solid('FFF8CBAD'), OOS_FILL = solid('FFDDEBF7')
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } }
const BOX = { top: thin, left: thin, bottom: thin, right: thin }

type ColKey = 'sid' | 'upc' | 'vendor' | 'vid' | 'desc' | 'cost' | 'cat' | 'last' | 'sold' | 'qoh' | 'need' | 'onorder' | 'after' | 'order' | 'notes'
interface Col { key: ColKey; head: string; store?: string }
interface Layout { cols: Col[]; at: (key: ColKey, store?: string) => number; soldCols: number[]; qohCols: number[] }

/** The columns of the item tabs for this plan (spec order; the Vendor column and per-store columns when the plan asks). */
function layout(plan: ReportPlan): Layout {
  const cols: Col[] = [{ key: 'sid', head: 'System ID' }, { key: 'upc', head: 'UPC' }]
  if (plan.kind === 'category') cols.push({ key: 'vendor', head: 'VENDOR' })
  cols.push({ key: 'vid', head: 'VENDOR ID' }, { key: 'desc', head: 'DESCRIPTION' }, { key: 'cost', head: 'COST' }, { key: 'cat', head: 'CATEGORY' }, { key: 'last', head: 'LAST SOLD DATE' })
  if (plan.stores?.length) {
    for (const s of plan.stores) cols.push({ key: 'sold', head: `${s} SOLD`, store: s })
    for (const s of plan.stores) cols.push({ key: 'qoh', head: `${s} IN STOCK`, store: s })
  } else {
    cols.push({ key: 'sold', head: 'SOLD' }, { key: 'qoh', head: 'IN STOCK' })
  }
  cols.push({ key: 'need', head: 'NEED' })
  if (plan.onOrder) cols.push({ key: 'onorder', head: 'ON ORDER' }, { key: 'after', head: 'NEED AFTER ORDERS' })
  cols.push({ key: 'order', head: 'ORDER' }, { key: 'notes', head: 'NOTES' })
  const at = (key: ColKey, store?: string) => cols.findIndex((c) => c.key === key && (store === undefined || c.store === store)) + 1
  const soldCols = cols.map((c, i) => (c.key === 'sold' ? i + 1 : 0)).filter(Boolean)
  const qohCols = cols.map((c, i) => (c.key === 'qoh' ? i + 1 : 0)).filter(Boolean)
  return { cols, at, soldCols, qohCols }
}

const L = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

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

function cellValue(x: SalesItem, c: Col): unknown {
  switch (c.key) {
    case 'sid': return x.sid
    case 'upc': return x.upc
    case 'vendor': return x.lsVendor
    case 'vid': return x.vid
    case 'desc': return x.desc
    case 'cost': return x.cost
    case 'cat': return x.cat || '(No Category)'
    case 'last': return x.last ? new Date(`${x.last}T12:00:00`) : 'Never Sold'
    case 'sold': return c.store ? (x.byStore?.[c.store]?.sold ?? 0) : x.sold
    case 'qoh': return x.nonInv ? '-' : c.store ? (x.byStore?.[c.store]?.qoh ?? 0) : x.qoh
    case 'onorder': return x.onOrder ?? 0
    // a discontinued or DNR item is not ordered; a replacement starts with the need it carries (Dana, Oct 18)
    case 'order': return x.status === 'discontinued' || x.status === 'dnr' ? 0 : x.carried ? orderNeed(x) : null
    default: return null
  }
}

function itemRow(ws: Worksheet, lay: Layout, r: number, x: SalesItem, shade: boolean) {
  lay.cols.forEach((col, i) => {
    const c = ws.getCell(r, i + 1)
    const v = col.key === 'notes' ? x.notes.join(' ') : cellValue(x, col)
    c.value = v as never
    c.font = { name: FONT, size: 11 }
    c.border = BOX
    c.alignment = { horizontal: col.key === 'desc' || col.key === 'notes' || col.key === 'vendor' ? 'left' : col.key === 'cat' ? 'right' : 'center', vertical: 'middle', wrapText: col.key === 'notes' }
    if (col.key === 'sid' || col.key === 'upc' || col.key === 'vid') c.numFmt = '@'
    if (col.key === 'cost') c.numFmt = '$#,##0.00'
    if (col.key === 'last' && v instanceof Date) c.numFmt = 'm/d/yy'
  })
  const need = ws.getCell(r, lay.at('need'))
  const soldSum = lay.soldCols.map((n) => `${L(n)}${r}`).join('+')
  const qohSum = lay.qohCols.map((n) => `${L(n)}${r}`).join('+')
  need.value = x.nonInv ? null : { formula: `${lay.soldCols.length > 1 ? `(${soldSum})` : soldSum}-MAX(0,${qohSum})`, result: needOf(x) }
  need.fill = NEED_FILL
  if (lay.at('after') > 0) {
    const after = ws.getCell(r, lay.at('after'))
    after.value = x.nonInv ? null : { formula: `${L(lay.at('need'))}${r}-${L(lay.at('onorder'))}${r}`, result: needOf(x) - (x.onOrder ?? 0) }
    after.fill = NEED_FILL
  }
  ws.getCell(r, lay.at('order')).fill = ORDER_FILL
  const rowFill = x.status === 'discontinued' || x.status === 'dnr' ? STOP_FILL : x.status === 'out_of_stock' ? OOS_FILL : x.notes.length ? FLAG_FILL : null
  if (shade && rowFill) for (let i = 1; i <= lay.cols.length; i++) if (i !== lay.at('need') && i !== lay.at('after') && i !== lay.at('order')) ws.getCell(r, i).fill = rowFill
}

function totalRow(ws: Worksheet, lay: Layout, r: number, a: number, b: number, label = 'TOTAL', rows: SalesItem[] = []) {
  for (let i = 1; i <= lay.cols.length; i++) {
    const c = ws.getCell(r, i)
    c.font = { name: FONT, size: 11, bold: true }
    c.fill = TOTAL_FILL
    c.border = BOX
    c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle' }
  }
  ws.getCell(r, 1).value = label
  for (const n of [...lay.soldCols, ...lay.qohCols, lay.at('order'), ...(lay.at('onorder') > 0 ? [lay.at('onorder')] : [])]) {
    const col = lay.cols[n - 1]!
    const result = rows.reduce((t, x) => t + Number(cellValue(x, col) || 0), 0)
    ws.getCell(r, n).value = b >= a ? { formula: `SUM(${L(n)}${a}:${L(n)}${b})`, result } : 0
  }
  const need = lay.at('need')
  ws.getCell(r, need).value = b >= a ? { formula: `SUMIF(${L(need)}${a}:${L(need)}${b},">0")`, result: rows.reduce((t, x) => t + (x.nonInv ? 0 : Math.max(0, needOf(x))), 0) } : 0
  const after = lay.at('after')
  if (after > 0) ws.getCell(r, after).value = b >= a ? { formula: `SUMIF(${L(after)}${a}:${L(after)}${b},">0")`, result: rows.reduce((t, x) => t + (x.nonInv ? 0 : Math.max(0, needOf(x) - (x.onOrder ?? 0))), 0) } : 0
}

function table(ws: Worksheet, lay: Layout, title: string, rows: SalesItem[], opts: { total: boolean; groups?: ReportGroup[] | null; shade?: boolean }) {
  header(ws, title, lay.cols.map((c) => c.head))
  let r = 3
  const shade = opts.shade ?? true
  if (opts.groups) {
    for (const g of opts.groups) {
      ws.mergeCells(r, 1, r, lay.cols.length)
      const c = ws.getCell(r, 1)
      c.value = g.name
      c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = GROUP_FILL
      r++
      const t = r++
      const a = r
      for (const x of g.items) itemRow(ws, lay, r++, x, shade)
      totalRow(ws, lay, t, a, r - 1, `TOTAL — ${g.name}`, g.items)
    }
  } else {
    const t = opts.total ? r++ : 0
    const a = r
    for (const x of rows) itemRow(ws, lay, r++, x, shade)
    if (t) totalRow(ws, lay, t, a, r - 1, 'TOTAL', rows)
  }
  ws.views = [{ state: 'frozen', ySplit: opts.total && !opts.groups ? 3 : 2, zoomScale: 100 }]
  // widths from the content; Notes wrapped and capped
  const all = opts.groups ? opts.groups.flatMap((g) => g.items) : rows
  lay.cols.forEach((col, i) => {
    const longest = Math.max(col.head.length, ...all.map((x) => String((col.key === 'notes' ? x.notes.join(' ') : col.key === 'last' ? '00/00/00' : cellValue(x, col)) ?? '').length))
    let w = Math.max(longest, col.key === 'sold' || col.key === 'need' || col.key === 'order' ? 6 : 8) + 2
    if (col.key === 'notes') w = Math.min(Math.max(w, 30), 60)
    ws.getColumn(i + 1).width = Math.min(w, 70)
  })
}

/** Spec Step 7: toys and other product-line vendors get a TYPE summary instead of sizes. */
function typeSummary(ws: Worksheet, plan: ReportPlan) {
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
    const list = plan.summary.filter((x) => x.category === cat)
    ws.getCell(t, 1).value = 'TOTAL'
    ;[['B', 'skus'], ['C', 'sold'], ['D', 'inStock']].forEach(([col, k], i) => { ws.getCell(t, i + 2).value = { formula: `SUM(${col}${a}:${col}${b})`, result: list.reduce((x, y) => x + (y[k as 'skus' | 'sold' | 'inStock']), 0) } })
    ws.getCell(t, 5).value = { formula: `SUMIF(E${a}:E${b},">0")`, result: list.reduce((x, y) => x + Math.max(0, y.need), 0) }
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

/** The Size Summary (spec v49): Gender, Subcategory, Size, # SKUs, Sold, In Stock, Need, ORDER, Notes; a TOTAL row per gender and subcategory. */
function sizeSummary(ws: Worksheet, plan: ReportPlan) {
  const cols = plan.onOrder ? ['Gender', 'Subcategory', 'Size', '# SKUs', 'Sold', 'In Stock', 'Need', 'On Order', 'Need After Orders', 'ORDER', 'Notes'] : ['Gender', 'Subcategory', 'Size', '# SKUs', 'Sold', 'In Stock', 'Need', 'ORDER', 'Notes']
  const oo = plan.onOrder ? 2 : 0
  header(ws, plan.title, cols)
  let r = 3
  const rows = plan.sizes ?? []
  const groups = [...new Set(rows.map((s) => `${s.gender}\u0000${s.subcategory}`))]
  for (const g of groups) {
    const [gender, sub] = g.split('\u0000')
    const list = rows.filter((s) => `${s.gender}\u0000${s.subcategory}` === g)
    const t = r++
    const a = r
    for (const s of list) {
      const note = s.variants.length > 1 ? `Sizes written as ${s.variants.join(', ')}` : ''
      const vals = plan.onOrder ? [gender || '—', sub, s.size, s.skus, s.sold, s.inStock, s.need, s.onOrder, Math.max(0, s.need - s.onOrder), null, note] : [gender || '—', sub, s.size, s.skus, s.sold, s.inStock, s.need, null, note]
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1)
        c.value = v as never
        c.font = { name: FONT, size: 11 }
        c.border = BOX
        c.alignment = { horizontal: i < 3 || i === cols.length - 1 ? 'left' : 'center', vertical: 'middle', wrapText: i === cols.length - 1 }
      })
      ws.getCell(r, 7).fill = NEED_FILL
      if (plan.onOrder) ws.getCell(r, 9).fill = NEED_FILL
      ws.getCell(r, 8 + oo).fill = ORDER_FILL
      r++
    }
    const b = r - 1
    ;[gender || '—', sub, 'TOTAL'].forEach((v, i) => { ws.getCell(t, i + 1).value = v })
    ;[['D', 'skus'], ['E', 'sold'], ['F', 'inStock']].forEach(([col, k], i) => { ws.getCell(t, i + 4).value = { formula: `SUM(${col}${a}:${col}${b})`, result: list.reduce((x, y) => x + y[k as 'skus' | 'sold' | 'inStock'], 0) } })
    ws.getCell(t, 7).value = { formula: `SUMIF(G${a}:G${b},">0")`, result: list.reduce((x, y) => x + Math.max(0, y.need), 0) }
    if (plan.onOrder) {
      ws.getCell(t, 8).value = { formula: `SUM(H${a}:H${b})`, result: list.reduce((x, y) => x + y.onOrder, 0) }
      ws.getCell(t, 9).value = { formula: `SUMIF(I${a}:I${b},">0")`, result: list.reduce((x, y) => x + Math.max(0, y.need - y.onOrder), 0) }
    }
    ws.getCell(t, 8 + oo).value = { formula: `SUM(${L(8 + oo)}${a}:${L(8 + oo)}${b})`, result: 0 }
    for (let i = 1; i <= cols.length; i++) {
      const c = ws.getCell(t, i)
      c.font = { name: FONT, size: 11, bold: true }
      c.fill = TOTAL_FILL
      c.border = BOX
      c.alignment = { horizontal: i < 3 ? 'left' : 'center' }
    }
  }
  const note = ws.getCell(r + 1, 1)
  note.value = 'Need per size = sum of each item’s positive Need (Sold − In Stock); overstock in one size never offsets another. Spelling variants of a size (SZ 8, SIZE 8) are one row.'
  note.font = { name: FONT, size: 9, italic: true }
  ws.views = [{ state: 'frozen', ySplit: 2 }]
  ;(plan.onOrder ? [10, Math.max(14, ...rows.map((s) => s.subcategory.length)) + 2, 9, 8, 8, 10, 8, 9, 11, 8, 36] : [10, Math.max(14, ...rows.map((s) => s.subcategory.length)) + 2, 9, 8, 8, 10, 8, 8, 36]).forEach((w, i) => { ws.getColumn(i + 1).width = w })
}

/** The formatted report as an .xlsx file. */
export async function buildReportXlsx(plan: ReportPlan): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb: Workbook = new ExcelJS.Workbook()
  wb.creator = 'VMS'
  const lay = layout(plan)
  const total = !plan.byLine
  if (plan.sizes?.length) sizeSummary(wb.addWorksheet('Size Summary'), plan)
  else if (plan.byLine) typeSummary(wb.addWorksheet('Size Summary'), plan)
  table(wb.addWorksheet('By Category'), lay, plan.title, [...plan.active].sort((a, b) => a.cat.localeCompare(b.cat) || needOf(b) - needOf(a) || a.desc.localeCompare(b.desc)), { total: true, groups: plan.categoryGroups })
  if (plan.kind === 'category') table(wb.addWorksheet('By Vendor'), lay, plan.title, [...plan.active].sort((a, b) => a.lsVendor.localeCompare(b.lsVendor) || a.desc.localeCompare(b.desc) || needOf(b) - needOf(a)), { total: true, groups: plan.vendorGroups })
  else table(wb.addWorksheet('By Description'), lay, plan.title, [...plan.active].sort((a, b) => a.desc.localeCompare(b.desc) || needOf(b) - needOf(a)), { total: true, groups: plan.descriptionGroups })
  // spec tab order: a category report lists Flags before Active; a vendor report after No Data
  const flags = plan.kind === 'category' ? wb.addWorksheet('Flags') : null
  if (flags) table(flags, lay, plan.title, plan.flagged, { total, shade: false })
  table(wb.addWorksheet('Active'), lay, plan.title, plan.active, { total, groups: plan.activeGroups })
  table(wb.addWorksheet('No Data'), lay, plan.title, plan.nodata, { total })
  const flagsLate = flags ?? wb.addWorksheet('Flags')
  if (!flags) table(flagsLate, lay, plan.title, plan.flagged, { total, shade: false })
  table(wb.addWorksheet('Archived'), lay, plan.title, plan.archived, { total })
  table(wb.addWorksheet('Archived – No Sales (Ignored)'), lay, plan.title, plan.ignored, { total: false, shade: false })
  // Flags is printed black and white: no colored cells below the headers
  flagsLate.eachRow((row, n) => { if (n >= 3) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'none' } }) })
  if (plan.openOrders.length) {
    const r = flagsLate.rowCount + 2
    const c = flagsLate.getCell(r, 1)
    c.value = `Open orders with no item list in VMS (check by hand): ${plan.openOrders.join('; ')}`
    c.font = { name: FONT, size: 11, bold: true }
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
