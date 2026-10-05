#!/usr/bin/env node
/**
 * Import the Lightspeed vendor export (Inventory → Vendors → Export) into the VMS.
 *
 *   node scripts/import-ls-vendors.mjs --file path/to/export.csv --dry   # report only
 *   node scripts/import-ls-vendors.mjs --file path/to/export.csv         # import
 *
 * Rules (docs/decisions.md):
 *   - Only rows with Enabled = Yes.
 *   - "WWD" / "NOT WWD" / "Faire" in the name become billing routes, not part of the name.
 *     The exact Lightspeed name is kept in lightspeed_name and aliases.
 *   - Rows whose names are identical after stripping tags/punctuation are merged into one
 *     vendor with every Lightspeed name as an alias and the union of routes, and flagged
 *     for review. Near-duplicates are imported separately and flagged as a possible
 *     duplicate pair.
 *   - Re-running is safe: existing vendors (same name, case-insensitive) are skipped.
 */
import { readFileSync } from 'node:fs'
import { query, lit, textArray } from './db.mjs'

const args = parseArgs(process.argv.slice(2))
const file = args.file
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
if (!file) die('--file is required')

// ---------- parse ----------
const rows = parseCsv(readFileSync(file, 'utf8'))
const header = rows.shift().map((h) => h.replace(/^﻿/, '').trim())
const col = (name) => header.indexOf(name)
for (const required of ['Enabled', 'Vendor']) if (col(required) === -1) die(`Column "${required}" not found. Columns: ${header.join(', ')}`)
const records = rows
  .filter((r) => r.length >= 2)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
const enabled = records.filter((r) => r.Enabled.toLowerCase() === 'yes')
const disabled = records.length - enabled.length

const TAG_RE = /(?<![A-Z0-9])(NOT[\s-]*WWD|NON[\s-]*WWD|WWD|FAIRE)(?![A-Z0-9])/gi
function parseName(raw) {
  const tags = new Set()
  for (const m of raw.matchAll(TAG_RE)) {
    const t = m[1].toUpperCase()
    tags.add(t.startsWith('NOT') || t.startsWith('NON') ? 'direct' : t === 'WWD' ? 'worldwide' : 'faire')
  }
  let clean = raw.replace(TAG_RE, ' ')
  clean = clean.replace(/\(\s*\)/g, ' ').replace(/[\s\-–/(),.]+$/, '').replace(/^[\s\-–/(),.]+/, '').replace(/\s{2,}/g, ' ').trim()
  return { clean, tags }
}
const key = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const loose = (s) => key(s.toUpperCase().replace(/\b(INC|LLC|CO|CORP|CORPORATION|COMPANY|LTD|USA|THE)\b/g, ''))

// ---------- group ----------
const groups = new Map()
for (const r of enabled) {
  const raw = r.Vendor.trim()
  const { clean, tags } = parseName(raw)
  const k = key(clean)
  if (!groups.has(k)) groups.set(k, { clean, raws: [], tags: new Set(), catalog: '', contact: '', phone: '', mobile: '', fax: '' })
  const g = groups.get(k)
  g.raws.push(raw)
  for (const t of tags) g.tags.add(t)
  for (const f of ['Catalog', 'Contact', 'Phone', 'Mobile', 'Fax']) {
    const v = (r[f] ?? '').trim()
    const dest = f.toLowerCase()
    if (v && !g[dest]) g[dest] = v
  }
}
const vendors = [...groups.values()]
const merged = vendors.filter((g) => g.raws.length > 1)

// near duplicates
const keys = [...groups.keys()]
const pairs = []
const seen = new Set()
const byLoose = new Map()
for (const k of keys) {
  const l = loose(groups.get(k).clean)
  if (!byLoose.has(l)) byLoose.set(l, [])
  byLoose.get(l).push(k)
}
for (const ks of byLoose.values()) if (ks.length > 1) for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) addPair(ks[i], ks[j], 'same name ignoring Inc/LLC/Co')
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const a = keys[i], b = keys[j]
  if (a.length < 4 || b.length < 4) continue
  if (a.startsWith(b) || b.startsWith(a)) addPair(a, b, 'one name starts with the other')
  else if (similarity(a, b) >= 0.9) addPair(a, b, 'very similar spelling')
}
function addPair(a, b, why) {
  const id = [a, b].sort().join('|')
  if (seen.has(id)) return
  seen.add(id)
  pairs.push({ a, b, why })
}

// ---------- report ----------
const routeCount = { worldwide: 0, faire: 0, direct: 0 }
for (const v of vendors) for (const t of v.tags) routeCount[t]++
console.log(`rows ${records.length} | enabled ${enabled.length} | disabled (skipped) ${disabled}`)
console.log(`vendors to create ${vendors.length} | merged duplicate groups ${merged.length} | possible duplicate pairs ${pairs.length}`)
console.log(`routes: worldwide ${routeCount.worldwide}, faire ${routeCount.faire}, direct ${routeCount.direct}, untagged ${vendors.filter((v) => v.tags.size === 0).length}`)
if (dry) {
  console.log('\nMerged groups:')
  for (const g of merged) console.log(`  ${g.clean}  <=  ${g.raws.join(' | ')}  routes=${[...g.tags].join(',') || '-'}`)
  console.log('\nPossible duplicates:')
  for (const p of pairs) console.log(`  ${groups.get(p.a).clean}  ~  ${groups.get(p.b).clean}  (${p.why})`)
  console.log('\nDry run only. Nothing written.')
  process.exit(0)
}

// ---------- write ----------
const existing = await query(`select lower(name) as n from public.vendors where organization_id = ${lit(ORG)}`)
const existingNames = new Set(existing.map((r) => r.n))
const toInsert = vendors.filter((v) => !existingNames.has(v.clean.toLowerCase()))
console.log(`\nexisting vendors skipped: ${vendors.length - toInsert.length}; inserting ${toInsert.length}`)

const CHUNK = 150
for (let i = 0; i < toInsert.length; i += CHUNK) {
  const chunk = toInsert.slice(i, i + CHUNK)
  const values = chunk.map((v) => {
    const noteParts = []
    if (v.contact) noteParts.push(`Contact (from Lightspeed): ${v.contact}`)
    if (v.mobile) noteParts.push(`Mobile (from Lightspeed): ${v.mobile}`)
    const review = v.raws.length > 1 ? `Merged from ${v.raws.length} Lightspeed vendors: ${v.raws.join(' | ')}. Please confirm.` : null
    const aliases = [...new Set(v.raws.filter((r) => r !== v.clean))]
    return `(${lit(ORG)}, ${lit(v.clean)}, ${lit(v.raws[0])}, ${textArray(aliases)}, ${lit(v.catalog || null)}, ${lit(v.phone || null)}, ${lit(v.fax || null)}, ${lit(noteParts.join('\n') || null)}, ${v.raws.length > 1 ? 'true' : 'false'}, ${lit(review)})`
  })
  await query(`insert into public.vendors (organization_id, name, lightspeed_name, aliases, catalog, phone, fax, notes, needs_review, review_note)
    values ${values.join(',\n')} on conflict do nothing`)
  process.stdout.write(`  inserted ${Math.min(i + CHUNK, toInsert.length)}/${toInsert.length}\n`)
}

// ids by name
const idRows = await query(`select id, lower(name) as n from public.vendors where organization_id = ${lit(ORG)}`)
const idByName = new Map(idRows.map((r) => [r.n, r.id]))

// routes
const routeValues = []
for (const v of vendors) {
  const id = idByName.get(v.clean.toLowerCase())
  if (!id) continue
  const tags = [...v.tags]
  tags.forEach((t, idx) => routeValues.push(`(${lit(id)}, ${lit(t)}::public.billing_route, ${idx === 0 ? 'true' : 'false'})`))
}
for (let i = 0; i < routeValues.length; i += 300) {
  await query(`insert into public.vendor_billing_routes (vendor_id, route, is_default) values ${routeValues.slice(i, i + 300).join(',')} on conflict do nothing`)
}
console.log(`routes written: ${routeValues.length}`)

// review items: merged groups + possible duplicates (skip if an identical pending item exists)
const reviewValues = []
for (const g of merged) {
  const id = idByName.get(g.clean.toLowerCase())
  if (!id) continue
  reviewValues.push(`(${lit(ORG)}::uuid, 'vendor_merge', 'vendor', ${lit(id)}::uuid, ${lit(`Merged duplicate Lightspeed vendors into "${g.clean}"`)}, ${lit(JSON.stringify({ lightspeed_names: g.raws, routes: [...g.tags] }))}::jsonb)`)
}
for (const p of pairs) {
  const a = groups.get(p.a), b = groups.get(p.b)
  const ida = idByName.get(a.clean.toLowerCase()), idb = idByName.get(b.clean.toLowerCase())
  if (!ida || !idb) continue
  reviewValues.push(`(${lit(ORG)}::uuid, 'vendor_duplicate', 'vendor', ${lit(ida)}::uuid, ${lit(`Possible duplicate: "${a.clean}" and "${b.clean}"`)}, ${lit(JSON.stringify({ other_vendor_id: idb, other_name: b.clean, reason: p.why, lightspeed_names: [...a.raws, ...b.raws] }))}::jsonb)`)
}
if (reviewValues.length) {
  await query(`insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
    select v.* from (values ${reviewValues.join(',\n')}) as v(organization_id, kind, entity_type, entity_id, title, details)
    where not exists (select 1 from public.review_items r where r.organization_id = v.organization_id and r.kind = v.kind and r.entity_id = v.entity_id and r.title = v.title and r.status = 'pending')`)
}
console.log(`review items written: ${reviewValues.length}`)

// flag near-duplicate vendors too
const dupIds = [...new Set(pairs.flatMap((p) => [groups.get(p.a).clean, groups.get(p.b).clean]).map((n) => idByName.get(n.toLowerCase())).filter(Boolean))]
if (dupIds.length) {
  await query(`update public.vendors set needs_review = true, review_note = coalesce(review_note || E'\\n', '') || 'Possible duplicate of another vendor; see review queue.' where id in (${dupIds.map(lit).join(',')}) and review_note is distinct from 'Possible duplicate of another vendor; see review queue.'`)
}

await query(`insert into public.activity_log (organization_id, entity_type, action, details) values (${lit(ORG)}, 'vendor', 'import', ${lit(JSON.stringify({ source: 'lightspeed_vendor_export', file: file.split('/').pop(), rows: records.length, enabled: enabled.length, created: toInsert.length, merged_groups: merged.length, possible_duplicates: pairs.length }))}::jsonb)`)
const total = await query(`select count(*)::int as n from public.vendors where organization_id = ${lit(ORG)}`)
console.log(`done. vendors in database: ${total[0].n}`)

// ---------- helpers ----------
function parseCsv(text) {
  const out = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); out.push(row); row = []; field = ''
    } else field += c
  }
  if (field.length || row.length) { row.push(field); out.push(row) }
  return out.filter((r) => r.some((f) => f.trim() !== ''))
}
function similarity(a, b) {
  // Dice coefficient on bigrams
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1) } return m }
  const A = bg(a), B = bg(b)
  let inter = 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0)
  return (2 * inter) / ((a.length - 1) + (b.length - 1))
}
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2), n = argv[i + 1]
    if (n === undefined || n.startsWith('--')) out[k] = true
    else { out[k] = n; i++ }
  }
  return out
}
function die(msg) { console.error(msg); process.exit(1) }
