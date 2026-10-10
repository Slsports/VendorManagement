#!/usr/bin/env node
/**
 * Mark fishing vendors (vendors.is_fishing) from what we already know:
 *   - vendors with orders on the order guide's Fishing tabs
 *   - vendors on the fishing contact sheet (--sheet FISHING_VENDOR_CONTACT_LIST.xlsx)
 *   - vendors in rep groups created from that sheet (Eagle Claw, Pure Fishing, Heckel-Nokes, JRA, Leisure, Premier)
 *   - vendors whose product types mention fishing
 *
 *   node scripts/flag-fishing-vendors.mjs [--sheet sheet.xlsx] [--dry]
 */
import XLSX from 'xlsx'
import { query, lit } from './db.mjs'
import { buildIndex, findVendor, parseArgs } from './lib/match.mjs'

const args = parseArgs(process.argv.slice(2))
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
const live = await query(`select v.id, v.name, v.lightspeed_name, v.aliases, v.is_fishing, v.product_types, g.name as rep_group from public.vendors v left join public.rep_groups g on g.id = v.rep_group_id where v.organization_id = ${lit(ORG)} and v.is_active`)
const why = new Map()
const mark = (id, reason) => { if (!why.has(id)) why.set(id, new Set()); why.get(id).add(reason) }

for (const r of await query(`select distinct vendor_id from public.orders where organization_id = ${lit(ORG)} and source_sheet in ('Fishing', 'Fishing NOT WWD')`)) mark(r.vendor_id, 'fishing order tab')
const FISHING_GROUPS = /eagle claw|pure fishing|heckel|jra sales|leisure sales|premier sales/i
for (const v of live) {
  if (v.rep_group && FISHING_GROUPS.test(v.rep_group)) mark(v.id, `rep group ${v.rep_group}`)
  if (/fish|tackle|bait|lure|fly/i.test(v.product_types || '')) mark(v.id, 'product types')
}
if (args.sheet) {
  const wb = XLSX.readFile(args.sheet)
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false })
  const hi = grid.findIndex((r) => r.some((c) => /^vendor/i.test(String(c).trim())))
  const col = grid[hi].findIndex((c) => /^vendor/i.test(String(c).trim()))
  const index = buildIndex(live)
  for (const r of grid.slice(hi + 1)) {
    const raw = String(r[col] || '').trim(); if (!raw) continue
    const base = raw.replace(/\s*\(.*\)$/, '').trim()
    const hit = findVendor(index, base) || findVendor(index, raw)
    if (hit) mark(hit.vendor.id, 'fishing contact sheet')
    else console.log(`  sheet name not matched: ${raw}`)
  }
}
const byId = new Map(live.map((v) => [v.id, v]))
const toFlag = [...why.keys()].filter((id) => byId.has(id) && !byId.get(id).is_fishing)
console.log(`fishing vendors found ${why.size} | already flagged ${why.size - toFlag.length} | to flag ${toFlag.length}`)
for (const id of [...why.keys()].sort((a, b) => byId.get(a)?.name.localeCompare(byId.get(b)?.name ?? '') ?? 0)) console.log(`  ${byId.get(id)?.name}  (${[...why.get(id)].join(', ')})`)
if (args.dry) { console.log('\nDry run only. Nothing written.'); process.exit(0) }
if (toFlag.length) {
  await query(`update public.vendors set is_fishing = true where id in (${toFlag.map((id) => lit(id) + '::uuid').join(',')})`)
  await query(`insert into public.activity_log (organization_id, entity_type, entity_id, action, details) select ${lit(ORG)}, 'vendor', id, 'flagged_fishing', '{"source":"flag-fishing-vendors"}'::jsonb from public.vendors where id in (${toFlag.map((id) => lit(id) + '::uuid').join(',')})`)
}
console.log(`flagged ${toFlag.length}`)
