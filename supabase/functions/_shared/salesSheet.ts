// A vendor sales report spreadsheet as Dana fills it in (spec v49: VENDOR ID, DESCRIPTION, SOLD, IN STOCK, NEED, ORDER):
// the rows Claude compares a confirmation with when there is no order (Dana, Oct 13). Hand-made reports with the same
// headers work too. Pure, so it can be tested.

export interface SheetItem { vid: string; desc: string; upc: string; sold: number | null; stock: number | null; need: number | null; order: number | null }
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
  }
  if ((cols.need < 0 && cols.order < 0) || (cols.vid < 0 && cols.desc < 0)) return null
  return cols
}

/**
 * The items of the first sheet with an item header, without TOTAL and group rows. Uses the Order column when anything
 * is typed in it, else Need.
 */
export function readSalesSheet(sheets: { name: string; rows: unknown[][] }[]): SalesSheet | null {
  for (const s of sheets) {
    const at = s.rows.slice(0, 15).findIndex((r) => headerOf(r) !== null)
    if (at < 0) continue
    const c = headerOf(s.rows[at]!)!
    const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : null)
    const items: SheetItem[] = []
    for (const r of s.rows.slice(at + 1)) {
      const vid = String(cell(r, c.vid) ?? '').trim()
      const desc = String(cell(r, c.desc) ?? '').trim()
      if (!vid && !desc) continue
      if (/^(GRAND )?TOTAL\b/i.test(String(r[0] ?? '')) || /^(GRAND )?TOTAL\b/i.test(desc)) continue
      items.push({ vid, desc, upc: String(cell(r, c.upc) ?? '').trim(), sold: num(cell(r, c.sold)), stock: num(cell(r, c.stock)), need: num(cell(r, c.need)), order: num(cell(r, c.order)) })
    }
    if (!items.length) continue
    return { items, column: items.some((x) => x.order !== null && x.order !== 0) ? 'order' : 'need', sheet: s.name }
  }
  return null
}

/** The rows worth showing Claude: ordered (or needed) items first, then the rest, at most `max`. */
export function sheetForClaude(s: SalesSheet, max = 500): string {
  const qty = (x: SheetItem) => (s.column === 'order' ? x.order : x.need) ?? 0
  const rows = [...s.items].sort((a, b) => Number(qty(b) > 0) - Number(qty(a) > 0)).slice(0, max)
  return ['VENDOR ID\tDESCRIPTION\tSOLD\tIN STOCK\tNEED\tORDER', ...rows.map((x) => [x.vid, x.desc, x.sold ?? '', x.stock ?? '', x.need ?? '', x.order ?? ''].join('\t'))].join('\n')
}
