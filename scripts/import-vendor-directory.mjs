#!/usr/bin/env node
/**
 * Load a reference vendor list (e.g. the Worldwide show vendor list) into public.vendor_directory.
 * These rows are NOT vendors. They answer "is this a known WWD / Faire vendor?" when a new vendor
 * is created from the mailbox or the intake form, and they confirm the route on vendors we already have.
 *
 *   node scripts/import-vendor-directory.mjs --file show-list.xlsx --source wwd_show_2026_08 --label "Worldwide show, Aug 2026" --dry
 *   node scripts/import-vendor-directory.mjs --file show-list.xlsx --source wwd_show_2026_08 --label "Worldwide show, Aug 2026"
 *
 * Options: --route worldwide|faire|direct (default worldwide), --sheet <name>, --org <uuid>,
 *          --apply-routes (also add the route to matching vendors that have no route yet).
 * Columns are found by header name (case-insensitive): a name column (vendor, vendor name, company,
 * exhibitor, supplier, name), and optionally email, website, phone, rep/contact, booth. Every other
 * column is kept in `data` so nothing from the sheet is lost.
 */
import XLSX from 'xlsx'
import { query, lit } from './db.mjs'

const args = parseArgs(process.argv.slice(2))
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
const ROUTE = args.route || 'worldwide'
if (!args.file) die('--file is required')
if (!args.source) die('--source is required (e.g. wwd_show_2026_08)')
if (!['worldwide', 'faire', 'direct'].includes(ROUTE)) die('--route must be worldwide, faire or direct')

const wb = XLSX.readFile(args.file)
const ws = wb.Sheets[args.sheet || wb.SheetNames[0]]
const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
const hdrIdx = grid.findIndex((r) => r.filter((v) => String(v).trim()).length >= 2)
if (hdrIdx === -1) die('Sheet looks empty')
const headerRaw = grid[hdrIdx].map((h) => String(h).trim())
const header = headerRaw.map((h) => h.toLowerCase())
const colOf = (...names) => header.findIndex((h) => names.includes(h))
const C = {
  name: colOf('vendor', 'vendor name', 'company', 'company name', 'exhibitor', 'supplier', 'name', 'brand'),
  email: colOf('email', 'e-mail', 'rep email', 'contact email'),
  website: colOf('website', 'web', 'url'),
  phone: colOf('phone', 'telephone', 'rep phone'),
  rep: colOf('rep', 'rep name', 'contact', 'contact name', 'sales rep'),
  booth: colOf('booth', 'booth #', 'booth number', 'table'),
}
if (C.name === -1) die(`No vendor name column. Header: ${headerRaw.join(' | ')}`)
const cell = (r, i) => (i >= 0 && r[i] !== undefined ? String(r[i]).replace(/ /g, ' ').trim() : '')
const rows = grid.slice(hdrIdx + 1).filter((r) => cell(r, C.name))
const nameKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '')
const domainOf = (email, website) => {
  const m = (email || '').match(/@([^\s>]+)$/)
  if (m) return m[1].toLowerCase()
  const w = (website || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/\s]/)[0].toLowerCase()
  return w.includes('.') ? w : null
}
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com', 'msn.com'])

const entries = new Map()
for (const r of rows) {
  const name = cell(r, C.name).replace(/\s{2,}/g, ' ')
  const k = nameKey(name)
  if (!k || entries.has(k)) continue
  const email = cell(r, C.email).toLowerCase() || null
  const website = cell(r, C.website) || null
  let domain = domainOf(email, website)
  if (domain && FREE_MAIL.has(domain)) domain = null
  const data = {}
  headerRaw.forEach((h, i) => { if (h && ![C.name, C.email, C.website, C.phone, C.rep, C.booth].includes(i) && cell(r, i)) data[h] = cell(r, i) })
  entries.set(k, { name, email, website, phone: cell(r, C.phone) || null, rep: cell(r, C.rep) || null, booth: cell(r, C.booth) || null, domain, data })
}
console.log(`rows ${rows.length} | distinct names ${entries.size} | route ${ROUTE} | source ${args.source}`)

// Match to vendors we already have (name, LS name, alias; then prefix either way).
const live = await query(`select id, name, lightspeed_name, aliases, (select array_agg(route::text) from public.vendor_billing_routes b where b.vendor_id = v.id) as routes from public.vendors v where organization_id = ${lit(ORG)} and is_active`)
const STOP = /\b(inc|llc|co|corp|corporation|company|ltd|usa|the|intl|international)\b/g
const mkey = (s) => s.toLowerCase().replace(STOP, '').replace(/[^a-z0-9]/g, '')
const index = new Map()
for (const v of live) for (const n of [v.name, v.lightspeed_name, ...(v.aliases || [])]) { const k = n && mkey(n); if (k && !index.has(k)) index.set(k, v) }
let matched = 0, conflicts = [], noRoute = []
for (const e of entries.values()) {
  const k = mkey(e.name)
  let v = index.get(k) || null
  if (!v && k.length >= 5) {
    const pref = [...index.keys()].filter((ik) => ik.startsWith(k) || k.startsWith(ik))
    if (pref.length === 1) v = index.get(pref[0])
  }
  if (!v) continue
  e.vendorId = v.id; e.vendorName = v.name; matched++
  const routes = v.routes || []
  if (routes.length === 0) noRoute.push(v)
  else if (!routes.includes(ROUTE)) conflicts.push({ v, routes })
}
console.log(`matched existing vendors ${matched} | of those with no route yet ${noRoute.length} | tagged differently in VMS ${conflicts.length}`)
if (conflicts.length) {
  console.log('\nIn this list but tagged differently in VMS (left alone; check these):')
  for (const c of conflicts) console.log(`  ${c.v.name}  (VMS: ${c.routes.join(', ')})`)
}
if (dry) {
  console.log('\nSample:')
  for (const e of [...entries.values()].slice(0, 15)) console.log(`  ${e.name}${e.domain ? ` <${e.domain}>` : ''}${e.vendorName ? `  => ${e.vendorName}` : ''}`)
  console.log('\nDry run only. Nothing written.')
  process.exit(0)
}

const vals = [...entries.values()].map((e) => `(${lit(ORG)}::uuid, ${lit(args.source)}, ${lit(args.label || null)}, ${lit(e.name)}, ${lit(ROUTE)}::public.billing_route, ${lit(e.domain)}, ${lit(e.email)}, ${lit(e.website)}, ${lit(e.phone)}, ${lit(e.rep)}, ${lit(e.booth)}, ${lit(JSON.stringify(e.data))}::jsonb, ${e.vendorId ? lit(e.vendorId) + '::uuid' : 'null'})`)
let written = 0
for (let i = 0; i < vals.length; i += 200) {
  await query(`insert into public.vendor_directory (organization_id, source, source_label, name, route, email_domain, email, website, phone, rep_name, booth, data, matched_vendor_id)
    values ${vals.slice(i, i + 200).join(',\n')}
    on conflict (organization_id, source, name_key) do update set source_label = excluded.source_label, route = excluded.route, email_domain = excluded.email_domain, email = excluded.email,
      website = excluded.website, phone = excluded.phone, rep_name = excluded.rep_name, booth = excluded.booth, data = excluded.data, matched_vendor_id = coalesce(excluded.matched_vendor_id, public.vendor_directory.matched_vendor_id)`)
  written += Math.min(200, vals.length - i)
}
console.log(`directory rows written: ${written}`)

if (args['apply-routes'] && noRoute.length) {
  const ids = noRoute.map((v) => lit(v.id) + '::uuid').join(',')
  await query(`insert into public.vendor_billing_routes (vendor_id, route, is_default) select id, ${lit(ROUTE)}::public.billing_route, true from public.vendors where id in (${ids}) on conflict do nothing`)
  await query(`insert into public.activity_log (organization_id, entity_type, entity_id, action, details) select ${lit(ORG)}, 'vendor', id, 'route_from_directory', ${lit(JSON.stringify({ source: args.source, route: ROUTE }))}::jsonb from public.vendors where id in (${ids})`)
  console.log(`route ${ROUTE} added to ${noRoute.length} vendors that had none`)
} else if (noRoute.length) {
  console.log(`\n${noRoute.length} matching vendors have no route yet. Re-run with --apply-routes to tag them ${ROUTE}.`)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}
function die(msg) { console.error(msg); process.exit(1) }
