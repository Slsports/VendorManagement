// A vendor sales report spreadsheet as Dana fills it in (spec v49: VENDOR ID, DESCRIPTION, SOLD, IN STOCK, NEED, ORDER):
// the rows Claude compares a confirmation with when there is no order (Dana, Oct 13). Hand-made reports with the same
// headers work too. Pure, so it can be tested.

export interface SheetItem { vid: string; desc: string; upc: string; sold: number | null; stock: number | null; need: number | null; order: number | null; cost: number | null }
export interface SalesSheet { items: SheetItem[]; column: 'order' | 'need'; sheet: string }

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || v === '-') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Column positions from a header row, or null when it is not the item header (it needs NEED or ORDER and an item column). */
function headerOf(row: unknown[]): Record<keyof SheetItem, number> | null {
  const h = row.map(norm)
  const find = (re: RegExp) => h.findIndex((x) => re.test(x))
  const cols = {
    vid: find(/^(VENDOR ID|VENDOR ITEM|VID|ITEM ?#|STYLE|SKU)$/), desc: find(/^(DESCRIPTION|ITEM|ITEM NAME|NAME)$/), upc: find(/^UPC$/),
    sold: find(/^SOLD$/), stock: find(/^(IN STOCK|QOH|ON HAND)$/), need: find(/^NEED$/), order: find(/^(ORDER|ORDER QTY|QTY TO ORDER)$/),
    cost: find(/^(COST|UNIT COST|AVG COST|AVERAGE COST|LAST COST|DEFAULT COST)$/),
  }
  // an item tab needs NEED or ORDER; a tab with only COST is read for its costs (the By Description tab)
  if ((cols.need < 0 && cols.order < 0 && cols.cost < 0) || (cols.vid < 0 && cols.desc < 0)) return null
  return cols
}

/**
 * The items of the sheet with an item header that has the most quantities typed in Order (Dana fills Order on one tab,
 * e.g. By Category in the WFS report, Oct 15), else the first such sheet; without TOTAL and group rows. Uses the Order
 * column when anything is typed in it, else Need.
 */
export function readSalesSheet(sheets: { name: string; rows: unknown[][] }[]): SalesSheet | null {
  const all = sheets.map(readOneSheet).filter((x): x is SalesSheet & { hasQty: boolean } => !!x)
  const withQty = all.filter((x) => x.hasQty)
  if (!withQty.length) return null
  const ordered = (x: SalesSheet) => x.items.filter((i) => i.order !== null && i.order !== 0).length
  const { hasQty: _, ...best } = withQty.reduce((b, x) => (ordered(x) > ordered(b) ? x : b), withQty[0]!)
  // the cost is often on another tab (Dana, Oct 16: WFS has it on By Description, the column after Description)
  const costs = new Map<string, number>()
  const keys = (i: { vid: string; upc: string; desc: string }) => [i.vid && `v:${key(i.vid)}`, i.upc && `u:${key(i.upc)}`, i.desc && `d:${key(i.desc)}`].filter(Boolean) as string[]
  for (const sh of all) for (const i of sh.items) if (i.cost !== null) for (const k of keys(i)) if (!costs.has(k)) costs.set(k, i.cost)
  const items = best.items.map((i) => (i.cost !== null ? i : { ...i, cost: keys(i).map((k) => costs.get(k)).find((c) => c !== undefined) ?? null }))
  return { ...best, items }
}

const key = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')

function readOneSheet(s: { name: string; rows: unknown[][] }): (SalesSheet & { hasQty: boolean }) | null {
  const at = s.rows.slice(0, 15).findIndex((r) => headerOf(r) !== null)
  if (at < 0) return null
  const c = headerOf(s.rows[at]!)!
  const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : null)
  const items: SheetItem[] = []
  for (const r of s.rows.slice(at + 1)) {
    const vid = String(cell(r, c.vid) ?? '').trim()
    const desc = String(cell(r, c.desc) ?? '').trim()
    if (!vid && !desc) continue
    if (/^(GRAND )?TOTAL\b/i.test(String(r[0] ?? '')) || /^(GRAND )?TOTAL\b/i.test(desc)) continue
    items.push({ vid, desc, upc: String(cell(r, c.upc) ?? '').trim(), sold: num(cell(r, c.sold)), stock: num(cell(r, c.stock)), need: num(cell(r, c.need)), order: num(cell(r, c.order)), cost: num(cell(r, c.cost)) })
  }
  if (!items.length) return null
  if (c.need < 0 && c.order < 0 && !items.some((x) => x.cost !== null)) return null
  return { items, column: items.some((x) => x.order !== null && x.order !== 0) ? 'order' : 'need', sheet: s.name, hasQty: c.need >= 0 || c.order >= 0 }
}

/** The rows worth showing Claude: ordered (or needed) items first, then the rest, at most `max`. */
export function sheetForClaude(s: SalesSheet, max = 500): string {
  const qty = (x: SheetItem) => (s.column === 'order' ? x.order : x.need) ?? 0
  const rows = [...s.items].sort((a, b) => Number(qty(b) > 0) - Number(qty(a) > 0)).slice(0, max)
  return ['VENDOR ID\tDESCRIPTION\tSOLD\tIN STOCK\tNEED\tORDER\tLAST COST', ...rows.map((x) => [x.vid, x.desc, x.sold ?? '', x.stock ?? '', x.need ?? '', x.order ?? '', x.cost ?? ''].join('\t'))].join('\n')
}
