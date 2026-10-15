import { describe, expect, it } from 'vitest'
import { rowsToText } from './sheetText'

describe('a spreadsheet as text (Oct 15)', () => {
  it('keeps every row, joins cells and names the sheets', () => {
    const text = rowsToText([
      { name: 'PO', rows: [['Model', 'Desc', 'Qty'], ['PM-6', 'Spinner  1/8 oz', 24], [], ['', '', '']] },
      { name: 'Notes', rows: [['Changed PM-6 to 24']] },
    ])
    expect(text).toBe('# Sheet: PO\nModel | Desc | Qty\nPM-6 | Spinner 1/8 oz | 24\n\n# Sheet: Notes\nChanged PM-6 to 24')
  })
  it('cuts a huge sheet and says so', () => {
    const text = rowsToText([{ name: 'A', rows: Array.from({ length: 50 }, (_, i) => [`row ${i}`]) }], 40)
    expect(text.endsWith('(the rest of the spreadsheet is cut off)')).toBe(true)
    expect(rowsToText([{ name: 'A', rows: [['x', 1]] }])).toBe('x | 1')
  })
})
