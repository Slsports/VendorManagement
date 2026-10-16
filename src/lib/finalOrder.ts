// The final confirmed order from a confirmation check (Dana, Oct 16): each row of the comparison can get a final
// quantity, be removed, or be ticked OK (take the confirmation as it is). The email to the vendor lists what changed,
// each with its item number and name, then the whole final order.

export interface CheckRowLike { what: string; ours: string | null; theirs: string | null; ok: boolean; note: string | null }
export interface RowEdit { qty?: number | null; removed?: boolean; ok?: boolean }
export interface ReadLine { vendor_item_id: string | null; description: string | null; quantity: number | null; unit_cost: number | null }
export interface FinalLine { item: string; name: string; qty: number; cost: number | null }
export interface Change { item: string; name: string; text: string }

/** Header rows (total, freight, terms…) are compared but have no quantity to change. */
const FIELD = /^(sub ?total|total|grand total|freight|shipping|ship(ping)? (date|window|via)|terms|payment terms|po\b|po number|ship to|bill to|tax|discount|fees?|handling|deposit|cancel)/i
export const isFieldRow = (r: { what: string }) => FIELD.test(r.what.trim())

/** The first number in a cell: "12" → 12, "144 at $0.15" → 144; null when there is none. */
export function qtyIn(text: string | null): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec((text ?? '').replace(/,/g, '').replace(/\$\s?\d+(?:\.\d+)?/g, ''))
  return m ? Number(m[0]) : null
}
const priceIn = (text: string | null) => { const m = /\$\s?(\d+(?:\.\d+)?)/.exec(text ?? ''); return m ? Number(m[1]) : null }
const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The confirmation's line for a row: the longest Vendor ID the row starts with. */
function lineFor(what: string, lines: ReadLine[]): ReadLine | null {
  const w = norm(what)
  let best: ReadLine | null = null
  for (const l of lines) {
    const id = norm(l.vendor_item_id)
    if (id && w.startsWith(id) && (!best || id.length > norm(best.vendor_item_id).length)) best = l
  }
  return best
}

/** Item number and name for a row: from the confirmation's line, else split from the row's text. */
export function itemOf(r: { what: string }, lines: ReadLine[]): { item: string; name: string } {
  const l = lineFor(r.what, lines)
  // "(matched to …)" / "(confirmation: …)" notes are not part of the name; "(no ID)" means there is no item number
  const what = r.what.replace(/\s*\((matched to|confirmation:|report id)[^)]*\)\s*$/i, '').trim()
  const noId = /^\(no (vendor )?id\)\s*/i.exec(what)
  if (noId) return { item: '', name: what.slice(noId[0].length).trim() }
  if (l?.vendor_item_id) {
    const rest = what.slice(what.toUpperCase().indexOf(l.vendor_item_id.toUpperCase()) + l.vendor_item_id.length).trim()
    return { item: l.vendor_item_id, name: (l.description || rest).trim() }
  }
  const [item, ...name] = what.split(/\s+/)
  return { item: item ?? what, name: name.join(' ') }
}

/** What the confirmation has, what we ordered, and the final quantity after the edit. */
export function rowQtys(r: CheckRowLike, e: RowEdit | undefined): { theirs: number | null; ours: number | null; final: number } {
  const theirs = qtyIn(r.theirs)
  const ours = qtyIn(r.ours)
  if (e?.removed) return { theirs, ours, final: 0 }
  if (e?.qty !== undefined && e.qty !== null) return { theirs, ours, final: e.qty }
  if (e?.ok) return { theirs, ours, final: theirs ?? 0 }
  // untouched: the confirmation's number; an item they left off starts at what we ordered
  return { theirs, ours, final: theirs ?? ours ?? 0 }
}

/** A row the buyer has dealt with (ticked, changed or removed), or that already matched. */
export const rowHandled = (r: CheckRowLike, e: RowEdit | undefined) => r.ok || !!e?.ok || !!e?.removed || (e?.qty !== undefined && e.qty !== null)

/** The final order and the changes from the confirmation. */
export function buildFinalOrder(rows: CheckRowLike[], edits: Record<string, RowEdit>, lines: ReadLine[], newItems: { what: string; qty: number | null; price: number | null }[] = []): { items: FinalLine[]; changes: Change[] } {
  const items: FinalLine[] = []
  const changes: Change[] = []
  const used = new Set<ReadLine>()
  for (const r of rows) {
    if (isFieldRow(r)) continue
    const e = edits[r.what]
    const { item, name } = itemOf(r, lines)
    const l = lineFor(r.what, lines)
    if (l) used.add(l)
    const { theirs, final } = rowQtys(r, e)
    if (e?.removed && (theirs ?? 0) > 0) changes.push({ item, name, text: 'please remove' })
    else if (!e?.removed && !(theirs ?? 0) && final > 0) changes.push({ item, name, text: `please add ${final}` })
    else if (!e?.removed && (theirs ?? 0) > 0 && final !== theirs) changes.push({ item, name, text: `${theirs} → ${final}` })
    if (final > 0) items.push({ item, name, qty: final, cost: l?.unit_cost ?? priceIn(r.theirs) ?? priceIn(r.ours) })
  }
  // new items picked at the show, and any confirmation line the comparison did not list, stay as they are
  for (const n of newItems) {
    if (!n.qty) continue
    const l = lineFor(n.what, lines)
    if (l) { if (used.has(l)) continue; used.add(l) }
    const { item, name } = itemOf(n, lines)
    items.push({ item, name, qty: n.qty, cost: l?.unit_cost ?? n.price })
  }
  for (const l of lines) {
    if (used.has(l) || !(l.quantity && l.quantity > 0)) continue
    items.push({ item: l.vendor_item_id ?? '', name: l.description ?? '', qty: l.quantity, cost: l.unit_cost })
  }
  return { items, changes }
}

const money = (n: number) => `$${n.toFixed(2)}`
export const CASE_PACK_LINE = "Please reply to confirm this order. If any quantities don't fit your case packs, let me know so I can adjust and then we can finalize the order."

/** The email to the vendor: what changed, the case-pack line, then the final order. No signature (added when sent). */
export function finalOrderEmail(o: { firstName: string | null; docNumber: string | null; po: string | null; items: FinalLine[]; changes: Change[] }): string {
  const label = (x: { item: string; name: string }) => [x.item, x.name].filter(Boolean).join(' ')
  const out = [`Hi ${o.firstName || 'there'},`, '', `Thank you for the confirmation${o.docNumber ? ` (${o.docNumber})` : ''}. Here is our final order${o.po ? ` for PO ${o.po}` : ''}.`, '']
  if (o.changes.length) out.push('What changed:', ...o.changes.map((c) => `- ${label(c)}: ${c.text}`), '')
  else out.push('Everything on your confirmation is right.', '')
  out.push(CASE_PACK_LINE, '', 'Final order:')
  let units = 0
  let total = 0
  let priced = true
  for (const i of o.items) {
    units += i.qty
    if (i.cost === null) priced = false
    else total += i.qty * i.cost
    out.push(`- ${label(i)}: ${i.qty}${i.cost !== null ? ` at ${money(i.cost)}` : ''}`)
  }
  out.push('', `${o.items.length} items, ${units} units${priced && o.items.length ? `, ${money(total)}` : ''}`, '', 'Thank you!')
  return out.join('\n')
}
