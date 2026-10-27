#!/usr/bin/env node
/**
 * Lightspeed vendor names often carry a tag after " - " or "(": a rep's name (Maryellen, Donna,
 * DandyLines) or the parent/billing company (Newell Brands, Normark).
 *   - A rep's name is taken out right away, also after a dash with no spaces or with no dash at all
 *     ("EXTENDED EXPOSURE-DONNA HOFFMAN", "OEELINN DONNA DIVERSE MARKETING"): Dana, Oct 27, "I don't
 *     want clean up cards LOL, just change them." The old name stays an alias; the vendor goes under
 *     the rep's group.
 *   - Any other tag (a parent company) is still proposed as a review item (kind vendor_rename).
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

// a rep's name at the end, after any dash or none: "-DONNA HOFFMAN", " DONNA DIVERSE MARKETING"
const REP_TAIL = /^(.*?[A-Za-z0-9.)])\s*[-–]?\s*((?:maryellen|donna|dandylines|diverse marketing)\b.*)$/i
const all = await query(`select id, name, aliases, rep_group_id from public.vendors where organization_id = ${lit(ORG)} and is_active`)
const repFixes = []
for (const v of all) {
  const m = v.name.match(REP_TAIL)
  if (!m || !m[1].trim()) continue
  const rule = REP_RULES.find((r) => r.re.test(m[2]))
  repFixes.push({ vendor: v, new_name: m[1].replace(/[\s&(-]+$/, '').trim(), rep_group_id: groupId(rule.group), rep_group_name: rule.group })
}
console.log(`${repFixes.length} rep names to take out`)
for (const f of repFixes) console.log(`  ${f.vendor.name}  =>  ${f.new_name}   rep group: ${f.rep_group_name}`)
if (!args.dry) {
  for (const f of repFixes) {
    const taken = await query(`select 1 from public.vendors where organization_id = ${lit(ORG)} and lower(name) = lower(${lit(f.new_name)}) and id <> ${lit(f.vendor.id)}`)
    if (taken.length) { console.log(`  skipped ${f.vendor.name}: a vendor named ${f.new_name} already exists`); continue }
    await query(`update public.vendors set name = ${lit(f.new_name)},
        aliases = (select array(select distinct x from unnest(aliases || array[${lit(f.vendor.name)}]) x where x is not null and x <> ${lit(f.new_name)})),
        rep_group_id = coalesce(rep_group_id, ${lit(f.rep_group_id)}::uuid) where id = ${lit(f.vendor.id)}`)
    await query(`insert into public.activity_log (organization_id, entity_type, entity_id, action, details) values (${lit(ORG)}, 'vendor', ${lit(f.vendor.id)}, 'renamed',
        ${lit(JSON.stringify({ from: f.vendor.name, to: f.new_name, rep_group_id: f.rep_group_id, note: "Rep's name taken out of the vendor name" }))}::jsonb)`)
  }
}
const repIds = new Set(repFixes.map((f) => f.vendor.id))

const vendors = await query(`select id, name, lightspeed_name, rep_group_id from public.vendors where organization_id = ${lit(ORG)} and is_active and name ~ '\\(|\\s[-–]\\s'
  and not exists (select 1 from public.review_items r where r.kind = 'vendor_rename' and r.entity_id = vendors.id)`)
const proposals = []
for (const v of vendors) {
  if (repIds.has(v.id)) continue
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
