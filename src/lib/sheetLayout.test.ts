import { describe, expect, it } from 'vitest'
import { laySheet } from './sheetLayout'

const g = (rows: string[][]) => rows.map((r) => r.map((text) => ({ text })))

describe('laySheet', () => {
  it('keeps a merged note across its columns instead of stretching one column', () => {
    const grid = g([
      ['QTY', 'COST', '', 'DESCRIPTION'],
      ['6', '$31.80', '', 'Face mask'],
      ['', 'To the price herein stated will be added any sales tax or taxes and or so called tariff adjustments', '', ''],
    ])
    const rows = laySheet(grid, [{ s: { r: 2, c: 1 }, e: { r: 2, c: 3 } }])
    // the empty third column is left out
    expect(rows[0]!.map((c) => c.text)).toEqual(['QTY', 'COST', 'DESCRIPTION'])
    // the note spans COST and DESCRIPTION and wraps
    const note = rows[2]!.find((c) => c.text.startsWith('To the price'))!
    expect(note.colSpan).toBe(2)
    expect(note.wrap).toBe(true)
    expect(rows[2]!.length).toBe(2)
    expect(rows[1]!.find((c) => c.text === '$31.80')!.wrap).toBe(false)
  })

  it('leaves out empty rows and treats an empty merge as plain empty cells', () => {
    const grid = g([
      ['A', 'B'],
      ['', ''],
      ['', 'C'],
    ])
    const rows = laySheet(grid, [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }])
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([['A', 'B'], ['', 'C']])
  })

  it('counts a tall merge only over the rows that are shown', () => {
    const grid = g([
      ['Header', 'x'],
      ['', ''],
      ['', 'y'],
    ])
    const rows = laySheet(grid, [{ s: { r: 0, c: 0 }, e: { r: 2, c: 0 } }])
    expect(rows[0]![0]!.rowSpan).toBe(2)
    expect(rows[1]!.map((c) => c.text)).toEqual(['y'])
  })

  it('keeps links and wraps them', () => {
    const rows = laySheet([[{ text: 'Open', link: 'https://x' }]])
    expect(rows[0]![0]).toMatchObject({ text: 'Open', link: 'https://x', wrap: true, colSpan: 1, rowSpan: 1 })
  })
})
