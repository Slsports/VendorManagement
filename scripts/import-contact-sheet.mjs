#!/usr/bin/env node
/**
 * Gap-fill vendors from one of Dana's contact spreadsheets (e.g. FISHING_VENDOR_CONTACT_LIST.xlsx).
 *
 *   node scripts/import-contact-sheet.mjs --file sheet.xlsx --dry
 *   node scripts/import-contact-sheet.mjs --file sheet.xlsx
 *
 * Recognised columns (case-insensitive, any order): Vendor, Type of products, Min order,
 * Freight programs, Rep group, Rep name, Phone, Email, Notes, Notes 2.
 * Rules: match the vendor by name/alias (exact, then fuzzy, then prefix); a parenthetical
 * such as "Rapala (Luhr Jensen)" that names an existing vendor makes the sheet name an alias
 * of that vendor; unmatched vendors are created and flagged for review. Existing values are
 * never overwritten: only empty fields are filled, notes are appended, emails become rep
 * contacts, rep groups are created as needed.
 */
import XLSX from 'xlsx'
import { query, lit, textArray } from './db.mjs'

const args = parseArgs(process.argv.slice(2))
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
if (!args.file) die('--file is required')

const wb = XLSX.readFile(args.file)
const ws = wb.Sheets[args.sheet || wb.SheetNames[0]]
const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
const hdrIdx = grid.findIndex((r) => r.filter((v) => String(v).trim()).length >= 3)
const header = grid[hdrIdx].map((h) => String(h).trim().toLowerCase())
const colOf = (...names) => header.findIndex((h) => names.includes(h))
const C = {
  vendor: colOf('vendor', 'vendor name', 'name'),
  products: colOf('type of products', 'products', 'product types'),
  min: colOf('min order', 'minimum order', 'minimum'),
  freight: colOf('freight programs', 'freight program', 'freight'),
  repGroup: colOf('rep group'),
  repName: colOf('rep name', 'rep', 'contact'),
  phone: colOf('phone', 'rep phone'),
  email: colOf('email', 'rep email', 'e-mail'),
  notes: colOf('notes'),
  notes2: colOf('notes 2', 'notes2'),
}
if (C.vendor === -1) die(`No Vendor column. Header: ${header.join(' | ')}`)
const cell = (r, i) => (i >= 0 && r[i] !== undefined ? String(r[i]).replace(/ /g, ' ').trim() : '')
const rows = grid.slice(hdrIdx + 1).filter((r) => cell(r, C.vendor))

const live = await query(`select id, name, lightspeed_name, aliases, rep_name, rep_phone, rep_group_id, minimum_order, freight_program, product_types, notes from public.vendors where organization_id = ${lit(ORG)} and is_active`)
const key = (s) => s.toUpperCase().replace(/\b(INC|LLC|CO|CORP|CORPORATION|COMPANY|LTD|USA|THE)\b/g, '').replace(/[^A-Z0-9]/g, '')
const index = new Map()
for (const v of live) for (const n of [v.name, v.lightspeed_name, ...(v.aliases || [])]) if (n && !index.has(key(n))) index.set(key(n), v)
function match(name) {
  const k = key(name)
  if (!k) return null
  if (index.has(k)) return { v: index.get(k), how: 'exact' }
  let best = { score: 0, k: null }
  for (const ik of index.keys()) { const s = dice(k, ik); if (s > best.score) best = { score: s, k: ik } }
  if (best.score >= 0.85) return { v: index.get(best.k), how: `fuzzy ${Math.round(best.score * 100)}%` }
  if (k.length >= 5) {
    const pref = [...index.keys()].filter((ik) => ik.startsWith(k) || k.startsWith(ik))
    if (pref.length === 1) return { v: index.get(pref[0]), how: 'prefix' }
  }
  return null
}

const plan = []
for (const r of rows) {
  const raw = cell(r, C.vendor)
  const m = raw.match(/^(.*?)\s*\((.*)\)\s*$/)
  const base = (m ? m[1] : raw).trim()
  const paren = m ? m[2].trim() : ''
  let hit = match(base)
  let alias = null
  if (!hit && paren) {
    const inner = match(paren.split(/[-,;]| has | is /)[0].trim())
    if (inner) { hit = inner; alias = base; hit.how = `via "(${paren})"` }
  }
  const emails = cell(r, C.email).split(/[;,/\s]+/).map((e) => e.trim()).filter((e) => e.includes('@'))
  const noteBits = [cell(r, C.notes), cell(r, C.notes2), paren && !alias ? paren : ''].filter(Boolean)
  plan.push({
    raw, base, hit: hit?.v ?? null, how: hit?.how ?? null, alias,
    products: cell(r, C.products), min: cell(r, C.min), freight: cell(r, C.freight),
    repGroup: cell(r, C.repGroup), repName: cell(r, C.repName), phone: cell(r, C.phone), emails, notes: noteBits.join('. '),
  })
}

console.log(`${'SHEET VENDOR'.padEnd(42)} ${'MATCHED TO'.padEnd(32)} how`)
for (const p of plan) console.log(`${p.raw.slice(0, 42).padEnd(42)} ${(p.hit ? p.hit.name : '(create new, flagged)').slice(0, 32).padEnd(32)} ${p.how ?? ''}${p.alias ? ` alias +${p.alias}` : ''}`)
console.log(`\nmatched ${plan.filter((p) => p.hit).length}, new ${plan.filter((p) => !p.hit).length}, emails ${plan.reduce((n, p) => n + p.emails.length, 0)}, rep groups ${new Set(plan.map((p) => p.repGroup).filter(Boolean)).size}`)
if (dry) { console.log('Dry run only. Nothing written.'); process.exit(0) }

// rep groups
const groupIds = new Map()
const existingGroups = await query(`select id, name from public.rep_groups where organization_id = ${lit(ORG)}`)
for (const g of existingGroups) groupIds.set(g.name.toLowerCase(), g.id)
for (const name of new Set(plan.map((p) => p.repGroup).filter(Boolean))) {
  if (groupIds.has(name.toLowerCase())) continue
  const [row] = await query(`insert into public.rep_groups (organization_id, name) values (${lit(ORG)}, ${lit(name)}) returning id`)
  groupIds.set(name.toLowerCase(), row.id)
}

let created = 0, updated = 0, contacts = 0
for (const p of plan) {
  let vendorId = p.hit?.id
  if (!vendorId) {
    const [row] = await query(`insert into public.vendors (organization_id, name, needs_review, review_note, aliases) values (${lit(ORG)}, ${lit(p.base)}, true, ${lit(`Created from contact sheet ${args.file.split('/').pop()}; not found in Lightspeed. Confirm the name or merge.`)}, ${textArray(p.raw !== p.base ? [p.raw] : [])}) on conflict do nothing returning id`)
    if (!row) continue
    vendorId = row.id; created++
  }
  const sets = []
  const v = p.hit ?? {}
  if (p.repName && !v.rep_name) sets.push(`rep_name = ${lit(p.repName)}`)
  if (p.phone && !v.rep_phone) sets.push(`rep_phone = ${lit(p.phone)}`)
  if (p.min && !v.minimum_order) sets.push(`minimum_order = ${lit(p.min)}`)
  if (p.freight && !v.freight_program) sets.push(`freight_program = ${lit(p.freight)}`)
  if (p.products && !v.product_types) sets.push(`product_types = ${lit(p.products)}`)
  if (p.repGroup && !v.rep_group_id) sets.push(`rep_group_id = ${lit(groupIds.get(p.repGroup.toLowerCase()))}`)
  if (p.notes && !(v.notes || '').includes(p.notes)) sets.push(`notes = coalesce(notes || E'\\n', '') || ${lit(p.notes)}`)
  if (p.alias) sets.push(`aliases = (select array(select distinct unnest(aliases || ${textArray([p.alias])})))`)
  else if (p.hit && key(p.base) !== key(p.hit.name) && !(p.hit.aliases || []).some((a) => key(a) === key(p.base))) sets.push(`aliases = (select array(select distinct unnest(aliases || ${textArray([p.base])})))`)
  if (sets.length) { await query(`update public.vendors set ${sets.join(', ')} where id = ${lit(vendorId)}`); updated++ }
  for (const email of p.emails) {
    const res = await query(`insert into public.vendor_emails (vendor_id, email, contact_name, phone, contact_type, source) values (${lit(vendorId)}, ${lit(email.toLowerCase())}, ${lit(p.repName || null)}, ${lit(p.phone || null)}, 'rep', 'import') on conflict do nothing returning id`)
    if (res.length) contacts++
  }
}
await query(`insert into public.activity_log (organization_id, entity_type, action, details) values (${lit(ORG)}, 'vendor', 'import', ${lit(JSON.stringify({ source: 'contact_sheet', file: args.file.split('/').pop(), rows: plan.length, created, updated, contacts }))}::jsonb)`)
console.log(`done. created ${created}, updated ${updated}, contacts added ${contacts}`)

function dice(a, b) {
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1) } return m }
  const A = bg(a), B = bg(b); let inter = 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0)
  return a.length < 2 || b.length < 2 ? 0 : (2 * inter) / (a.length - 1 + b.length - 1)
}
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2), n = argv[i + 1]; if (n === undefined || n.startsWith('--')) o[k] = true; else { o[k] = n; i++ } } return o }
function die(m) { console.error(m); process.exit(1) }
