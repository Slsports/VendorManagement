/**
 * How a spreadsheet is laid out in the document viewer (Dana, Nov 3: the Becker confirmation's cost column was "so wide"
 * because a long note merged across columns in Excel sat in one column on one line).
 * - Merged cells keep their merge (colSpan / rowSpan), so notes and headings spread the way they do in Excel.
 * - Rows with nothing in them and columns with nothing in them are left out, so the items sit next to each other.
 * - Long text is marked to wrap, so one cell never stretches a whole column.
 */
export type SheetCell = { text: string; link?: string }
export type SheetMerge = { s: { r: number; c: number }; e: { r: number; c: number } }
export type LaidCell = SheetCell & { colSpan: number; rowSpan: number; wrap: boolean }

/** Text longer than this wraps. */
export const WRAP_AT = 40

/** `grid` is every cell of the sheet's range (row by row); merges are relative to the same grid. */
export function laySheet(grid: SheetCell[][], merges: SheetMerge[] = []): LaidCell[][] {
  const rows = grid.length
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0)
  const at = (r: number, c: number) => grid[r]?.[c] ?? { text: '' }
  // only merges with something in their first cell count; an empty merge is just empty cells
  const live = merges
    .map((m) => ({ s: { r: Math.max(0, m.s.r), c: Math.max(0, m.s.c) }, e: { r: Math.min(rows - 1, m.e.r), c: Math.min(cols - 1, m.e.c) } }))
    .filter((m) => m.s.r <= m.e.r && m.s.c <= m.e.c && (m.s.r < m.e.r || m.s.c < m.e.c) && at(m.s.r, m.s.c).text.trim() !== '')
  const covered = new Set<string>()
  const start = new Map<string, SheetMerge>()
  for (const m of live) {
    start.set(`${m.s.r}:${m.s.c}`, m)
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`)
  }
  const has = (r: number, c: number) => !covered.has(`${r}:${c}`) && at(r, c).text.trim() !== ''
  const keepRow: boolean[] = []
  for (let r = 0; r < rows; r++) { let k = false; for (let c = 0; c < cols && !k; c++) k = has(r, c); keepRow.push(k) }
  const keepCol: boolean[] = []
  for (let c = 0; c < cols; c++) { let k = false; for (let r = 0; r < rows && !k; r++) k = has(r, c); keepCol.push(k) }
  const count = (keep: boolean[], from: number, to: number) => { let n = 0; for (let i = from; i <= to; i++) if (keep[i]) n++; return n }

  const out: LaidCell[][] = []
  for (let r = 0; r < rows; r++) {
    if (!keepRow[r]) continue
    const row: LaidCell[] = []
    for (let c = 0; c < cols; c++) {
      if (!keepCol[c] || covered.has(`${r}:${c}`)) continue
      const cell = at(r, c)
      const m = start.get(`${r}:${c}`)
      const colSpan = m ? Math.max(1, count(keepCol, m.s.c, m.e.c)) : 1
      const rowSpan = m ? Math.max(1, count(keepRow, m.s.r, m.e.r)) : 1
      row.push({ ...cell, colSpan, rowSpan, wrap: !!cell.link || cell.text.length > WRAP_AT })
    }
    out.push(row)
  }
  return out
}
