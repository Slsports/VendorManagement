import { describe, expect, it } from 'vitest'
import { applyEdits, describeChanges, formLines, forceRecalcOnOpen, parseSharedStrings, parseSheet, readForm, recalc, revisedFileName, setCell } from './orderForm'

// A small form shaped like Slippery Racer's: Model, Description, color columns F-H, MAP, MSRP, Price, CPQ, Cases (a
// shared formula), Units, Total, and a SUM at the bottom. Strings are shared strings, as Excel writes them.
const strings = ['Model', 'Description', 'Color', 'Price', 'CPQ', 'Cases Ordered', 'Total Units', 'Total', 'Snowboards', 'Green / Yellow', 'Red / Blue', 'SR8983', 'Hardwood Snowboard (90cm)', 'SR8990', 'Hardwood Snowboard (130cm)', 'Snow Toys', 'Blue', 'Red', 'Green', 'SR102', 'Happy Snowball Maker', 'TOTAL']
const ss = `<sst><si><t>${strings.join('</t></si><si><t>')}</t></si></sst>`
const s = (ref: string, i: number) => `<c r="${ref}" s="1" t="s"><v>${i}</v></c>`
const n = (ref: string, v: number | null) => (v === null ? `<c r="${ref}" s="2"/>` : `<c r="${ref}" s="2"><v>${v}</v></c>`)
const f = (ref: string, formula: string, v: number) => `<c r="${ref}" s="3"><f>${formula}</f><v>${v}</v></c>`
const sheet = `<worksheet><sheetData>
<row r="1">${s('B1', 0)}${s('D1', 1)}${s('F1', 2)}${s('P1', 3)}${s('Q1', 4)}${s('R1', 5)}${s('S1', 6)}${s('T1', 7)}</row>
<row r="2">${s('B2', 8)}${s('F2', 9)}${s('G2', 10)}</row>
<row r="3">${s('B3', 11)}${s('D3', 12)}${n('F3', null)}${n('G3', null)}${n('H3', null)}${n('P3', 25.99)}${n('Q3', 6)}<c r="R3" s="3"><f t="shared" ref="R3:R4" si="0">F3+G3+H3</f><v>0</v></c>${f('S3', 'Q3*R3', 0)}${f('T3', 'P3*S3', 0)}</row>
<row r="4">${s('B4', 13)}${s('D4', 14)}${n('F4', null)}${n('G4', 1)}${n('H4', null)}${n('P4', 34.99)}${n('Q4', 6)}<c r="R4" s="3"><f t="shared" si="0"/><v>1</v></c>${n('S4', 6)}${f('T4', 'P4*S4', 209.94)}</row>
<row r="5">${s('B5', 15)}${s('F5', 16)}${s('G5', 17)}${s('H5', 18)}</row>
<row r="6">${s('B6', 19)}${s('D6', 20)}${n('F6', 5)}${n('G6', 11)}${n('H6', 10)}${n('P6', 3.5)}${n('Q6', 12)}${f('R6', 'F6+G6+H6', 26)}${f('S6', 'Q6*R6', 312)}${f('T6', 'P6*S6', 1092)}</row>
<row r="8">${s('S8', 21)}${f('T8', 'SUM(T3:T7)', 1301.94)}</row>
</sheetData></worksheet>`
const known = ['SR8990', 'SR102']

describe('parseSheet', () => {
  it('reads values, shared strings and shared formulas', () => {
    const cells = parseSheet(sheet, parseSharedStrings(ss))
    expect(cells.get('B4')?.v).toBe('SR8990')
    expect(cells.get('G4')?.v).toBe(1)
    expect(cells.get('R4')?.f).toBe('F4+G4+H4')   // the follower of the shared formula, shifted a row
    expect(cells.get('T8')?.f).toBe('SUM(T3:T7)')
  })
})

describe('readForm', () => {
  it('finds the items, the color cells, the case pack, price and totals from the formulas', () => {
    const m = readForm(parseSheet(sheet, parseSharedStrings(ss)), known)
    expect(m.editable).toBe(true)
    expect(m.mode).toBe('cases')
    expect(m.columns).toEqual({ model: 'B', description: 'D', price: 'P', cpq: 'Q', cases: 'R', units: 'S', total: 'T' })
    expect(m.rows.map((r) => r.model)).toEqual(['SR8983', 'SR8990', 'SR102'])
    const board = m.rows[1]!
    expect(board.section).toBe('Snowboards')
    expect(board.inputs.map((i) => [i.col, i.header, i.value])).toEqual([['F', 'Green / Yellow', null], ['G', 'Red / Blue', 1], ['H', null, null]])
    expect(board.price).toBe(34.99)
    expect(board.cpq).toBe(6)
    expect(board.units).toBe(6)
    expect(m.rows[2]!.inputs.map((i) => i.header)).toEqual(['Blue', 'Red', 'Green'])
    expect(m.total).toBe(1301.94)
  })
  it('turns the rows with something ordered into lines', () => {
    const lines = formLines(readForm(parseSheet(sheet, parseSharedStrings(ss)), known))
    expect(lines).toEqual([
      { row: 4, vendor_item_id: 'SR8990', description: 'Hardwood Snowboard (130cm)', quantity: 6, unit_cost: 34.99, colors: '1 Red / Blue' },
      { row: 6, vendor_item_id: 'SR102', description: 'Happy Snowball Maker', quantity: 312, unit_cost: 3.5, colors: '5 Blue, 11 Red, 10 Green' },
    ])
  })
  it('says when the items are not on the form', () => {
    expect(readForm(parseSheet(sheet, parseSharedStrings(ss)), ['NOPE']).editable).toBe(false)
  })
  it('reads a plain form with a quantity column and no formulas', () => {
    const plain = `<worksheet><sheetData><row r="1">${s('A1', 0)}${s('B1', 1)}${s('C1', 3)}</row><row r="2"><c r="A2" t="inlineStr"><is><t>X1</t></is></c><c r="B2" t="inlineStr"><is><t>Thing</t></is></c>${n('C2', 4)}${n('D2', 9.5)}</row><row r="3"><c r="A3" t="inlineStr"><is><t>X2</t></is></c><c r="B3" t="inlineStr"><is><t>Other</t></is></c>${n('C3', null)}${n('D3', 2)}</row></sheetData></worksheet>`
    const m = readForm(parseSheet(plain, parseSharedStrings(ss)), ['X1'], [{ vid: 'X1', quantity: 4, unit_cost: 9.5 }])
    expect(m.editable).toBe(true)
    expect(m.mode).toBe('units')
    expect(m.columns.units).toBe('C')
    expect(m.columns.price).toBe('D')
    expect(m.rows.map((r) => r.model)).toEqual(['X1', 'X2'])
  })
})

describe('applyEdits', () => {
  it('writes the new numbers, recomputes cases, units, totals and the sum, and keeps the formulas', () => {
    const cells = parseSheet(sheet, parseSharedStrings(ss))
    const m = readForm(cells, known)
    expect(m.formulaRow).toBe(3)
    const { xml } = applyEdits(sheet, cells, [{ ref: 'G4', value: 2 }, { ref: 'F3', value: 1 }, { ref: 'H6', value: null }], { fromRow: m.formulaRow!, cols: ['R', 'S', 'T'] })
    const after = parseSheet(xml, parseSharedStrings(ss))
    expect(after.get('G4')?.v).toBe(2)
    expect(after.get('R4')?.v).toBe(2)
    expect(after.get('R4')?.f).toBe('F4+G4+H4')
    expect(xml).toContain('<c r="R4" s="3"><f t="shared" si="0"/><v>2</v></c>')
    // someone typed 6 over the Units formula: the formula comes back, so the units and total follow the cases
    expect(after.get('S4')?.f).toBe('Q4*R4')
    expect(after.get('S4')?.v).toBe(12)
    expect(after.get('T4')?.v).toBe(419.88)
    expect(xml).toContain('<c r="S4" s="2"><f>Q4*R4</f><v>12</v></c>')
    expect(after.get('R3')?.v).toBe(1)
    expect(after.get('S3')?.v).toBe(6)
    expect(after.get('T3')?.v).toBe(155.94)
    expect(after.get('H6')?.v).toBe(null)
    expect(after.get('S6')?.v).toBe(192)
    expect(after.get('T8')?.v).toBe(Math.round((155.94 + 419.88 + 672) * 1e9) / 1e9)
    expect(xml).toContain('<c r="H6" s="2"/>')
  })
  it('never types over a formula', () => {
    const cells = parseSheet(sheet, parseSharedStrings(ss))
    const { xml, changed } = applyEdits(sheet, cells, [{ ref: 'R4', value: 9 }])
    expect(changed).toEqual([])
    expect(xml).toBe(sheet)
  })
})

describe('recalc', () => {
  it('leaves formulas it does not understand alone', () => {
    const cells = parseSheet(`<worksheet><sheetData><row r="1">${n('A1', 2)}${f('B1', 'VLOOKUP(A1,Sheet2!A:B,2)', 7)}${f('C1', 'ROUND(A1*1.333,2)', 0)}</row></sheetData></worksheet>`, [])
    expect(recalc(cells)).toEqual(['C1'])
    expect(cells.get('B1')?.v).toBe(7)
    expect(cells.get('C1')?.v).toBe(2.67)
  })
})

describe('setCell', () => {
  it('adds a missing cell in column order', () => {
    const xml = '<worksheet><sheetData><row r="9"><c r="B9" s="1"><v>1</v></c><c r="D9" s="1"><v>3</v></c></row></sheetData></worksheet>'
    expect(setCell(xml, 'C9', { v: '2' })).toBe('<worksheet><sheetData><row r="9"><c r="B9" s="1"><v>1</v></c><c r="C9"><v>2</v></c><c r="D9" s="1"><v>3</v></c></row></sheetData></worksheet>')
  })
  it('turns the recalculation on when the workbook opens', () => {
    expect(forceRecalcOnOpen('<workbook><calcPr calcId="1"/></workbook>')).toBe('<workbook><calcPr fullCalcOnLoad="1" calcId="1"/></workbook>')
  })
})

describe('describeChanges', () => {
  it('says what was added, changed and removed, in cases and units', () => {
    const before = readForm(parseSheet(sheet, parseSharedStrings(ss)), known)
    const cells = parseSheet(sheet, parseSharedStrings(ss))
    const { xml } = applyEdits(sheet, cells, [{ ref: 'G4', value: 2 }, { ref: 'F3', value: 1 }, { ref: 'F6', value: null }, { ref: 'G6', value: null }, { ref: 'H6', value: null }], { fromRow: before.formulaRow!, cols: ['R', 'S', 'T'] })
    const after = readForm(parseSheet(xml, parseSharedStrings(ss)), known)
    expect(describeChanges(before, after)).toEqual([
      'Added SR8983 Hardwood Snowboard (90cm): 1 case of 6 (6 units), 1 Green / Yellow',
      'Changed SR8990 Hardwood Snowboard (130cm): 6 units → 12 units (Red / Blue: 1 case → 2 cases)',
      'Removed SR102 Happy Snowball Maker (was 312 units)',
      'New order total: $575.82 (was $1,301.94)',
    ])
  })
})

describe('revisedFileName', () => {
  it("names the file Dana's way and replaces an earlier REVISED date", () => {
    const d = new Date(2026, 10, 13)
    expect(revisedFileName('11-10-26 - SLIPPERY RACER ORDER - SHAVER LAKE SPORTS FINAL.xlsx', d)).toBe('11-10-26 - SLIPPERY RACER ORDER - SHAVER LAKE SPORTS FINAL REVISED 11-13-26.xlsx')
    expect(revisedFileName('11-10-26 - SLIPPERY RACER ORDER - SL SPORTS REVISED 11-12-26.xlsx', d)).toBe('11-10-26 - SLIPPERY RACER ORDER - SL SPORTS REVISED 11-13-26.xlsx')
  })
})
