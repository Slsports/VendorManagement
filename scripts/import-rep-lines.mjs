#!/usr/bin/env node
/**
 * Load a rep group's line list (the sheet a rep sends listing everything they carry).
 *
 *   node scripts/import-rep-lines.mjs --file lines.xlsx --rep-group "DandyLines / Diverse Marketing" \
 *        --contact "Donna Hoffman" --email donna@example.com --phone 425-555-0000 \
 *        --route worldwide|direct|faire|none --source rep_dandylines --specials-label "Fall 2026" [--group-notes "..."] \
 *        [--match-hints "Line name=VMS vendor name;Other line=Other vendor"] [--dry]
 *
 * Columns (header names, case-insensitive): Line | Vendor | Name; Catalog | Catalog link | Link;
 * Specials | Show special; Zero upcharge; Notes | Merchandise | Description. Extra columns are kept on the line.
 *
 * Rules (Dana, 2026-10-06):
 *   - the rep group is created or updated with the contact details
 *   - a line that matches an existing vendor: rep group set if the vendor has none, route added if it has none
 *     (never changed), zero-upcharge flag set, catalog link saved, "do not order" notes set the flag with the reason
 *   - a line that matches nothing becomes a catalog-only line (vendor_directory). Never a vendor record.
 */
import XLSX from 'xlsx'
import { query, lit } from './db.mjs'
import { buildIndex, findVendor, parseArgs, die } from './lib/match.mjs'

const args = parseArgs(process.argv.slice(2))
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
for (const k of ['file', 'rep-group', 'source']) if (!args[k]) die(`--${k} is required`)
const ROUTE = args.route && args.route !== 'none' ? args.route : null
if (ROUTE && !['worldwide', 'faire', 'direct'].includes(ROUTE)) die('--route must be worldwide, faire, direct or none')

const wb = XLSX.readFile(args.file)
const ws = wb.Sheets[args.sheet || wb.SheetNames[0]]
const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
const hdrIdx = grid.findIndex((r) => r.some((c) => /^(line|vendor|name|vendor name)$/i.test(String(c).trim())))
if (hdrIdx === -1) die('No Line/Vendor header row found')
const headerRaw = grid[hdrIdx].map((h) => String(h).trim())
const header = headerRaw.map((h) => h.toLowerCase())
const colOf = (...names) => header.findIndex((h) => names.includes(h))
const C = {
  name: colOf('line', 'vendor', 'name', 'vendor name'),
  catalog: colOf('catalog', 'catalog link', 'link', 'catalog url'),
  specials: colOf('specials', 'show special', 'show specials', 'special'),
  zero: colOf('zero upcharge', 'zero upcharge vendor', '0 upcharge'),
  notes: colOf('notes', 'merchandise', 'description', 'note'),
}
const cell = (r, i) => (i >= 0 && r[i] !== undefined ? String(r[i]).replace(/ /g, ' ').trim() : '')
const rows = grid.slice(hdrIdx + 1).map((r) => ({
  name: cell(r, C.name).replace(/\s{2,}/g, ' '),
  catalog: cell(r, C.catalog) || null,
  specials: cell(r, C.specials) || null,
  zero: /^(y|yes|true|1|0 upcharge|zero)/i.test(cell(r, C.zero)) || /upcharge/i.test(cell(r, C.zero)),
  // notes: the Notes/Merchandise column plus anything typed into an unnamed column (reps do that)
  notes: [cell(r, C.notes), ...headerRaw.map((h, i) => (!h && i !== C.name ? cell(r, i) : '')), ...(C.notes === -1 ? [] : [])].filter(Boolean).join(' | ') || null,
  extra: Object.fromEntries(headerRaw.map((h, i) => [h, cell(r, i)]).filter(([h, v], i) => h && v && ![C.name, C.catalog, C.specials, C.zero, C.notes].includes(i))),
})).filter((r) => r.name && !/^total/i.test(r.name))

const live = await query(`select v.id, v.name, v.lightspeed_name, v.aliases, v.rep_group_id, v.do_not_order, v.wwd_zero_upcharge, (select array_agg(route::text) from public.vendor_billing_routes b where b.vendor_id = v.id) as routes from public.vendors v where organization_id = ${lit(ORG)} and is_active`)
const index = buildIndex(live)
// Explicit pairings for names the matcher is too careful to link ("American Dream" = AMERICAN DREAM HOME GOODS).
const hints = new Map(String(args['match-hints'] || '').split(';').filter(Boolean).map((h) => h.split('=').map((x) => x.trim().toLowerCase())))
const byName = new Map(live.map((v) => [v.name.toLowerCase(), v]))
const plan = rows.map((r) => {
  const hinted = hints.get(r.name.toLowerCase())
  if (hinted) {
    const v = byName.get(hinted)
    if (!v) die(`--match-hints: no vendor named "${hinted}"`)
    return { ...r, hit: { vendor: v, how: 'hint' } }
  }
  return { ...r, hit: findVendor(index, r.name) }
})
const have = plan.filter((p) => p.hit), catalogOnly = plan.filter((p) => !p.hit)
console.log(`${args['rep-group']}: ${rows.length} lines | ${have.length} are vendors in VMS | ${catalogOnly.length} catalog-only`)
for (const p of have) console.log(`  vendor  ${p.name}  => ${p.hit.vendor.name}${p.hit.how === 'prefix' ? ' (prefix)' : ''}${p.hit.vendor.rep_group_id ? ' [has rep group]' : ''}${(p.hit.vendor.routes || []).length ? ` [${p.hit.vendor.routes.join(',')}]` : ROUTE ? ` [+${ROUTE}]` : ''}${p.zero ? ' zero-upcharge' : ''}${/do not order/i.test(p.notes || '') ? ' DO NOT ORDER' : ''}`)
for (const p of catalogOnly) console.log(`  line    ${p.name}${p.catalog ? ' (catalog)' : ''}${p.zero ? ' zero-upcharge' : ''}`)
if (dry) { console.log('\nDry run only. Nothing written.'); process.exit(0) }

// rep group
let [grp] = await query(`select id from public.rep_groups where organization_id = ${lit(ORG)} and lower(name) = lower(${lit(args['rep-group'])})`)
if (!grp) {
  ;[grp] = await query(`insert into public.rep_groups (organization_id, name, contact_name, email, phone, notes) values (${lit(ORG)}, ${lit(args['rep-group'])}, ${lit(args.contact || null)}, ${lit(args.email || null)}, ${lit(args.phone || null)}, ${lit(args['group-notes'] || null)}) returning id`)
  console.log(`rep group created: ${args['rep-group']}`)
} else {
  await query(`update public.rep_groups set contact_name = coalesce(${lit(args.contact || null)}, contact_name), email = coalesce(${lit(args.email || null)}, email), phone = coalesce(${lit(args.phone || null)}, phone), notes = coalesce(${lit(args['group-notes'] || null)}, notes) where id = ${lit(grp.id)}`)
}
const G = lit(grp.id) + '::uuid'

// vendors we have: one API call per vendor carrying every statement (the API throttles per request)
let grouped = 0, routed = 0, zeroed = 0, dno = 0
const linksBefore = (await query(`select count(*)::int as n from public.vendor_links where organization_id = ${lit(ORG)}`))[0].n
const lineRow = (p, vendorSql) => `(${lit(ORG)}, ${lit(args.source)}, ${lit(args['rep-group'])}, ${lit(p.name)}, ${ROUTE ? lit(ROUTE) + '::public.billing_route' : "'worldwide'"}, ${G}, ${lit(p.catalog)}, ${lit(p.specials)}, ${lit(args['specials-label'] || null)}, ${p.zero}, ${lit(p.notes)}, ${lit(JSON.stringify(p.extra))}::jsonb, ${vendorSql})`
const lineUpsert = (rows) => `insert into public.vendor_directory (organization_id, source, source_label, name, route, rep_group_id, catalog_url, specials, specials_label, zero_upcharge, notes, data, matched_vendor_id)
    values ${rows.join(',\n')}
    on conflict (organization_id, name_key) do update set rep_group_id = coalesce(public.vendor_directory.rep_group_id, excluded.rep_group_id), catalog_url = coalesce(excluded.catalog_url, public.vendor_directory.catalog_url),
      specials = coalesce(excluded.specials, public.vendor_directory.specials), specials_label = coalesce(excluded.specials_label, public.vendor_directory.specials_label),
      zero_upcharge = public.vendor_directory.zero_upcharge or excluded.zero_upcharge, notes = coalesce(public.vendor_directory.notes, excluded.notes),
      matched_vendor_id = coalesce(public.vendor_directory.matched_vendor_id, excluded.matched_vendor_id)`
for (const p of have) {
  const v = p.hit.vendor
  const V = lit(v.id) + '::uuid'
  const sets = [], stmts = []
  if (!v.rep_group_id) { sets.push(`rep_group_id = ${G}`); grouped++ }
  if (p.zero && !v.wwd_zero_upcharge) { sets.push('wwd_zero_upcharge = true'); zeroed++ }
  if (/do not order/i.test(p.notes || '') && !v.do_not_order) { sets.push(`do_not_order = true, do_not_order_reason = ${lit(`${p.notes} (per ${args['rep-group']} line list)`)}`); dno++ }
  if (sets.length) stmts.push(`update public.vendors set ${sets.join(', ')} where id = ${V}`)
  const addRoute = ROUTE && (v.routes || []).length === 0
  if (addRoute) { stmts.push(`insert into public.vendor_billing_routes (vendor_id, route, is_default) values (${V}, ${lit(ROUTE)}::public.billing_route, true) on conflict do nothing`); routed++ }
  if (p.catalog) stmts.push(`insert into public.vendor_links (organization_id, vendor_id, kind, label, url, season_label, source) select ${lit(ORG)}, ${V}, 'catalog', ${lit(`${args['rep-group']} catalog`)}, ${lit(p.catalog)}, ${lit(args['specials-label'] || null)}, 'rep_list'
      where not exists (select 1 from public.vendor_links where vendor_id = ${V} and url = ${lit(p.catalog)})`)
  if (p.specials) stmts.push(`insert into public.vendor_links (organization_id, vendor_id, kind, label, url, season_label, source, notes) select ${lit(ORG)}, ${V}, 'specials', ${lit(`${args['specials-label'] || 'Show'} specials`)}, ${lit(p.catalog || 'https://')}, ${lit(args['specials-label'] || null)}, 'rep_list', ${lit(p.specials)}
      where not exists (select 1 from public.vendor_links where vendor_id = ${V} and kind = 'specials' and season_label is not distinct from ${lit(args['specials-label'] || null)})`)
  stmts.push(`insert into public.activity_log (organization_id, entity_type, entity_id, action, details) values (${lit(ORG)}, 'vendor', ${V}, 'rep_list', ${lit(JSON.stringify({ rep_group: args['rep-group'], source: args.source, set: sets.map((s) => s.split(' ')[0]), route: addRoute ? ROUTE : null }))}::jsonb)`)
  stmts.push(lineUpsert([lineRow(p, V)]))
  await query(stmts.join(';\n'))
}
// catalog-only lines, one call
if (catalogOnly.length) await query(lineUpsert(catalogOnly.map((p) => lineRow(p, 'null'))))
const links = (await query(`select count(*)::int as n from public.vendor_links where organization_id = ${lit(ORG)}`))[0].n - linksBefore
console.log(`done: rep group set on ${grouped}, route added on ${routed}, zero-upcharge on ${zeroed}, do-not-order on ${dno}, links ${links}, catalog-only lines ${catalogOnly.length}`)
