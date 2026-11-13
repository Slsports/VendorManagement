// A vendor's own Excel order form, read and written back without touching its layout (Dana, Nov 13: "I need to be able
// to edit these orders and resend. Where can I do it without downloading to my computer?"). The form stays the vendor's:
// VMS only changes the numbers typed into it (cases per color, or a quantity) and recomputes the form's own formulas so
// the cases, units and totals it shows are right. Pure text work on the sheet XML, so vitest can test it; the function
// unzips and zips.
//
// How VMS understands a form: the order's lines (Claude read them when the order was sent) name the Vendor IDs; the
// column where those IDs sit is the Model column, every row with a model is an item row, and the row's formulas say the
// rest: Total = Price × Units, Units = Case pack × Cases, Cases = the sum of the color cells. The color cells are what
// a person types, so they are what VMS edits. A form with no formulas gets the simple reading: the column whose numbers
// equal the lines' quantities is the quantity column.

export interface Cell { v: string | number | boolean | null; f?: string; t: 'n' | 's' | 'b' | 'e' }
export type Cells = Map<string, Cell>

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const colIndex = (c: string) => c.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
export function colName(n: number): string {
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
export const splitRef = (ref: string) => { const m = ref.match(/^\$?([A-Z]+)\$?(\d+)$/)!; return { col: m[1]!, row: Number(m[2]) } }

/** The workbook's shared strings, in order. */
export function parseSharedStrings(xml: string | null | undefined): string[] {
  if (!xml) return []
  const out: string[] = []
  for (const m of xml.matchAll(/<si>(.*?)<\/si>/gs)) {
    out.push([...m[1]!.matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)].map((t) => unescapeXml(t[1]!)).join(''))
  }
  return out
}

/** Shift the relative references of a shared formula from its master cell to a follower cell. */
function shiftFormula(f: string, from: string, to: string): string {
  const a = splitRef(from), b = splitRef(to)
  const dc = colIndex(b.col) - colIndex(a.col), dr = b.row - a.row
  return f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (_m, dc1: string, c: string, dr1: string, r: string) =>
    `${dc1}${dc1 ? c : colName(colIndex(c) + dc)}${dr1}${dr1 ? r : String(Number(r) + dr)}`)
}

/** Every cell of a sheet: value, formula (shared ones expanded), type. */
export function parseSheet(xml: string, shared: string[]): Cells {
  const cells: Cells = new Map()
  const masters = new Map<string, { ref: string; f: string }>()
  const data = xml.match(/<sheetData>(.*?)<\/sheetData>/s)?.[1] ?? ''
  for (const m of data.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
    const ref = m[1]!, attrs = m[2]!, inner = m[3] ?? ''
    const t = attrs.match(/\st="([a-zA-Z]+)"/)?.[1] ?? 'n'
    let f: string | undefined
    const fm = inner.match(/<f(\s[^>]*)?(?:\/>|>(.*?)<\/f>)/s)
    if (fm) {
      const fa = fm[1] ?? '', body = fm[2] ? unescapeXml(fm[2]) : ''
      const si = fa.match(/\ssi="(\d+)"/)?.[1]
      if (/\st="shared"/.test(fa) && si !== undefined) {
        if (body) { masters.set(si, { ref, f: body }); f = body }
        else { const mm = masters.get(si); f = mm ? shiftFormula(mm.f, mm.ref, ref) : undefined }
      } else if (body) f = body
    }
    const vRaw = inner.match(/<v>(.*?)<\/v>/s)?.[1]
    let v: Cell['v'] = null
    let type: Cell['t'] = 'n'
    if (t === 's') { type = 's'; v = vRaw !== undefined ? (shared[Number(vRaw)] ?? '') : '' }
    else if (t === 'inlineStr') { type = 's'; v = [...inner.matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)].map((x) => unescapeXml(x[1]!)).join('') }
    else if (t === 'str') { type = 's'; v = vRaw !== undefined ? unescapeXml(vRaw) : '' }
    else if (t === 'b') { type = 'b'; v = vRaw === '1' }
    else if (t === 'e') { type = 'e'; v = vRaw ?? null }
    else { v = vRaw !== undefined && vRaw !== '' ? Number(vRaw) : null; if (v !== null && !Number.isFinite(v)) v = null }
    cells.set(ref, { v, f, t: type })
  }
  return cells
}

// ---- the form's own formulas, recomputed ------------------------------------------------------------------------------

type Tok = { k: 'num'; v: number } | { k: 'ref'; v: string } | { k: 'range'; a: string; b: string } | { k: 'op'; v: string } | { k: 'fn'; v: string } | { k: 'lp' } | { k: 'rp' } | { k: 'comma' }

function tokenize(f: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  const s = f.replace(/^=/, '')
  while (i < s.length) {
    const ch = s[i]!
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) { const m = s.slice(i).match(/^\d*\.?\d+(?:[eE][-+]?\d+)?/)!; out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue }
    const rng = s.slice(i).match(/^\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+/)
    if (rng) { const [a, b] = rng[0].split(':'); out.push({ k: 'range', a: a!.replace(/\$/g, ''), b: b!.replace(/\$/g, '') }); i += rng[0].length; continue }
    const ref = s.slice(i).match(/^\$?[A-Z]{1,3}\$?\d+(?![A-Za-z0-9_(])/)
    if (ref) { out.push({ k: 'ref', v: ref[0].replace(/\$/g, '') }); i += ref[0].length; continue }
    const fn = s.slice(i).match(/^[A-Z][A-Z0-9_.]*(?=\()/i)
    if (fn) { out.push({ k: 'fn', v: fn[0].toUpperCase() }); i += fn[0].length; continue }
    if ('+-*/^'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue }
    if (ch === '(') { out.push({ k: 'lp' }); i++; continue }
    if (ch === ')') { out.push({ k: 'rp' }); i++; continue }
    if (ch === ',' || ch === ';') { out.push({ k: 'comma' }); i++; continue }
    return null   // another sheet, text, comparisons: not a formula VMS recomputes
  }
  return out
}

class Unsupported extends Error {}

/**
 * Recompute every formula the sheet carries that VMS understands (+ − × ÷ ^, SUM, MIN, MAX, ROUND, ABS, parentheses,
 * ranges). Anything else keeps the value the vendor's Excel last saved. Returns the refs whose shown value changed.
 */
export function recalc(cells: Cells): string[] {
  const memo = new Map<string, number | null>()
  const busy = new Set<string>()
  const num = (ref: string): number => {
    const c = cells.get(ref)
    if (!c) return 0
    if (c.f) { const v = value(ref); return v ?? 0 }
    return typeof c.v === 'number' ? c.v : typeof c.v === 'boolean' ? (c.v ? 1 : 0) : 0
  }
  const rangeRefs = (a: string, b: string): string[] => {
    const A = splitRef(a), B = splitRef(b)
    const out: string[] = []
    for (let r = Math.min(A.row, B.row); r <= Math.max(A.row, B.row); r++)
      for (let c = Math.min(colIndex(A.col), colIndex(B.col)); c <= Math.max(colIndex(A.col), colIndex(B.col)); c++) out.push(`${colName(c)}${r}`)
    if (out.length > 5000) throw new Unsupported('range')
    return out
  }
  const value = (ref: string): number | null => {
    if (memo.has(ref)) return memo.get(ref)!
    const c = cells.get(ref)
    if (!c?.f) return null
    if (busy.has(ref)) throw new Unsupported('cycle')
    busy.add(ref)
    let v: number | null
    try { v = evaluate(c.f) } catch (e) { if (!(e instanceof Unsupported)) throw e; v = null } finally { busy.delete(ref) }
    memo.set(ref, v)
    return v
  }
  const evaluate = (f: string): number => {
    const toks = tokenize(f)
    if (!toks) throw new Unsupported('syntax')
    let p = 0
    const peek = () => toks[p]
    const next = () => toks[p++]
    const args = (): number[][] => {   // each argument as the list of numbers it stands for
      const out: number[][] = []
      if (peek()?.k === 'rp') { next(); return out }
      for (;;) {
        const t = peek()
        if (t?.k === 'range') { next(); out.push(rangeRefs(t.a, t.b).map((r) => { const c = cells.get(r); return c?.f ? (value(r) ?? 0) : typeof c?.v === 'number' ? c.v : NaN }).filter((n) => !Number.isNaN(n))) }
        else out.push([expr()])
        const s = next()
        if (s?.k === 'rp') return out
        if (s?.k !== 'comma') throw new Unsupported('args')
      }
    }
    const atom = (): number => {
      const t = next()
      if (!t) throw new Unsupported('end')
      if (t.k === 'num') return t.v
      if (t.k === 'ref') return num(t.v)
      if (t.k === 'op' && t.v === '-') return -atom()
      if (t.k === 'op' && t.v === '+') return atom()
      if (t.k === 'lp') { const v = expr(); if (next()?.k !== 'rp') throw new Unsupported('paren'); return v }
      if (t.k === 'fn') {
        if (next()?.k !== 'lp') throw new Unsupported('fn')
        const a = args()
        const flat = a.flat()
        switch (t.v) {
          case 'SUM': return flat.reduce((n, x) => n + x, 0)
          case 'MIN': return flat.length ? Math.min(...flat) : 0
          case 'MAX': return flat.length ? Math.max(...flat) : 0
          case 'ABS': return Math.abs(flat[0] ?? 0)
          case 'ROUND': { const d = a[1]?.[0] ?? 0; const k = 10 ** d; return Math.round((a[0]?.[0] ?? 0) * k) / k }
          case 'PRODUCT': return flat.reduce((n, x) => n * x, 1)
          default: throw new Unsupported(t.v)
        }
      }
      throw new Unsupported('token')
    }
    const power = (): number => { let v = atom(); while (peek()?.k === 'op' && (peek() as { v: string }).v === '^') { next(); v = v ** atom() } return v }
    const term = (): number => {
      let v = power()
      for (;;) {
        const t = peek()
        if (t?.k === 'op' && (t.v === '*' || t.v === '/')) { next(); const r = power(); v = t.v === '*' ? v * r : r === 0 ? 0 : v / r } else return v
      }
    }
    const expr = (): number => {
      let v = term()
      for (;;) {
        const t = peek()
        if (t?.k === 'op' && (t.v === '+' || t.v === '-')) { next(); const r = term(); v = t.v === '+' ? v + r : v - r } else return v
      }
    }
    const v = expr()
    if (p !== toks.length) throw new Unsupported('trailing')
    return v
  }
  const changed: string[] = []
  for (const [ref, c] of cells) {
    if (!c.f) continue
    const v = value(ref)
    if (v === null || !Number.isFinite(v)) continue
    const rounded = Math.round(v * 1e9) / 1e9
    if (c.v !== rounded) { c.v = rounded; c.t = 'n'; changed.push(ref) }
  }
  return changed
}

// ---- reading the form as an order -------------------------------------------------------------------------------------

export interface FormInput { ref: string; col: string; header: string | null; value: number | null }
export interface FormRow {
  row: number
  model: string
  description: string
  section: string | null
  inputs: FormInput[]
  price: number | null
  cpq: number | null
  cases: number | null
  units: number | null
  total: number | null
}
export interface FormModel {
  editable: boolean
  why?: string
  /** 'cases': the inputs are cases per color and the form multiplies by the case pack; 'units': the inputs are the quantity itself */
  mode: 'cases' | 'units'
  rows: FormRow[]
  total: number | null
  columns: { model: string; description: string | null; price: string | null; cpq: string | null; cases: string | null; units: string | null; total: string | null }
  /** An item row whose Cases, Units and Total are all formulas: the pattern to put back on a row someone typed over */
  formulaRow: number | null
}

const text = (c: Cell | undefined) => (c && c.t === 's' && typeof c.v === 'string' ? c.v.replace(/\s+/g, ' ').trim() : '')
const numv = (c: Cell | undefined) => (c && typeof c.v === 'number' ? c.v : null)
const refsOf = (f: string) => [...f.replace(/\$/g, '').matchAll(/\b([A-Z]{1,3})(\d+)\b/g)].map((m) => ({ col: m[1]!, row: Number(m[2]) }))

/** The form read as an order. `knownVids` are the Vendor IDs of the order's lines, so VMS knows where the items are. */
export function readForm(cells: Cells, knownVids: string[], knownLines: { vid: string; quantity: number; unit_cost: number | null }[] = []): FormModel {
  const nothing = (why: string): FormModel => ({ editable: false, why, mode: 'units', rows: [], total: null, columns: { model: '', description: null, price: null, cpq: null, cases: null, units: null, total: null }, formulaRow: null })
  const byRow = new Map<number, Map<string, Cell>>()
  let maxRow = 0
  for (const [ref, c] of cells) {
    const { col, row } = splitRef(ref)
    if (!byRow.has(row)) byRow.set(row, new Map())
    byRow.get(row)!.set(col, c)
    if (row > maxRow) maxRow = row
  }
  const vids = new Set(knownVids.map((v) => v.trim().toUpperCase()).filter(Boolean))
  if (!vids.size) return nothing('The order has no Vendor IDs to find on the form')
  // the Model column: where the order's Vendor IDs sit
  const hits = new Map<string, number[]>()
  for (const [ref, c] of cells) {
    const t = text(c).toUpperCase()
    if (t && vids.has(t)) { const { col, row } = splitRef(ref); hits.set(col, [...(hits.get(col) ?? []), row]) }
  }
  if (!hits.size) return nothing("VMS could not find the order's items on the form")
  const modelCol = [...hits.entries()].sort((a, b) => b[1].length - a[1].length)[0]![0]
  const knownRows = [...new Set(hits.get(modelCol)!)].sort((a, b) => a - b)
  // the formula columns of the known rows (Cases, Units, Total on a form that adds up)
  const formulaCols = new Set<string>()
  for (const r of knownRows) for (const [col, c] of byRow.get(r)!) if (c.f) formulaCols.add(col)
  // item rows: a model and, on a form that adds up, a formula in one of its formula columns (a section title has none,
  // nor does the address block); on a plain form, a number somewhere in the row
  const isItem = (r: number) => {
    const row = byRow.get(r)
    if (!row || !text(row.get(modelCol))) return false
    if (formulaCols.size) return [...formulaCols].some((c) => row.get(c)?.f)
    for (const [col, c] of row) { if (col === modelCol) continue; if (typeof c.v === 'number') return true }
    return false
  }
  const itemRows: number[] = []
  for (let r = 1; r <= maxRow; r++) if (isItem(r)) itemRows.push(r)
  if (!itemRows.length) return nothing("VMS could not find the order's items on the form")

  // the form's arithmetic, from the known rows: Total = Price × Units, Units = CPQ × Cases, Cases = sum of the color cells
  let priceCol: string | null = null, unitsCol: string | null = null, totalCol: string | null = null, cpqCol: string | null = null, casesCol: string | null = null
  let inputCols: string[] = []
  // read the structure off each known row (a row where someone typed a number over the Units formula says less), keep the fullest
  for (const r0 of knownRows) {
    const row0 = byRow.get(r0)!
    const isConst = (col: string) => { const c = row0.get(col); return !!c && !c.f && typeof c.v === 'number' }
    const products = [...row0.entries()].filter(([, c]) => c.f && /^\$?[A-Z]{1,3}\$?\d+\*\$?[A-Z]{1,3}\$?\d+$/.test(c.f.replace(/\s/g, '')))
      .map(([col, c]) => ({ col, refs: refsOf(c.f!).filter((x) => x.row === r0).map((x) => x.col), value: numv(c) ?? 0 }))
      .filter((p) => p.refs.length === 2)
    // the Total is the product at the end of the row's chain (nothing else in the row uses it) with a constant factor
    const usedBy = new Set([...row0.values()].flatMap((c) => (c.f ? refsOf(c.f).filter((x) => x.row === r0).map((x) => x.col) : [])))
    const totals = products.filter((p) => p.refs.some(isConst) && !usedBy.has(p.col)).sort((a, b) => b.value - a.value)
    if (!totals.length) continue
    const tCol = totals[0]!.col, pCol = totals[0]!.refs.find(isConst)!, uCol = totals[0]!.refs.find((c) => c !== pCol)!
    const unitsCell = row0.get(uCol)
    const up = unitsCell?.f ? products.find((p) => p.col === uCol) : null
    let cCol: string | null = null, qCol: string | null = null, ins: string[] = []
    if (up && up.refs.some(isConst)) {
      qCol = up.refs.find(isConst)!
      cCol = up.refs.find((c) => c !== qCol)!
      const cf = row0.get(cCol)?.f
      if (cf) ins = [...new Set(refsOf(cf).filter((x) => x.row === r0).map((x) => x.col))].filter((c) => !row0.get(c)?.f)
    } else if (unitsCell?.f) {
      ins = [...new Set(refsOf(unitsCell.f).filter((x) => x.row === r0).map((x) => x.col))].filter((c) => !row0.get(c)?.f)
    } else ins = [uCol]
    const fuller = !totalCol || (qCol && !cpqCol) || ins.length > inputCols.length
    if (fuller) { totalCol = tCol; priceCol = pCol; unitsCol = uCol; cpqCol = qCol; casesCol = cCol; inputCols = ins }
    if (cpqCol && casesCol) break
  }
  if (!inputCols.length) {
    // no formulas: the column whose numbers are the lines' quantities
    const byVid = new Map(knownLines.map((l) => [l.vid.trim().toUpperCase(), l]))
    const score = new Map<string, number>()
    const costScore = new Map<string, number>()
    for (const r of knownRows) {
      const l = byVid.get(text(byRow.get(r)!.get(modelCol)).toUpperCase())
      if (!l) continue
      for (const [col, c] of byRow.get(r)!) {
        if (c.f || typeof c.v !== 'number') continue
        if (c.v === l.quantity) score.set(col, (score.get(col) ?? 0) + 1)
        if (l.unit_cost !== null && Math.abs(c.v - l.unit_cost) < 0.005) costScore.set(col, (costScore.get(col) ?? 0) + 1)
      }
    }
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]
    if (!best) return nothing("VMS could not tell which column of the form holds the quantities")
    inputCols = [best[0]]
    unitsCol = best[0]
    priceCol = [...costScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  const itemSet = new Set(itemRows)
  // the description: the text column with the most to say
  const descScore = new Map<string, number>()
  for (const r of itemRows) for (const [col, c] of byRow.get(r)!) { if (col === modelCol) continue; const t = text(c); if (t) descScore.set(col, (descScore.get(col) ?? 0) + t.length) }
  const descCol = [...descScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  // the color (or size) over an input cell: the nearest row above that heads the input columns, item rows skipped; a
  // header row with nothing in this column means this item has no such color
  const headerAbove = (r: number, col: string): string | null => {
    for (let i = r - 1; i >= 1; i--) {
      if (itemSet.has(i)) continue
      const row = byRow.get(i)
      if (!row) continue
      if (inputCols.some((c) => text(row.get(c)))) return text(row.get(col)) || null
    }
    return null
  }
  const sectionAbove = (r: number): string | null => {
    for (let i = r - 1; i >= 1; i--) {
      if (itemSet.has(i)) continue
      const t = text(byRow.get(i)?.get(modelCol))
      if (t) return /^(model|item|sku|style)/i.test(t) ? null : t
    }
    return null
  }
  const rows: FormRow[] = itemRows.map((r) => {
    const row = byRow.get(r)!
    const get = (col: string | null) => (col ? numv(row.get(col)) : null)
    return {
      row: r, model: text(row.get(modelCol)), description: descCol ? text(row.get(descCol)) : '', section: sectionAbove(r),
      inputs: inputCols.map((col) => ({ ref: `${col}${r}`, col, header: headerAbove(r, col), value: numv(row.get(col)) })),
      price: get(priceCol), cpq: get(cpqCol), cases: get(casesCol), units: get(unitsCol), total: get(totalCol),
    }
  })
  // the grand total: a SUM over the Total column, else the sum of the rows
  let total: number | null = null
  if (totalCol) {
    for (const [ref, c] of cells) {
      if (c.f && splitRef(ref).col === totalCol && /^SUM\(/i.test(c.f) && typeof c.v === 'number') { total = c.v; break }
    }
  }
  if (total === null) total = rows.reduce((n, x) => n + (x.total ?? (x.units !== null && x.price !== null ? x.units * x.price : 0)), 0)
  const formulaCols2 = [casesCol, unitsCol, totalCol].filter((c): c is string => !!c)
  const formulaRow = formulaCols2.length ? itemRows.find((r) => formulaCols2.every((c) => byRow.get(r)!.get(c)?.f)) ?? null : null
  return {
    editable: true, mode: cpqCol ? 'cases' : 'units', rows, total: Math.round(total * 100) / 100,
    columns: { model: modelCol, description: descCol, price: priceCol, cpq: cpqCol, cases: casesCol, units: unitsCol, total: totalCol }, formulaRow,
  }
}

// ---- editing ------------------------------------------------------------------------------------------------------------

export interface Edit { ref: string; value: number | null }

/**
 * Put the person's numbers in, recompute the form, and return the sheet XML to save. `repair` is the form's pattern row
 * and its formula columns: a row where someone typed a number over the Units formula (the 130cm snowboard on Slippery
 * Racer's form) gets the formula back when its inputs change, so the units and total follow the new cases.
 */
export function applyEdits(xml: string, cells: Cells, edits: Edit[], repair?: { fromRow: number; cols: string[] }): { xml: string; changed: string[] } {
  const touched = new Set<string>()
  const rowsTouched = new Set<number>()
  for (const e of edits) {
    const ref = e.ref.replace(/\$/g, '').toUpperCase()
    const c = cells.get(ref)
    if (c?.f) continue   // never type over a formula
    const v = e.value === null || !Number.isFinite(e.value) ? null : Math.round(e.value * 1e6) / 1e6
    if (c) { if (c.v === v) continue; c.v = v; c.t = 'n' } else cells.set(ref, { v, t: 'n' })
    touched.add(ref)
    rowsTouched.add(splitRef(ref).row)
  }
  if (repair) {
    for (const r of rowsTouched) {
      if (r === repair.fromRow) continue
      for (const col of repair.cols) {
        const from = cells.get(`${col}${repair.fromRow}`)
        const ref = `${col}${r}`
        const c = cells.get(ref)
        if (!from?.f || c?.f) continue
        const f = shiftFormula(from.f, `${col}${repair.fromRow}`, ref)
        if (c) c.f = f; else cells.set(ref, { v: null, f, t: 'n' })
        touched.add(ref)
      }
    }
  }
  const recomputed = recalc(cells)
  let out = xml
  for (const ref of [...touched, ...recomputed]) {
    const c = cells.get(ref)!
    out = setCell(out, ref, c.v === null ? null : { v: String(c.v), formula: c.f })
  }
  return { xml: out, changed: [...touched] }
}

/**
 * Write one numeric cell (keeps its style and its formula; a shared-formula follower keeps its `<f t="shared" si>` tag).
 */
export function setCell(xml: string, ref: string, val: { v: string; formula?: string } | null): string {
  const { col, row } = splitRef(ref)
  const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>(.*?)</c>)`, 's')
  const m = xml.match(cellRe)
  const style = m?.[1]?.match(/\ss="(\d+)"/)?.[0] ?? ''
  const existingF = m?.[2]?.match(/<f\b[^>]*\/>|<f\b[^>]*>.*?<\/f>/s)?.[0] ?? ''
  const formula = existingF || (val?.formula ? `<f>${escapeXml(val.formula)}</f>` : '')
  const cell = val === null ? `<c r="${ref}"${style}>${formula}</c>`.replace(/<c r="([A-Z]+\d+)"([^>]*)><\/c>/, '<c r="$1"$2/>') : `<c r="${ref}"${style}>${formula}<v>${val.v}</v></c>`
  if (m) return xml.replace(cellRe, () => cell)
  const rowRe = new RegExp(`<row r="${row}"[^>]*>(.*?)</row>`, 's')
  const rm = xml.match(rowRe)
  if (!rm) return xml.replace('</sheetData>', `<row r="${row}">${cell}</row></sheetData>`)
  const others = rm[1]!.match(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>.*?<\/c>)/gs) ?? []
  const before = others.filter((c) => colIndex(c.match(/r="([A-Z]+)/)![1]!) < colIndex(col))
  const after = others.filter((c) => colIndex(c.match(/r="([A-Z]+)/)![1]!) > colIndex(col))
  return xml.replace(rowRe, () => rm[0].replace(rm[1]!, [...before, cell, ...after].join('')))
}

/** The workbook recalculates when Excel opens it (belt and braces: VMS already wrote the values). */
export function forceRecalcOnOpen(workbookXml: string): string {
  if (/<calcPr\b[^>]*fullCalcOnLoad/.test(workbookXml)) return workbookXml
  if (/<calcPr\b/.test(workbookXml)) return workbookXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"')
  return workbookXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
}

// ---- the order's lines and the words for the email -----------------------------------------------------------------------

export interface FormLine { row: number; vendor_item_id: string; description: string; quantity: number; unit_cost: number | null; colors: string | null }

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** The colors (or whatever the input columns are headed) with a number in them: "1 Green, 2 Blue". */
export function colorsOf(r: FormRow): string | null {
  const parts = r.inputs.filter((i) => (i.value ?? 0) > 0 && i.header).map((i) => `${i.value} ${i.header}`)
  return parts.length ? parts.join(', ') : null
}

/** The rows with something ordered, as order lines. */
export function formLines(m: FormModel): FormLine[] {
  return m.rows.flatMap((r) => {
    const units = m.mode === 'cases' ? (r.units ?? (r.cases !== null && r.cpq !== null ? r.cases * r.cpq : 0)) : (r.inputs.reduce((n, i) => n + (i.value ?? 0), 0) || r.units || 0)
    if (!(units > 0)) return []
    const colors = colorsOf(r)
    return [{ row: r.row, vendor_item_id: r.model, description: r.description, quantity: units, unit_cost: r.price, colors }]
  })
}

/** What changed between two readings of the form, in plain words for the email and the file note. */
export function describeChanges(before: FormModel, after: FormModel): string[] {
  const a = new Map(before.rows.map((r) => [r.row, r]))
  const out: string[] = []
  for (const r of after.rows) {
    const was = a.get(r.row)
    const unitsWas = was ? (formLines({ ...before, rows: [was] })[0]?.quantity ?? 0) : 0
    const unitsNow = formLines({ ...after, rows: [r] })[0]?.quantity ?? 0
    const same = was && was.inputs.every((i, k) => (i.value ?? 0) === (r.inputs[k]?.value ?? 0))
    if (same) continue
    const name = `${r.model} ${r.description}`.trim()
    const detail = after.mode === 'cases'
      ? r.inputs.filter((i, k) => (i.value ?? 0) !== (was?.inputs[k]?.value ?? 0)).map((i, _k) => {
          const wasV = was?.inputs.find((x) => x.col === i.col)?.value ?? 0
          const nowV = i.value ?? 0
          const head = i.header ? `${i.header}: ` : ''
          return `${head}${plural(wasV, 'case')} → ${plural(nowV, 'case')}`
        }).join('; ')
      : ''
    if (unitsWas === 0 && unitsNow > 0) out.push(`Added ${name}: ${after.mode === 'cases' ? `${plural(r.cases ?? 0, 'case')}${r.cpq ? ` of ${r.cpq}` : ''} (${unitsNow} units)${colorsOf(r) ? `, ${colorsOf(r)}` : ''}` : `${unitsNow} units`}`)
    else if (unitsNow === 0) out.push(`Removed ${name} (was ${unitsWas} units)`)
    else out.push(`Changed ${name}: ${unitsWas} units → ${unitsNow} units${detail ? ` (${detail})` : ''}`)
  }
  if (before.total !== after.total && after.total !== null) out.push(`New order total: ${money(after.total)}${before.total !== null ? ` (was ${money(before.total)})` : ''}`)
  return out
}

/** Dana's name for a revised order file: "<name> REVISED M-D-YY.xlsx" (an earlier REVISED date is replaced). */
export function revisedFileName(fileName: string, on: Date): string {
  const ext = fileName.match(/\.[A-Za-z0-9]{2,5}$/)?.[0] ?? '.xlsx'
  const base = fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/\s*[-–]?\s*REVISED\b.*$/i, '').trim()
  const d = `${on.getMonth() + 1}-${on.getDate()}-${String(on.getFullYear()).slice(2)}`
  return `${base} REVISED ${d}${ext}`
}
