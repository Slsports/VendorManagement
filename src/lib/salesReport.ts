// Vendor sales reports (Dana's spec v49, docs/sales-report-spec.md): read a raw LS Analytics export, sort the items
// into the report's tabs (Active, No Data, Archived, Ignored, Flags), add the flag notes, and work out each item's Need.
// salesReportXlsx.ts writes the formatted workbook from this plan; suggestedOrder.ts uses the items.

import { genderOf, sizeOf, sizeRank, subcategoryOf } from './sizes'

export interface SalesItem {
  sid: string
  upc: string
  lsVendor: string
  vid: string
  desc: string
  cost: number | null
  cat: string
  archived: boolean
  sold: number
  /** non-inventory item ("-" on hand): no Need */
  nonInv: boolean
  qoh: number
  /** YYYY-MM-DD, or null = never sold */
  last: string | null
  notes: string[]
  /** Lightspeed's vendor id, when the items came from the copy of Lightspeed (to file a category report under its vendors). */
  lsVendorId?: string
  /** Sold and in stock per store code when the report keeps the stores apart (SLS, SLM, GS). */
  byStore?: Record<string, { sold: number; qoh: number }>
}

const COLORS = ['GREEN', 'RED', 'PINK', 'BLUE', 'YELLOW', 'PURPLE', 'BLACK', 'SILVER', 'WHITE', 'ORANGE', 'GRAY', 'GREY', 'BROWN', 'TAN', 'NAVY']

/** Sold − in stock (stock below zero counts as zero); positive = we need it, negative = overstocked. */
export const needOf = (x: Pick<SalesItem, 'sold' | 'qoh'>) => x.sold - Math.max(0, x.qoh)

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Find an export column by the words in its name (LS adds prefixes like "Item" and "Item Metrics"). */
function column(headers: string[], want: string[], not: string[] = []): string | null {
  return headers.find((h) => { const n = norm(h); return want.every((w) => n.includes(w)) && !not.some((w) => n.includes(w)) }) ?? null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export class ExportError extends Error {}

/** Rows of the raw export (first sheet, header row first) → items, each System ID once. */
export function readExport(rows: Record<string, unknown>[], runDate: Date): SalesItem[] {
  if (!rows.length) throw new ExportError('The file has no rows.')
  const headers = Object.keys(rows[0]!)
  const col = {
    sid: column(headers, ['system', 'id']),
    upc: column(headers, ['upc']),
    vendor: column(headers, ['default', 'vendor'], ['id']),
    vid: column(headers, ['default', 'vendor', 'id']),
    desc: column(headers, ['description']),
    cost: column(headers, ['cost']),
    cat: column(headers, ['category']),
    archived: column(headers, ['archived'], ['include']),
    sold: column(headers, ['sold'], ['days', 'since']),
    qoh: column(headers, ['on', 'hand']),
    days: column(headers, ['days', 'since', 'sold']),
  }
  const missing = (['sid', 'desc', 'sold', 'qoh'] as const).filter((k) => !col[k])
  if (missing.length) throw new ExportError(`This doesn't look like an LS sales export: no ${missing.map((k) => ({ sid: 'System ID', desc: 'Description', sold: 'Quantity Sold', qoh: 'Quantity on Hand' })[k]).join(', ')} column.`)
  const get = (r: Record<string, unknown>, k: keyof typeof col) => (col[k] ? r[col[k]!] : undefined)
  const seen = new Set<string>()
  const out: SalesItem[] = []
  for (const r of rows) {
    const sid = text(get(r, 'sid'))
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    const qohRaw = get(r, 'qoh')
    const nonInv = typeof qohRaw === 'string' && /^'?-$/.test(qohRaw.trim())
    const days = num(get(r, 'days'))
    const last = days === null ? null : isoDay(new Date(runDate.getFullYear(), runDate.getMonth(), runDate.getDate() - Math.round(days)))
    out.push({
      sid, upc: text(get(r, 'upc')), lsVendor: text(get(r, 'vendor')), vid: text(get(r, 'vid')), desc: text(get(r, 'desc')),
      cost: num(get(r, 'cost')), cat: text(get(r, 'cat')),
      archived: /^(yes|true|y)$/i.test(text(get(r, 'archived'))),
      sold: Math.round(num(get(r, 'sold')) ?? 0), nonInv, qoh: nonInv ? 0 : Math.round(num(qohRaw) ?? 0), last, notes: [],
    })
  }
  return out
}

/** The LS vendor names in the file, most items first. */
export function lsVendorsIn(items: SalesItem[]): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const x of items) m.set(x.lsVendor, (m.get(x.lsVendor) ?? 0) + 1)
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

/** Which LS vendor in the file is this VMS vendor ("PARICON - WWD" is PARICON). */
export function matchLsVendor(names: string[], vendorName: string, aliases: string[] = []): string | null {
  const strip = (s: string) => norm(s).replace(/\b(wwd|inc|llc|co|corp|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const ours = [vendorName, ...aliases].map(strip).filter(Boolean)
  return names.find((n) => ours.includes(strip(n))) ?? names.find((n) => ours.some((o) => strip(n).startsWith(o) || o.startsWith(strip(n)))) ?? null
}

/** Product line (spec Step 7): the description without the brand, the vendor's codes, colors and dashes. */
export function lineOf(desc: string, vendorName: string): string {
  let d = desc.toUpperCase().replace(/[”″]/g, '"')
  const brand = vendorName.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  d = d.replace(new RegExp(`^${brand}\\b`), '')
  d = d.replace(/\b[A-Z]{1,3}\d{2,}[A-Z]*\b/g, '')
  for (const c of COLORS) d = d.replace(new RegExp(`\\b${c}\\b`, 'g'), '')
  return d.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export interface ReportGroup { name: string; items: SalesItem[] }
export interface SizeRow { gender: string; subcategory: string; size: string; skus: number; sold: number; inStock: number; need: number; variants: string[] }
export interface ReportOptions {
  /** A vendor report (By Description tab, no Vendor column) or a category report (Vendor column, By Vendor tab). */
  kind?: 'vendor' | 'category'
  /** Store codes when the stores are kept apart (a Sold and an In Stock column per store); null for one set of columns. */
  stores?: string[] | null
}
export interface ReportPlan {
  vendor: string
  title: string
  kind: 'vendor' | 'category'
  stores: string[] | null
  /** Category reports: items by vendor, each vendor's items by need. */
  vendorGroups: ReportGroup[] | null
  /** Sized categories: the Size Summary rows (gender, subcategory, size), null when nothing is sized. */
  sizes: SizeRow[] | null
  active: SalesItem[]
  nodata: SalesItem[]
  archived: SalesItem[]
  ignored: SalesItem[]
  flagged: SalesItem[]
  /** Toys and other product-line vendors: tabs grouped by line, with a TYPE summary. */
  byLine: boolean
  activeGroups: ReportGroup[] | null
  categoryGroups: ReportGroup[] | null
  descriptionGroups: ReportGroup[] | null
  summary: { type: string; category: string; skus: number; sold: number; inStock: number; need: number }[]
  duplicates: number
}

const byCatDesc = (a: SalesItem, b: SalesItem) => (a.cat || '~').localeCompare(b.cat || '~') || a.desc.localeCompare(b.desc)
const byNeed = (a: SalesItem, b: SalesItem) => needOf(b) - needOf(a) || a.desc.localeCompare(b.desc)

function groupBy(items: SalesItem[], key: (x: SalesItem) => string): ReportGroup[] {
  const m = new Map<string, SalesItem[]>()
  for (const x of items) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]) }
  return [...m].map(([name, list]) => ({ name, items: [...list].sort(byNeed) }))
}

/** Row numbers of items on a tab laid out as title (1), headers (2), [TOTAL], then groups (header, TOTAL, items). */
export function activeRows(plan: Pick<ReportPlan, 'active' | 'activeGroups'>): Map<string, number> {
  const pos = new Map<string, number>()
  let r = 3
  if (plan.activeGroups) {
    for (const g of plan.activeGroups) { r += 2; for (const x of g.items) pos.set(x.sid, r++) }
  } else {
    r += 1
    for (const x of plan.active) pos.set(x.sid, r++)
  }
  return pos
}

/** Sort the items into the report's tabs and add the flag notes (spec: partitions first, no exceptions). */
export function planReport(all: SalesItem[], vendorName: string, runText: string, opts: ReportOptions = {}): ReportPlan {
  const kind = opts.kind ?? 'vendor'
  const items = all.map((x) => ({ ...x, notes: [] as string[] }))
  const ignored = items.filter((x) => x.archived && x.sold === 0 && x.qoh <= 0).sort(byCatDesc)
  const rest = items.filter((x) => !ignored.includes(x))
  const nodata = rest.filter((x) => !x.archived && x.sold === 0 && x.qoh <= 0 && !x.nonInv).sort(byCatDesc)
  const archived = rest.filter((x) => x.archived).sort(byCatDesc)
  const active = rest.filter((x) => !x.archived && !nodata.includes(x))

  for (const x of nodata) x.notes.push('Zero sales, zero stock — review whether this should be archived in LS.')
  for (const x of rest) if (x.archived && x.qoh > 0) x.notes.push('Archived item still shows stock — LS should be zero. Unarchive then re-archive in LS to wipe the stock.')
  for (const x of rest) if (!x.cat) x.notes.push('Category missing in LS — verify/correct.')

  // product lines: three or more lines with two or more items each
  const lineKey = (x: SalesItem) => `${x.cat}\u0000${lineOf(x.desc, vendorName)}`
  const lines = new Map<string, SalesItem[]>()
  for (const x of active) lines.set(lineKey(x), [...(lines.get(lineKey(x)) ?? []), x])
  const byLine = [...lines.values()].filter((l) => l.length > 1).length >= 3
  const lineName = (x: SalesItem) => `${x.cat || '(No Category)'} — ${title(lineOf(x.desc, vendorName))}`

  const activeSorted = byLine
    ? [...active].sort((a, b) => (a.cat).localeCompare(b.cat) || lineOf(a.desc, vendorName).localeCompare(lineOf(b.desc, vendorName)) || byNeed(a, b))
    : [...active].sort((a, b) => a.cat.localeCompare(b.cat) || a.desc.localeCompare(b.desc))
  const activeGroups = byLine ? groupBy(activeSorted, lineName) : null

  // duplicates among live listings: same Vendor ID, UPC, or description in the same category (colors are variants)
  const words = (x: SalesItem) => new Set(x.desc.toUpperCase().split(/\s+/))
  const variant = (a: SalesItem, b: SalesItem) => { const wa = words(a), wb = words(b); return COLORS.some((c) => wa.has(c) !== wb.has(c)) }
  const pool = rest.filter((x) => !x.archived)
  const pos = activeRows({ active: activeSorted, activeGroups })
  let duplicates = 0
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!, b = pool[j]!
      const why = [
        a.vid && a.vid === b.vid ? 'same Vendor ID' : null,
        a.upc && a.upc === b.upc ? 'same UPC' : null,
        a.desc.toUpperCase() === b.desc.toUpperCase() && a.cat === b.cat ? 'same description' : null,
      ].filter(Boolean).join(', ')
      if (!why || variant(a, b)) continue
      duplicates++
      a.notes.push(`Duplicate – matches row ${pos.get(b.sid) ?? '?'} on Active tab (${why}). Review which listing to keep — consider merging in LS.`)
      b.notes.push(`Duplicate – matches row ${pos.get(a.sid) ?? '?'} on Active tab (${why}). Review which listing to keep — consider merging in LS.`)
    }
  }

  const summary = byLine
    ? [...lines.values()].map((l) => ({
        type: title(lineOf(l[0]!.desc, vendorName)), category: l[0]!.cat, skus: l.length,
        sold: l.reduce((s, x) => s + x.sold, 0), inStock: l.reduce((s, x) => s + Math.max(0, x.qoh), 0), need: l.reduce((s, x) => s + Math.max(0, needOf(x)), 0),
      })).sort((a, b) => a.category.localeCompare(b.category) || b.need - a.need)
    : []

  // the Size Summary (spec v49): sized items by gender, subcategory and size; spelling variants of a size are one row
  const sized = active.map((x) => ({ x, size: sizeOf(x.desc, x.cat) })).filter((r) => r.size)
  let sizes: SizeRow[] | null = null
  if (sized.length && sized.length >= Math.max(3, active.length * 0.3)) {
    const m = new Map<string, SizeRow>()
    for (const { x, size } of sized) {
      const gender = genderOf(x.desc, x.cat), sub = subcategoryOf(x.cat)
      const k = `${gender}\u0000${sub}\u0000${size!.size}`
      const row = m.get(k) ?? { gender, subcategory: sub, size: size!.size, skus: 0, sold: 0, inStock: 0, need: 0, variants: [] }
      row.skus++; row.sold += x.sold; row.inStock += Math.max(0, x.qoh); row.need += Math.max(0, needOf(x))
      if (!row.variants.includes(size!.raw)) row.variants.push(size!.raw)
      m.set(k, row)
    }
    sizes = [...m.values()].sort((a, b) => a.gender.localeCompare(b.gender) || a.subcategory.localeCompare(b.subcategory) || sizeRank(a.size) - sizeRank(b.size) || a.size.localeCompare(b.size))
  }

  return {
    vendor: vendorName,
    title: `${vendorName} — Report Run ${runText}`,
    kind,
    stores: opts.stores ?? null,
    vendorGroups: kind === 'category' ? groupBy([...active].sort((a, b) => a.lsVendor.localeCompare(b.lsVendor) || a.desc.localeCompare(b.desc)), (x) => x.lsVendor || '(No Vendor)') : null,
    sizes,
    active: activeSorted,
    nodata, archived, ignored,
    flagged: [...active, ...nodata, ...archived].filter((x) => x.notes.length).sort(byCatDesc),
    byLine,
    activeGroups,
    categoryGroups: byLine ? groupBy([...active].sort((a, b) => a.cat.localeCompare(b.cat) || lineOf(a.desc, vendorName).localeCompare(lineOf(b.desc, vendorName))), lineName) : null,
    descriptionGroups: byLine ? groupBy([...active].sort((a, b) => lineOf(a.desc, vendorName).localeCompare(lineOf(b.desc, vendorName)) || a.desc.localeCompare(b.desc)), (x) => title(lineOf(x.desc, vendorName))) : null,
    summary,
    duplicates,
  }
}

/** "DP_10-11-26_PARICON_SALES 365 DAYS.xlsx" (spec naming). */
/** "DP_10-11-26_PARICON_SALES 365 DAYS.xlsx", or "…_SALES 1-1-26 TO 3-31-26.xlsx" for a date range (spec naming). */
export function reportFileName(initials: string, run: Date, vendorName: string, days: number | { from: string; to: string }): string {
  const d = `${String(run.getMonth() + 1).padStart(2, '0')}-${String(run.getDate()).padStart(2, '0')}-${String(run.getFullYear()).slice(2)}`
  const span = typeof days === 'number' ? `${days} DAYS` : `${mdy(days.from)} TO ${mdy(days.to)}`
  return `${initials}_${d}_${vendorName.toUpperCase().replace(/[\\/:*?"<>|]+/g, ' ').trim()}_SALES ${span}.xlsx`
}

const mdy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(m)}-${Number(d)}-${y!.slice(2)}` }
export const initialsOf = (name: string | null | undefined) => (name ?? '').split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('').slice(0, 3) || 'VMS'
export const runText = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`

/**
 * A sales report that is already formatted (Dana, Oct 15: WFS "8-29-26 … SALES v3", with Size Summary, Active, No Data,
 * Flags and Archived tabs and her Order column): the item tabs are read back into items, each System ID once. Null when
 * the workbook is not one (no tab with System ID, Sold and In Stock in its header).
 */
export function readFormattedReport(sheets: { name: string; rows: unknown[][] }[]): { items: SalesItem[]; runDate: string | null } | null {
  const seen = new Set<string>()
  const items: SalesItem[] = []
  let runDate: string | null = null
  let found = false
  for (const s of sheets) {
    const at = s.rows.slice(0, 5).findIndex((r) => { const h = r.map((c) => norm(text(c))); return h.includes('system id') && h.includes('sold') && h.includes('in stock') })
    if (at < 0) continue
    found = true
    const title = text(s.rows[0]?.[0])
    const run = /run\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(title)
    if (run && !runDate) runDate = `${run[3]!.length === 2 ? `20${run[3]}` : run[3]}-${run[1]!.padStart(2, '0')}-${run[2]!.padStart(2, '0')}`
    const h = s.rows[at]!.map((c) => norm(text(c)))
    const ix = (name: string) => h.indexOf(name)
    const c = { sid: ix('system id'), upc: ix('upc'), vid: ix('vendor id'), desc: ix('description'), cost: ix('cost'), cat: ix('category'), last: ix('last sold date'), sold: ix('sold'), qoh: ix('in stock') }
    const archived = /archived/i.test(s.name) || /archived/i.test(title)
    for (const r of s.rows.slice(at + 1)) {
      const sid = text(r[c.sid])
      if (!sid || seen.has(sid)) continue
      seen.add(sid)
      const lastText = c.last >= 0 ? text(r[c.last]) : ''
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(lastText)
      const qohRaw = r[c.qoh]
      const nonInv = typeof qohRaw === 'string' && /^'?-$/.test(qohRaw.trim())
      items.push({
        sid, upc: c.upc >= 0 ? text(r[c.upc]) : '', lsVendor: '', vid: c.vid >= 0 ? text(r[c.vid]) : '', desc: c.desc >= 0 ? text(r[c.desc]) : '',
        cost: c.cost >= 0 ? num(r[c.cost]) : null, cat: c.cat >= 0 ? text(r[c.cat]) : '', archived,
        sold: Math.round(num(r[c.sold]) ?? 0), nonInv, qoh: nonInv ? 0 : Math.round(num(qohRaw) ?? 0),
        last: m ? `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null, notes: [],
      })
    }
  }
  return found ? { items, runDate } : null
}
