#!/usr/bin/env node
/**
 * Lightspeed vendor names often carry a tag after " - " or "(": a rep's name (Maryellen, Donna,
 * DandyLines) or the parent/billing company (Newell Brands, Normark). Dana wants to approve each
 * clean-up, so this proposes them as review items (kind vendor_rename) instead of applying them.
 *
 *   node scripts/propose-vendor-renames.mjs [--dry]
 */
import { query, lit } from './db.mjs'
import { parseArgs } from './lib/match.mjs'

const args = parseArgs(process.argv.slice(2))
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
const REP_RULES = [
  { re: /maryellen/i, group: 'Maryellen Reynolds' },
  { re: /donna|dandylines|diverse/i, group: 'DandyLines / Diverse Marketing' },
]
const groups = await query(`select id, name from public.rep_groups where organization_id = ${lit(ORG)}`)
const groupId = (name) => groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id ?? null

const vendors = await query(`select id, name, lightspeed_name, rep_group_id from public.vendors where organization_id = ${lit(ORG)} and is_active and name ~ '\\(|\\s[-–]\\s'
  and not exists (select 1 from public.review_items r where r.kind = 'vendor_rename' and r.entity_id = vendors.id)`)
const proposals = []
for (const v of vendors) {
  const m = v.name.match(/^(.*?)\s*(?:\s[-–]\s|\()\s*(.*)$/)
  if (!m) continue
  const base = m[1].replace(/[\s&(-]+$/, '').trim()
  const suffix = m[2].replace(/[()]/g, '').replace(/[\s&-]+$/, '').trim()
  if (!base) continue
  const rule = REP_RULES.find((r) => r.re.test(suffix))
  proposals.push({
    vendor: v,
    new_name: base,
    suffix,
    alias: rule ? null : suffix || null,
    rep_group_name: rule?.group ?? null,
    rep_group_id: rule ? groupId(rule.group) : null,
  })
}
console.log(`${proposals.length} proposals`)
for (const p of proposals) console.log(`  ${p.vendor.name}  =>  ${p.new_name}${p.rep_group_name ? `   rep group: ${p.rep_group_name}` : p.alias ? `   alias: ${p.alias}` : ''}`)
if (args.dry) { console.log('\nDry run only. Nothing written.'); process.exit(0) }

const vals = proposals.map((p) => `(${lit(ORG)}::uuid, 'vendor_rename', 'vendor', ${lit(p.vendor.id)}::uuid, ${lit(`Clean up name: ${p.vendor.name}`)}, ${lit(JSON.stringify({ current_name: p.vendor.name, new_name: p.new_name, suffix: p.suffix, alias: p.alias, rep_group_name: p.rep_group_name, rep_group_id: p.rep_group_id }))}::jsonb)`)
if (vals.length) await query(`insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details) values ${vals.join(',\n')}`)
await query(`update public.vendors set needs_review = true, review_note = coalesce(review_note, 'Name clean-up proposed; see review item.') where id in (${proposals.map((p) => lit(p.vendor.id) + '::uuid').join(',') || 'null'})`)
console.log(`review items created: ${vals.length}`)
