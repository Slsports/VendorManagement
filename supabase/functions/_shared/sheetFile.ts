import { rowsToText } from './sheetText.ts'

// Loads the Excel reader only when a spreadsheet comes along, so mail sync starts as fast as before.
/** An Excel or CSV file's text; null when it can't be opened or is empty. */
export async function sheetFileText(bytes: Uint8Array): Promise<string | null> {
  try {
    const XLSX = await import('npm:xlsx@0.18.5')
    const book = XLSX.read(bytes, { type: 'array', cellDates: true })
    const text = rowsToText(book.SheetNames.map((name: string) => ({
      name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw: false, blankrows: false, defval: '' }),
    })))
    return text || null
  } catch {
    return null
  }
}
