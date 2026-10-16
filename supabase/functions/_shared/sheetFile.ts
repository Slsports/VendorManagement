import { rowsToText } from './sheetText.ts'

// Loads the Excel reader only when a spreadsheet comes along, so mail sync starts as fast as before.

/** Rows read per sheet: an order is never longer, and a whole catalog sheet would not fit in memory. */
export const SHEET_ROWS = 10_000

/**
 * Open a workbook lightly (Oct 16: Pure Fishing's 8.6 MB show order ran the function out of memory every 11 minutes):
 * values only, no styles or formulas, the first SHEET_ROWS rows of each sheet. About a third of the memory.
 */
export async function readBook(bytes: Uint8Array) {
  const XLSX = await import('npm:xlsx@0.18.5')
  const book = XLSX.read(bytes, { type: 'array', dense: true, sheetRows: SHEET_ROWS + 1, cellDates: true, cellStyles: false, cellHTML: false, cellNF: false, cellFormula: false, cellText: false, bookVBA: false })
  return {
    names: book.SheetNames as string[],
    rows: (name: string, raw = false) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw, blankrows: false, defval: '' }),
    /** true when a sheet had more rows than were read */
    cut: (name: string) => !!book.Sheets[name]?.['!fullref'] && book.Sheets[name]!['!fullref'] !== book.Sheets[name]!['!ref'],
  }
}

/** An Excel or CSV file's text; null when it can't be opened or is empty. */
export async function sheetFileText(bytes: Uint8Array): Promise<string | null> {
  try {
    const book = await readBook(bytes)
    const text = rowsToText(book.names.map((name) => ({ name, rows: book.rows(name) })))
    if (!text) return null
    return book.names.some(book.cut) ? `${text}\n… (only the first ${SHEET_ROWS} rows of a sheet were read)` : text
  } catch {
    return null
  }
}
