#!/usr/bin/env node
/**
 * Import Dana's Placed Order Summary as exported into the "Summer WWD Order Guide" workbook
 * (buyer tabs Trevor / Jarrett / Dana, Summer/Winter Condensed, Fishing, the NOT WWD tabs,
 * Report Assignments). Re-runnable: orders are keyed by vendor + date + description + cost + store,
 * so a fresh copy of the living sheet updates in place.
 *
 *   node scripts/import-order-guide.mjs --file guide.xlsx [--match-hints "Sheet name=VMS vendor;..."] [--dry]
 *
 * Rules (Dana, 2026-10-06):
 *   - a sheet vendor that matches a VMS vendor links to it; the sheet spelling is kept as an alias
 *   - one we bought from but have no record for is CREATED (flagged to check for a duplicate)
 *   - Category -> categories; "Report Assigned To" -> vendors.report_owner; Do Not Order / Out of Biz
 *     -> do_not_order with the reason; Do Not Need -> a note
 *   - Source Tab 1-Open/2-Entered/3-Paid -> status; both paid-date columns -> paid_date + paid_via
 *   - show tag inferred for WWD orders near a show (decisions log 2026-10-06)
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

// ---------- read every tab ----------
const wb = XLSX.readFile(args.file)
const orders = new Map()        // source_key -> row
const vendorMeta = new Map()    // sheet vendor name -> { category, assigned, wwd }
const assignments = new Map()   // from the Report Assignments tab
for (const sheetName of wb.SheetNames) {
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false })
  const hi = grid.findIndex((r) => r.includes('Vendor'))
  if (hi < 0) continue
  const h = grid[hi].map(String)
  if (/report assignments/i.test(sheetName)) {
    for (const r of grid.slice(hi + 1)) if (r[0] && r[1]) assignments.set(String(r[0]).trim(), String(r[1]).trim())
    continue
  }
  for (const r of grid.slice(hi + 1)) {
    const o = {}
    h.forEach((k, i) => { if (k) o[k] = String(r[i] ?? '').replace(/ /g, ' ').trim() })
    const vendor = o['Vendor']
    if (!vendor) continue
    const isHeader = /\d+ orders?$/i.test(o['Date Ordered'] || '') || /\d+ orders?$/i.test(String(r[0] || '')) || /^Avg/.test(o['What was ordered?'] || '')
    if (isHeader) {
      const m = vendorMeta.get(vendor) || {}
      if (o['Category']) m.category = o['Category']
      if (o['Report Assigned To']) m.assigned = o['Report Assigned To']
      if (o['WWD? (Y or N)']) m.wwd = o['WWD? (Y or N)']
      vendorMeta.set(vendor, m)
      continue
    }
    const key = createHash('sha1').update([vendor, o['Date Ordered'], o['What was ordered?'], o['Est Cost'], o['Store']].map((x) => (x || '').toLowerCase().replace(/\s+/g, ' ')).join('|')).digest('hex').slice(0, 24)
    if (!orders.has(key)) orders.set(key, { ...o, sheet: sheetName, key })
    else if (!/condensed|not wwd/i.test(sheetName)) orders.get(key).sheet = sheetName   // prefer the buyer tab as the source sheet
  }
}
console.log(`tabs ${wb.SheetNames.length} | distinct orders ${orders.size} | vendors on the sheet ${vendorMeta.size} | report assignments ${assignments.size}`)

// ---------- helpers ----------
const STATUS = { '1-open': 'open', '2-entered': 'entered', '3-paid': 'paid', '4-cancelled': 'cancelled', 'cancelled': 'cancelled' }

// ---------- vendors ----------
const live = await query(`select v.id, v.name, v.lightspeed_name, v.aliases, v.do_not_order, v.report_owner, (select array_agg(route::text) from public.vendor_billing_routes b where b.vendor_id = v.id) as routes from public.vendors v where organization_id = ${lit(ORG)} and is_active`)
const index = buildIndex(live)
const byName = new Map(live.map((v) => [v.name.toLowerCase(), v]))
const hints = new Map(String(args['match-hints'] || '').split(';').filter(Boolean).map((h) => h.split('=').map((x) => x.trim().toLowerCase())))
const sheetNames = [...new Set([...[...orders.values()].map((o) => o['Vendor']), ...vendorMeta.keys(), ...assignments.keys()])]
const resolved = new Map()      // sheet name -> { vendor (live row or {new:true,name}), how }
const toCreate = new Map()      // clean key -> { name, sheetNames[] }
for (const n of sheetNames) {
  const hinted = hints.get(n.toLowerCase())
  if (hinted) { const v = byName.get(hinted); if (!v) die(`--match-hints: no vendor named "${hinted}"`); resolved.set(n, { vendor: v, how: 'hint' }); continue }
  const hit = findVendor(index, n) || findVendor(index, cleanName(n))
  if (hit) { resolved.set(n, hit); continue }
  const ck = nameKey(cleanName(n)) || nameKey(n)
  const c = toCreate.get(ck) || { name: cleanName(n) || n, sheetNames: [] }
  c.sheetNames.push(n)
  toCreate.set(ck, c)
  resolved.set(n, { vendor: { new: true, key: ck }, how: 'new' })
}
const matchedCount = sheetNames.length - [...resolved.values()].filter((r) => r.how === 'new').length
console.log(`sheet vendors ${sheetNames.length} | linked to VMS ${matchedCount} | to create ${toCreate.size}`)
if (toCreate.size) console.log('  create: ' + [...toCreate.values()].map((c) => c.name).join(' | '))
const nonExact = [...resolved.entries()].filter(([, r]) => r.how !== 'exact' && r.how !== 'new' && r.how !== 'hint')
if (nonExact.length) console.log('  non-exact links: ' + nonExact.map(([n, r]) => `${n} => ${r.vendor.name}`).join(' | '))

// categories / owners / flags per vendor
const owners = {}, flags = []
for (const n of sheetNames) {
  const meta = vendorMeta.get(n) || {}
  const a = (assignments.get(n) || meta.assigned || '').trim()
  if (!a) continue
  if (/^(trevor|jarrett|dana)$/i.test(a)) owners[n] = a[0].toUpperCase() + a.slice(1).toLowerCase()
  else if (/^dana\b/i.test(a)) { owners[n] = 'Dana'; if (a.length > 4) flags.push({ n, note: a }) }
  else if (/do not order|don't order|out of biz|do not order from them/i.test(a)) flags.push({ n, dno: a })
  else if (/do not need|don't need|not ordering/i.test(a)) flags.push({ n, note: `Not needed per order guide: ${a}` })
  else flags.push({ n, note: a })
}
console.log(`owners: Trevor ${Object.values(owners).filter((o) => o === 'Trevor').length}, Jarrett ${Object.values(owners).filter((o) => o === 'Jarrett').length}, Dana ${Object.values(owners).filter((o) => o === 'Dana').length} | do-not-order ${flags.filter((f) => f.dno).length} | notes ${flags.filter((f) => f.note).length}`)

// status / dates summary
const rows = [...orders.values()].map((o) => {
  const route = yn(o['WWD? (Y or N)']) ? 'worldwide' : /^n/i.test(o['WWD? (Y or N)'] || '') ? 'direct' : null
  const orderDate = toDate(o['Date Ordered']) || toDate(o['Date Order Placed'])
  const show = showFor(orderDate, route === 'worldwide')
  const paidDana = toDate(o['Date Paid (Dana)']), paidWwd = toDate(o['Paid Date (WWD)'])
  const status = STATUS[(o['Source Tab'] || '').toLowerCase()] || (paidDana || paidWwd ? 'paid' : 'open')
  const freight = toMoney(o['Freight Cost'])
  return {
    key: o.key, sheetVendor: o['Vendor'], sheet: o.sheet, status, orderDate,
    season: /summer/i.test(o['Season']) ? 'summer' : /winter/i.test(o['Season']) ? 'winter' : null,
    show, placedBy: o['Who Placed Order'] || null, stores: stores(o['Store']), route,
    description: o['What was ordered?'] || null, estShip: toDate(o['Est Ship Date']), estCost: toMoney(o['Est Cost']),
    freight, freightNotes: freight === null && o['Freight Cost'] ? o['Freight Cost'] : (/[a-z@]/i.test(o['Freight Cost'] || '') ? o['Freight Cost'] : null),
    received: toDate(o['Date Received']), po: o['PO'] || null, arDue: o['AR Due Date'] || null, arDueDate: toDate(o['AR Due Date']),
    enteredLs: toDate(o['Date Entered to LS']), enteredBy: o['Who Entered Order?'] || null, backorder: yn(o['BO? Y or N']), shipNotes: o['Shipment Notes'] || null,
    creditsDue: yn(o['Credits Due? Y or N']), creditNotes: o['Credit Notes'] || null, creditsReceived: toDate(o['Date Credits Received']), okToPay: yn(o['Ok to Pay? Y or N']),
    notes: o["Dana's Notes"] || null, finalCost: toMoney(o['Final Cost (Dana)']),
    paidDate: paidDana || paidWwd, paidVia: paidDana ? 'billcom' : paidWwd ? 'wwd' : null, paidRef: o['Paid (WWD)'] || null, costBasis: toMoney(o['Cost Basis']),
    extra: Object.fromEntries(Object.entries({ 'LS Report Date': o['LS Report Date'], 'Order (Y or N)': o['Order (Y or N)'], 'Date Order Placed': o['Date Order Placed'], 'Unlabeled Col X': o['Unlabeled Col X'],
      ...Object.fromEntries(['Date Ordered', 'Est Ship Date', 'Date Received', 'Date Entered to LS', 'Date Credits Received', 'Date Paid (Dana)', 'Paid Date (WWD)'].filter((c) => o[c] && !toDate(o[c])).map((c) => [`${c} (as typed)`, o[c]])) }).filter(([, v]) => v)),
  }
})
const tally = (f) => Object.entries(rows.reduce((m, r) => { const k = String(r[f] ?? '(none)'); m[k] = (m[k] || 0) + 1; return m }, {})).map(([k, v]) => `${k} ${v}`).join(', ')
console.log(`status: ${tally('status')} | season: ${tally('season')} | with show tag ${rows.filter((r) => r.show).length} (firm ${rows.filter((r) => r.show?.firm).length}) | no order date ${rows.filter((r) => !r.orderDate).length}`)
if (dry) { console.log('\nDry run only. Nothing written.'); process.exit(0) }

// ---------- write: vendors ----------
if (toCreate.size) {
  const vals = [...toCreate.values()].map((c) => `(${lit(ORG)}, ${lit(c.name)}, ${textArray(c.sheetNames.filter((s) => s !== c.name))}, true, 'Created from the order guide (we have ordered from them). Check it is not a duplicate of an existing vendor.')`)
  await query(`insert into public.vendors (organization_id, name, aliases, needs_review, review_note) values ${vals.join(',\n')} on conflict do nothing`)
}
// a created vendor that is already a line (rep list / show list) gets linked so its catalog and shows show up
await query(`update public.vendor_directory d set matched_vendor_id = v.id from public.vendors v
  where d.organization_id = ${lit(ORG)} and d.matched_vendor_id is null and v.organization_id = d.organization_id and v.is_active
    and lower(regexp_replace(v.name, '[^a-z0-9]+', '', 'gi')) = d.name_key`)
const live2 = await query(`select id, name, aliases, do_not_order, notes from public.vendors where organization_id = ${lit(ORG)} and is_active`)
const idByName = new Map(live2.map((v) => [v.name.toLowerCase(), v]))
const vendorIdFor = (sheetName) => { const r = resolved.get(sheetName); if (!r) return null; if (r.vendor.new) { const c = toCreate.get(r.vendor.key); return idByName.get(c.name.toLowerCase())?.id ?? null } return r.vendor.id }

// aliases for sheet spellings + owners + flags + categories, batched per vendor
const cats = await query(`select id, lower(name) as n from public.categories where organization_id = ${lit(ORG)}`)
const catId = new Map(cats.map((c) => [c.n, c.id]))
const newCats = [...new Set([...vendorMeta.values()].map((m) => m.category).filter(Boolean).filter((c) => !catId.has(c.toLowerCase())))]
if (newCats.length) {
  const r = await query(`insert into public.categories (organization_id, name) values ${newCats.map((c) => `(${lit(ORG)}, ${lit(c)})`).join(',')} on conflict do nothing returning id, lower(name) as n`)
  for (const c of r) catId.set(c.n, c.id)
}
const stmts = []
for (const n of sheetNames) {
  const vid = vendorIdFor(n); if (!vid) continue
  const V = lit(vid) + '::uuid'
  const v = live2.find((x) => x.id === vid)
  if (v && v.name.toLowerCase() !== n.toLowerCase() && !(v.aliases || []).some((a) => a.toLowerCase() === n.toLowerCase())) stmts.push(`update public.vendors set aliases = array_append(aliases, ${lit(n)}) where id = ${V} and not (${lit(n)} = any(aliases))`)
  if (owners[n]) stmts.push(`update public.vendors set report_owner = coalesce(report_owner, ${lit(owners[n])}) where id = ${V}`)
  const meta = vendorMeta.get(n)
  if (meta?.category && catId.get(meta.category.toLowerCase())) stmts.push(`insert into public.vendor_categories (vendor_id, category_id) values (${V}, ${lit(catId.get(meta.category.toLowerCase()))}::uuid) on conflict do nothing`)
  for (const f of flags.filter((f) => f.n === n)) {
    if (f.dno && !v?.do_not_order) stmts.push(`update public.vendors set do_not_order = true, do_not_order_reason = coalesce(do_not_order_reason, ${lit(`${f.dno} (order guide)`)}) where id = ${V}`)
    if (f.note) stmts.push(`update public.vendors set notes = case when notes is null then ${lit(f.note)} when position(${lit(f.note)} in notes) > 0 then notes else notes || E'\\n' || ${lit(f.note)} end where id = ${V}`)
  }
}
for (let i = 0; i < stmts.length; i += 60) await query(stmts.slice(i, i + 60).join(';\n'))
console.log(`vendors created ${toCreate.size}, categories added ${newCats.length}, vendor updates ${stmts.length}`)

// ---------- write: orders (upsert by source key) ----------
const cols = 'organization_id, vendor_id, status, order_date, season, show_code, show_inferred, placed_by, store_codes, billing_route, description, est_ship_date, est_cost, freight_cost, freight_notes, date_received, po_number, ar_due, ar_due_date, date_entered_ls, entered_by, backorder, shipment_notes, credits_due, credit_notes, date_credits_received, ok_to_pay, notes, final_cost, paid_date, paid_via, paid_ref, cost_basis, source, source_key, source_sheet, extra'
const D = (d) => (d ? lit(d) + '::date' : 'null')
const N = (n) => (n === null || n === undefined ? 'null' : String(n))
let skipped = 0
const vals = rows.map((r) => {
  const vid = vendorIdFor(r.sheetVendor); if (!vid) { skipped++; return null }
  return `(${lit(ORG)}, ${lit(vid)}::uuid, ${lit(r.status)}::public.order_status, ${D(r.orderDate)}, ${r.season ? lit(r.season) + '::public.order_season' : 'null'}, ${lit(r.show?.code || null)}, ${!!r.show}, ${lit(r.placedBy)}, ${textArray(r.stores)}, ${r.route ? lit(r.route) + '::public.billing_route' : 'null'}, ${lit(r.description)}, ${D(r.estShip)}, ${N(r.estCost)}, ${N(r.freight)}, ${lit(r.freightNotes)}, ${D(r.received)}, ${lit(r.po)}, ${lit(r.arDue)}, ${D(r.arDueDate)}, ${D(r.enteredLs)}, ${lit(r.enteredBy)}, ${r.backorder}, ${lit(r.shipNotes)}, ${r.creditsDue}, ${lit(r.creditNotes)}, ${D(r.creditsReceived)}, ${r.okToPay}, ${lit(r.notes)}, ${N(r.finalCost)}, ${D(r.paidDate)}, ${lit(r.paidVia)}, ${lit(r.paidRef)}, ${N(r.costBasis)}, 'order_guide', ${lit(r.key)}, ${lit(r.sheet)}, ${lit(JSON.stringify(r.extra))}::jsonb)`
}).filter(Boolean)
const updates = cols.split(', ').filter((c) => !['organization_id', 'source', 'source_key'].includes(c)).map((c) => `${c} = excluded.${c}`).join(', ')
for (let i = 0; i < vals.length; i += 100) {
  await query(`insert into public.orders (${cols}) values ${vals.slice(i, i + 100).join(',\n')} on conflict (organization_id, source_key) where source_key is not null do update set ${updates}`)
}
await query(`insert into public.activity_log (organization_id, entity_type, action, details) values (${lit(ORG)}, 'order', 'import', ${lit(JSON.stringify({ source: 'order_guide', file: args.file.split('/').pop(), orders: vals.length, vendors_created: toCreate.size }))}::jsonb)`)
console.log(`orders written ${vals.length}${skipped ? ` (skipped ${skipped} without a vendor)` : ''}`)
