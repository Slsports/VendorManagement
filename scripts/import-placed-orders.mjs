#!/usr/bin/env node
/**
 * Import Dana's Placed Order Summary v2.0 (tabs 1-Open Orders, 2-Entered Orders to Pay, 3-Paid Orders,
 * 4-CANCELLED ORDERS; the other tabs are ignored, Dana, Oct 9). The Seasonal Buying Guide already loaded
 * most of these orders, so each sheet row is matched to an order on file first:
 *   1. same vendor, same order date and same cost
 *   2. same vendor and same PO (only one such order)
 *   3. same vendor and same cost, the order on file has no date (only one)
 * A matched order is refreshed from the sheet (the sheet is the source of truth until go-live): what the
 * sheet says wins, blanks never erase, and a status only moves forward (paid stays paid) unless the sheet
 * cancelled it. Rows with no match become new orders (source 'placed_order_summary', re-runnable by key).
 * A "freight allowance" note sets the pay-on-time freight allowance on the order. A field someone changed in
 * VMS (a fixed date) keeps its VMS value.
 *
 *   node scripts/import-placed-orders.mjs --file summary.xlsx [--dry]
 */
import XLSX from 'xlsx'
import { createHash } from 'node:crypto'
import { query, lit, textArray } from './db.mjs'
import { buildIndex, findVendor, nameKey, parseArgs, die } from './lib/match.mjs'
import { toDate, toMoney, yn, stores, showFor, cleanName } from './lib/orderSheet.mjs'

const args = parseArgs(process.argv.slice(2))
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
if (!args.file) die('--file is required')

const TABS = [[/^1-/, 'open'], [/^2-/, 'entered'], [/^3-/, 'paid'], [/^4-|cancel/i, 'cancelled']]
// Tab 4 has no header row: date, who, store, vendor, WWD?, what, est ship, cost, freight, …, notes.
const CANCELLED_COLS = ['Date Ordered', 'Who Placed Order', 'Store', 'Vendor', 'WWD? (Y or N)', 'What was ordered?', 'Est Ship Date', 'Est Cost', 'Freight Cost', '', '', '', '', '', '', 'Shipment Notes']
const HEAD = [
  [/^(placed order date|date ordered)$/i, 'Date Ordered'], [/^who placed/i, 'Who Placed Order'], [/^store/i, 'Store'], [/^wwd\?/i, 'WWD? (Y or N)'],
  [/^vendor$/i, 'Vendor'], [/^what was ordered/i, 'What was ordered?'], [/^est ship/i, 'Est Ship Date'], [/^est cost/i, 'Est Cost'], [/^freight cost/i, 'Freight Cost'],
  [/^date received/i, 'Date Received'], [/^po$/i, 'PO'], [/^ar due/i, 'AR Due Date'], [/^date entered/i, 'Date Entered to LS'], [/^who entered/i, 'Who Entered Order?'],
  [/^bo\?/i, 'BO? Y or N'], [/^shipment notes/i, 'Shipment Notes'], [/^credits due/i, 'Credits Due? Y or N'], [/^ok to pay/i, 'Ok to Pay? Y or N'], [/^credit notes/i, 'Credit Notes'],
  [/^dana'?s notes/i, "Dana's Notes"], [/^date credits received/i, 'Date Credits Received'], [/^final cost/i, 'Final Cost (Dana)'], [/^date paid/i, 'Date Paid (Dana)'],
  [/^rep group/i, 'Rep Group'], [/^rep name/i, 'Rep Name'], [/^rep phone/i, 'Rep Phone'], [/pick ?up address/i, 'Pickup Address'], [/^sh[i]?pping contact$/i, 'Shipping Contact'],
  [/^shipping contact phone/i, 'Shipping Contact Phone'], [/^pickup times/i, 'Pickup Times'],
]
const canon = (h) => { const t = String(h).replace(/\s+/g, ' ').trim(); for (const [re, k] of HEAD) if (re.test(t)) return k; return t }

// ---------- read tabs 1-4 ----------
const wb = XLSX.readFile(args.file)
const sheetRows = []
for (const sheetName of wb.SheetNames) {
  const status = TABS.find(([re]) => re.test(sheetName))?.[1]
  if (!status) continue
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false })
  const hi = status === 'cancelled' ? -1 : grid.findIndex((r) => r.some((c) => /^vendor\s*$/i.test(String(c).trim())))
  const head = status === 'cancelled' ? CANCELLED_COLS : grid[hi].map(canon)
  for (const r of grid.slice(hi + 1)) {
    const o = {}
    head.forEach((k, i) => { if (k) o[k] = String(r[i] ?? '').replace(/ /g, ' ').trim() })
    // tab 4 swaps the vendor and WWD? cells on some rows
    if (status === 'cancelled' && /^[yn]$/i.test(o['Vendor'])) [o['Vendor'], o['WWD? (Y or N)']] = [o['WWD? (Y or N)'], o['Vendor']]
    if (status === 'cancelled') o['Vendor'] = o['Vendor'].replace(/\s*-\s*(cancelled.*|faire.*)$/i, '').trim()
    if (!o['Vendor'] || /^vendor$/i.test(o['Vendor'])) continue
    if (!o['What was ordered?'] && !o['Est Cost'] && !o['Date Ordered']) continue
    sheetRows.push({ ...o, sheet: sheetName, status })
  }
}
// A row typed twice on the sheet (same vendor, date, cost, what was ordered and store) is one order, as in the
// Buying Guide import.
{
  const seen = new Set()
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9.]/g, '')
  for (let i = sheetRows.length - 1; i >= 0; i--) {
    const o = sheetRows[i]
    const k = [o['Vendor'], toDate(o['Date Ordered']) ?? o['Date Ordered'], toMoney(o['Est Cost']) ?? o['Est Cost'], o['What was ordered?'], o['Store'], o.status].map(norm).join('|')
    if (seen.has(k)) sheetRows.splice(i, 1); else seen.add(k)
  }
}
console.log(`rows: ${TABS.map(([, s]) => `${s} ${sheetRows.filter((r) => r.status === s).length}`).join(', ')}`)

// ---------- vendors ----------
const live = await query(`select v.id, v.name, v.lightspeed_name, v.aliases from public.vendors v where organization_id = ${lit(ORG)} and is_active`)
const index = buildIndex(live)
const resolved = new Map()
const toCreate = new Map()
// "SMITH OPTICS/SUNCLOUD", "OKUMA-WORLDWIDE", "WORLDWIDE/WEINBERG": the brand is one of the parts.
const WWD_WORDS = /\b(worldwide( dist(ributors)?| warehouse| buying group)?|wwd( warehouse)?|faire|ebay|show special|shipping from wwd|ships from wwd)\b:?/gi
function lookup(n) {
  const tries = [n, cleanName(n), n.replace(WWD_WORDS, ' ').replace(/^[\s/:-]+|[\s/:-]+$/g, '').replace(/\s+/g, ' ')]
  for (const t of tries) { const hit = t && findVendor(index, t); if (hit) return hit.vendor.id }
  const parts = n.replace(WWD_WORDS, ' ').split(/\s*[/]\s*|\s+-\s*|-(?=[A-Z]{3})/).map((x) => x.trim()).filter((x) => x.length >= 3)
  const ids = [...new Set(parts.map((x) => findVendor(index, x)?.vendor.id).filter(Boolean))]
  return ids.length === 1 ? ids[0] : null
}
// Spellings checked by hand against VMS (Oct 9): sheet name → VMS vendor name.
const HINTS = {
  'ATLAS MIKES / PAUTZKE BAIT CO': 'PAUTZKE BAIT CO', 'G. PUCCI AND SONS': 'G PUCCI', 'PUCCI / P-LINE': 'G PUCCI', 'PUCCI': 'G PUCCI', 'MYKOS': 'MYKOS-LAMO',
  "KELLI'S GIFTS": "KELLI'S", 'ALEXANDER US SUNGLASSES': 'ALEXANDER', 'RUKO RYNO BLADE': 'RUKO', 'LEISURE CONCEPTS INT INC': 'LEISURE CONCEPTS INTL',
  'NEWELL COLEMAN': 'COLEMAN - NEWELL BRANDS', 'OUTRAGEOUS': 'OUTRAGEOUS SPORTS', 'WWD WAREHOUSE: TOYS 2': 'Worldwide Warehouse',
}
const SAME = { 'TOPHAT CRICKETS': 'TOPHAT CRICKET FARM' }
const hinted = new Map((await query(`select id, upper(name) as n from public.vendors where organization_id = ${lit(ORG)} and upper(name) in (${Object.values(HINTS).map((h) => lit(h.toUpperCase())).join(',')})`)).map((v) => [v.n, v.id]))
for (const n of new Set(sheetRows.map((r) => r['Vendor']))) resolved.set(n, hinted.get(HINTS[n.toUpperCase().trim()]?.toUpperCase()) ?? lookup(n))

// ---------- rows → order fields ----------
const ALLOWANCE = /freight allowance|allowance if paid|if (you )?pay on time|paid on or before/i
const rows = sheetRows.map((o) => {
  const route = yn(o['WWD? (Y or N)']) ? 'worldwide' : /^n/i.test(o['WWD? (Y or N)'] || '') ? 'direct' : null
  const orderDate = toDate(o['Date Ordered'])
  const freight = toMoney(o['Freight Cost'])
  const allText = [o['Shipment Notes'], o['Credit Notes'], o["Dana's Notes"], o['Freight Cost']].filter(Boolean).join(' ')
  const extra = Object.fromEntries(Object.entries({
    'Rep Group': o['Rep Group'], 'Rep Name': o['Rep Name'], 'Rep Phone': o['Rep Phone'], 'Pickup Address': o['Pickup Address'],
    'Shipping Contact': o['Shipping Contact'], 'Shipping Contact Phone': o['Shipping Contact Phone'], 'Pickup Times': o['Pickup Times'],
    ...Object.fromEntries(['Date Ordered', 'Est Ship Date', 'Date Received', 'Date Entered to LS', 'Date Credits Received', 'Date Paid (Dana)'].filter((c) => o[c] && !toDate(o[c])).map((c) => [`${c} (as typed)`, o[c]])),
  }).filter(([, v]) => v))
  const paidDate = toDate(o['Date Paid (Dana)'])
  return {
    sheetVendor: o['Vendor'], sheet: o.sheet, status: o.status, orderDate, route,
    show: showFor(orderDate, route === 'worldwide'), placedBy: o['Who Placed Order'] || null, stores: stores(o['Store']),
    description: o['What was ordered?'] || null, estShip: toDate(o['Est Ship Date']), estCost: toMoney(o['Est Cost']),
    freight, freightNotes: freight === null && o['Freight Cost'] ? o['Freight Cost'] : (/[a-z@]/i.test(o['Freight Cost'] || '') ? o['Freight Cost'] : null),
    received: toDate(o['Date Received']), po: o['PO'] || null, arDue: o['AR Due Date'] || null, arDueDate: toDate(o['AR Due Date']),
    enteredLs: toDate(o['Date Entered to LS']), enteredBy: o['Who Entered Order?'] || null, backorder: yn(o['BO? Y or N']), shipNotes: o['Shipment Notes'] || null,
    creditsDue: yn(o['Credits Due? Y or N']), creditNotes: o['Credit Notes'] || null, creditsReceived: toDate(o['Date Credits Received']), okToPay: yn(o['Ok to Pay? Y or N']),
    notes: o["Dana's Notes"] || null, finalCost: toMoney(o['Final Cost (Dana)']), paidDate, paidVia: paidDate ? (route === 'worldwide' ? 'wwd' : 'billcom') : null,
    allowance: ALLOWANCE.test(allText),
    // "495.00/0.00", "FREE/179.24", "0.00 IF PAID ON TIME OR 18.75", "SUBTRACT SHIPPING 179.24": the freight they credit back
    allowanceAmount: (() => { const m = [...String(o['Freight Cost'] || '').replace(/@\s*[\d,.]+/g, '').matchAll(/\$?(\d[\d,]*\.\d{2})/g)].map((x) => Number(x[1].replace(/,/g, ''))).filter((n) => n > 0); return m.length ? Math.max(...m) : freight })(),
    key: 'pos:' + createHash('sha1').update([o['Vendor'], o['Date Ordered'], o['What was ordered?'], o['Est Cost'], o['Store']].map((x) => (x || '').toLowerCase().replace(/\s+/g, ' ')).join('|')).digest('hex').slice(0, 24),
    extra,
  }
})

// ---------- match to orders on file ----------
const onFile = await query(`select id, vendor_id, order_date::text as order_date, est_cost::float8 as est_cost, final_cost::float8 as final_cost, public.po_key(po_number) as po, status::text as status, source_key from public.orders where organization_id = ${lit(ORG)}`)
const byKey = new Map(onFile.filter((o) => o.source_key).map((o) => [o.source_key, o]))
const taken = new Set()
const near = (a, b) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.005
const poKey = (p) => String(p || '').toLowerCase().replace(/^\s*(p\.?\s?o\.?|purchase order)\s*(#|no\.?|number)?\s*/, '').replace(/[^a-z0-9]/g, '') || null
const descKey = (d) => String(d || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
const descOf = new Map((await query(`select id, description from public.orders where organization_id = ${lit(ORG)}`)).map((o) => [o.id, descKey(o.description)]))
// A sheet spelling we could not place: the Buying Guide already filed the same order (date, cost, what was
// ordered) under a vendor, so that vendor is the one this spelling means.
const learned = new Map()
for (const r of rows) {
  if (resolved.get(r.sheetVendor) || !r.orderDate) continue
  const c = onFile.filter((o) => o.order_date === r.orderDate && near(o.est_cost, r.estCost) && descOf.get(o.id) === descKey(r.description))
  if (c.length && new Set(c.map((o) => o.vendor_id)).size === 1) { const l = learned.get(r.sheetVendor) || new Map(); l.set(c[0].vendor_id, (l.get(c[0].vendor_id) || 0) + 1); learned.set(r.sheetVendor, l) }
}
for (const [n, l] of learned) if (l.size === 1) resolved.set(n, [...l.keys()][0])
for (const n of resolved.keys()) {
  if (resolved.get(n)) continue
  const base = SAME[n.toUpperCase().trim()] ?? n
  const ck = nameKey(cleanName(base)) || nameKey(base)
  const c = toCreate.get(ck) || { name: cleanName(base) || base, sheetNames: [] }
  c.sheetNames.push(n)
  toCreate.set(ck, c)
  resolved.set(n, { newKey: ck })
}
console.log(`vendors on the sheet ${resolved.size} | learned from orders on file ${[...learned.values()].filter((l) => l.size === 1).length} | to create ${toCreate.size}${toCreate.size ? ': ' + [...toCreate.values()].map((c) => c.name).join(' | ') : ''}`)

let how = { key: 0, date_cost: 0, po: 0, cost: 0, new: 0 }
for (const r of rows) {
  const vid = typeof resolved.get(r.sheetVendor) === 'string' ? resolved.get(r.sheetVendor) : null
  r.vendorId = vid
  const free = (o) => !taken.has(o.id)
  let m = byKey.get(r.key)
  if (m) how.key++
  if (!m && vid) {
    const mine = onFile.filter((o) => o.vendor_id === vid && free(o))
    let c = mine.filter((o) => o.order_date === r.orderDate && (near(o.est_cost, r.estCost) || (r.estCost === null && o.est_cost === null)))
    if (c.length > 1) c = c.filter((o) => descOf.get(o.id) === descKey(r.description)).concat(c).slice(0, 1)
    if (c.length >= 1) { m = c[0]; how.date_cost++ }
    if (!m && poKey(r.po)) { c = mine.filter((o) => o.po === poKey(r.po)); if (c.length === 1) { m = c[0]; how.po++ } }
    if (!m && r.estCost !== null) { c = mine.filter((o) => near(o.est_cost, r.estCost) && descOf.get(o.id) === descKey(r.description)); if (c.length === 1) { m = c[0]; how.cost++ } }
  }
  if (m) { taken.add(m.id); r.match = m } else how.new++
}
const statusMoves = rows.filter((r) => r.match && r.match.status !== r.status)
console.log(`matched: same key ${how.key}, date+cost ${how.date_cost}, PO ${how.po}, cost ${how.cost} | new orders ${how.new} | status changes ${statusMoves.length} | freight allowance ${rows.filter((r) => r.allowance).length}`)
console.log(`orders on file not on the sheet: ${onFile.filter((o) => !taken.has(o.id)).length}`)
if (args.verbose) for (const r of rows.filter((r) => !r.match).slice(0, 40)) console.log(`  new: ${r.sheet.slice(0, 2)} ${r.sheetVendor} | ${r.orderDate} | ${r.estCost} | ${r.description?.slice(0, 40)}`)
if (dry) { console.log('\nDry run only. Nothing written.'); process.exit(0) }

// ---------- write ----------
if (toCreate.size) {
  const vals = [...toCreate.values()].map((c) => `(${lit(ORG)}, ${lit(c.name)}, ${textArray(c.sheetNames.filter((s) => s !== c.name))}, true, 'Created from the Placed Order Summary (we have ordered from them). Check it is not a duplicate of an existing vendor.')`)
  await query(`insert into public.vendors (organization_id, name, aliases, needs_review, review_note) values ${vals.join(',\n')} on conflict do nothing`)
  const made = await query(`select id, lower(name) as n from public.vendors where organization_id = ${lit(ORG)} and name in (${[...toCreate.values()].map((c) => lit(c.name)).join(',')})`)
  const idOf = new Map(made.map((v) => [v.n, v.id]))
  for (const r of rows) { const x = resolved.get(r.sheetVendor); if (x && typeof x !== 'string') r.vendorId = idOf.get(toCreate.get(x.newKey).name.toLowerCase()) ?? null }
}
const D = (d) => (d ? lit(d) + '::date' : 'null')
const N = (n) => (n === null || n === undefined ? 'null' : String(n))
const RANK = { open: 0, awaiting_confirmation: 1, confirmed: 2, shipped: 3, received: 4, entered: 5, ready_to_pay: 6, paid: 7 }
const stmts = []
let inserted = 0, updated = 0
for (const r of rows) {
  if (!r.vendorId) continue
  const allowanceSet = r.allowance ? `, freight_allowance_offered = true, freight_allowance = coalesce(freight_allowance, ${N(r.allowanceAmount)}), freight_allowance_pay_by = coalesce(freight_allowance_pay_by, ${D(r.arDueDate)})` : ''
  if (r.match) {
    const cur = r.match.status
    const status = r.status === 'cancelled' ? 'cancelled' : (RANK[r.status] ?? 0) > (RANK[cur] ?? 0) || cur === 'cancelled' ? r.status : cur
    stmts.push(`update public.orders set status = ${lit(status)}::public.order_status,
      order_date = coalesce(${D(r.orderDate)}, order_date), placed_by = coalesce(${lit(r.placedBy)}, placed_by), store_codes = case when cardinality(${textArray(r.stores)}) > 0 then ${textArray(r.stores)} else store_codes end,
      billing_route = coalesce(${r.route ? lit(r.route) + '::public.billing_route' : 'null'}, billing_route), description = coalesce(${lit(r.description)}, description),
      est_ship_date = coalesce(${D(r.estShip)}, est_ship_date), est_cost = coalesce(${N(r.estCost)}, est_cost), freight_cost = coalesce(${N(r.freight)}, freight_cost), freight_notes = coalesce(${lit(r.freightNotes)}, freight_notes),
      date_received = coalesce(${D(r.received)}, date_received), po_number = coalesce(${lit(r.po)}, po_number), ar_due = coalesce(${lit(r.arDue)}, ar_due), ar_due_date = coalesce(${D(r.arDueDate)}, ar_due_date),
      date_entered_ls = coalesce(${D(r.enteredLs)}, date_entered_ls), entered_by = coalesce(${lit(r.enteredBy)}, entered_by), backorder = backorder or ${r.backorder},
      shipment_notes = coalesce(${lit(r.shipNotes)}, shipment_notes), credits_due = ${r.creditsDue} or (credits_due and ${r.creditsDue ? 'true' : 'date_credits_received is null'}), credit_notes = coalesce(${lit(r.creditNotes)}, credit_notes),
      date_credits_received = coalesce(${D(r.creditsReceived)}, date_credits_received), ok_to_pay = ok_to_pay or ${r.okToPay}, notes = coalesce(${lit(r.notes)}, notes), final_cost = coalesce(${N(r.finalCost)}, final_cost),
      paid_date = coalesce(paid_date, ${D(r.paidDate)}), paid_via = coalesce(paid_via, ${lit(r.paidVia)}),
      extra = coalesce(extra, '{}'::jsonb) || ${lit(JSON.stringify({ ...r.extra, 'Placed Order Summary tab': r.sheet }))}::jsonb${allowanceSet}
      where id = ${lit(r.match.id)}::uuid`)
    updated++
  } else {
    stmts.push(`insert into public.orders (organization_id, vendor_id, status, order_date, show_code, show_inferred, placed_by, store_codes, billing_route, description, est_ship_date, est_cost, freight_cost, freight_notes, date_received, po_number, ar_due, ar_due_date, date_entered_ls, entered_by, backorder, shipment_notes, credits_due, credit_notes, date_credits_received, ok_to_pay, notes, final_cost, paid_date, paid_via, source, source_key, source_sheet, extra, freight_allowance_offered, freight_allowance, freight_allowance_pay_by)
      values (${lit(ORG)}, ${lit(r.vendorId)}::uuid, ${lit(r.status)}::public.order_status, ${D(r.orderDate)}, ${lit(r.show?.code || null)}, ${!!r.show}, ${lit(r.placedBy)}, ${textArray(r.stores)}, ${r.route ? lit(r.route) + '::public.billing_route' : 'null'}, ${lit(r.description)}, ${D(r.estShip)}, ${N(r.estCost)}, ${N(r.freight)}, ${lit(r.freightNotes)}, ${D(r.received)}, ${lit(r.po)}, ${lit(r.arDue)}, ${D(r.arDueDate)}, ${D(r.enteredLs)}, ${lit(r.enteredBy)}, ${r.backorder}, ${lit(r.shipNotes)}, ${r.creditsDue}, ${lit(r.creditNotes)}, ${D(r.creditsReceived)}, ${r.okToPay}, ${lit(r.notes)}, ${N(r.finalCost)}, ${D(r.paidDate)}, ${lit(r.paidVia)}, 'placed_order_summary', ${lit(r.key)}, ${lit(r.sheet)}, ${lit(JSON.stringify(r.extra))}::jsonb, ${r.allowance}, ${r.allowance ? N(r.allowanceAmount) : 'null'}, ${r.allowance ? D(r.arDueDate) : 'null'})
      on conflict (organization_id, source_key) where source_key is not null do update set status = excluded.status, paid_date = coalesce(orders.paid_date, excluded.paid_date), shipment_notes = coalesce(excluded.shipment_notes, orders.shipment_notes), notes = coalesce(excluded.notes, orders.notes)`)
    inserted++
  }
}
// a field someone changed in VMS keeps its VMS value (orders.edited_fields, Dana Oct 10)
for (let i = 0; i < stmts.length; i += 40) await query(["select set_config('vms.import', 'on', true)", ...stmts.slice(i, i + 40)].join(';\n'))
// the allowance flag on a vendor whose notes say so, so new orders remind whoever pays
await query(`update public.vendors v set freight_allowance_on_time = true where v.organization_id = ${lit(ORG)} and not v.freight_allowance_on_time
  and exists (select 1 from public.orders o where o.vendor_id = v.id and o.freight_allowance_offered)`)
await query(`insert into public.activity_log (organization_id, entity_type, action, details) values (${lit(ORG)}, 'order', 'import', ${lit(JSON.stringify({ source: 'placed_order_summary', file: args.file.split('/').pop(), updated, inserted, vendors_created: toCreate.size }))}::jsonb)`)
console.log(`orders updated ${updated}, added ${inserted}, vendors created ${toCreate.size}`)
