// A spreadsheet as text for Claude (Dana, Oct 15: Panther Martin's rep sent his copy of our order as Excel, with two
// quantities changed). Every sheet, every non-empty row, cells joined with " | ". Pure, so it can be tested; the
// workbook is opened by sheetFileText (sheetFile.ts).

export const SHEET_TEXT_MAX = 60_000

/** Rows of each sheet as text, cut at max characters (with a note saying so). */
export function rowsToText(sheets: { name: string; rows: unknown[][] }[], max = SHEET_TEXT_MAX): string {
  const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '')).replace(/\s+/g, ' ').trim()
  const parts: string[] = []
  for (const s of sheets) {
    const text = s.rows.map((r) => r.map(cell).filter(Boolean).join(' | ')).filter(Boolean).join('\n')
    if (text) parts.push(sheets.length > 1 ? `# Sheet: ${s.name}\n${text}` : text)
  }
  const all = parts.join('\n\n')
  return all.length > max ? `${all.slice(0, max)}\n… (the rest of the spreadsheet is cut off)` : all
}
