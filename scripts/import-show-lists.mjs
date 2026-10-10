#!/usr/bin/env node
/**
 * Load a Worldwide show into VMS from the two PDFs Worldwide publishes:
 *   - the Exhibitor Listing (exhibitor + booth)
 *   - the ShowTime "Exhibitor Line Listing" pages (line + booth, three columns)
 *
 *   node scripts/import-show-lists.mjs --show wwd_fall_2026 --label "Fall 2026 (Reno, Sept 1-3)" --date 2026-09-01 \
 *        --exhibitors ExhibitorListing.pdf --lines ShowTime.pdf --lines-pages 6-9 [--new-pages 18] [--dry]
 *   --skip "Name;Other name" leaves those listing names unmatched (look-alikes of a different vendor).
 *   Page lists may be ranges and commas: --lines-pages 8-11,14,16-19. When the packet has no separate
 *   exhibitor listing, leave --exhibitors out: booth holders are then unknown (booth-mates still work).
 *
 * What it writes (never a vendor record):
 *   - one line per listed name in vendor_directory (route worldwide), matched to an existing vendor when the name fits
 *   - one show_appearances row per line: booth, exhibitor (booth holder), new-exhibitor flag
 *   - WWD route on matched vendors that had no route (activity logged); vendors tagged without WWD are reported, not changed
 * Rule (Dana): being on the list means WWD; NOT being on it means nothing.
 * Needs poppler's pdftotext on PATH.
 */
import { execFileSync } from 'node:child_process'
import { query, lit } from './db.mjs'
import { buildIndex, dbKey, findVendor, parseArgs, die } from './lib/match.mjs'

const args = parseArgs(process.argv.slice(2))
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
for (const k of ['show', 'label']) if (!args[k]) die(`--${k} is required`)
if (!args.lines && !args.exhibitors) die('--lines (line listing) or --exhibitors (exhibitor listing) is required')
if (args.lines && !args['lines-pages']) die('--lines-pages is required with --lines')

const BOOTH = /^(?:[A-Z]?\d{2,4}|L\d{1,2})(?:,[A-Z]?\d{2,4})*$/
const SERVICE = /payments?|insurance|paychex|nssf|guns\.com|gearfire|livescan|\bffl|4473|acumatica|celerant|lightspeed|clover|armslist|lipsey|bravo store|otter ?text|hub international|hobson/i
const SKIP_BOOTHS = new Set(['401', 'L1', 'L2', 'L3'])

// ---- parse "name + booth" listings from word boxes (poppler pdftotext -bbox-layout) ----
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") }
/** Returns [{name, booth}] for a PDF whose pages are `columns` columns of "Name   booth". */
function pageRanges(spec) {
  return String(spec).split(',').map((part) => { const [a, b] = part.trim().split('-').map(Number); return [a, b || a] })
}
function parseListing(pdf, pages, columns, maxX = 1) {
  const xml = pageRanges(pages).map(([pFrom, pTo]) => execFileSync('pdftotext', ['-bbox-layout', '-f', String(pFrom), '-l', String(pTo), pdf, '-']).toString()).join('\n')
  const out = []
  for (const page of xml.split('<page ').slice(1)) {
    const width = Number(page.match(/width="([\d.]+)"/)[1])
    const cols = Array.from({ length: columns }, () => [])
    for (const wm of page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const x = Number(wm[1]), yc = (Number(wm[2]) + Number(wm[4])) / 2, text = decode(wm[5]).trim()
      if (!text || x > width * maxX) continue   // decorative vertical titles sit past the booth column
      cols[Math.min(columns - 1, Math.floor(x / (width * maxX / columns)))].push({ x, y: yc, text })
    }
    for (const col of cols) {
      col.sort((a, b) => a.y - b.y || a.x - b.x)
      const rows = []
      for (const w of col) {
        const last = rows[rows.length - 1]
        if (last && Math.abs(last.y - w.y) <= 3) last.words.push(w)
        else rows.push({ y: w.y, words: [w] })
      }
      let carry = null
      for (const r of rows) {
        r.words.sort((a, b) => a.x - b.x)
        const text = r.words.map((w) => w.text).join(' ')
        if (/^(ShowTime|Page \d|Worldwide \||LINE LISTING|BOOTH #|EXHIBITOR|LISTING|Exhibitor|Booth #)/.test(text) || /^[A-Z]$/.test(text)) { carry = null; continue }
        const toks = r.words.map((w) => w.text)
        const firstBooth = toks.findIndex((t) => BOOTH.test(t.replace(/,$/, '')))
        const boothTok = toks.filter((t) => BOOTH.test(t.replace(/,$/, ''))).map((t) => t.replace(/,$/, ''))
        const after = firstBooth === -1 ? [] : toks.slice(firstBooth).filter((t) => !BOOTH.test(t.replace(/,$/, '')))
        const name = (firstBooth === -1 ? toks : toks.slice(0, firstBooth)).join(' ').replace(/\s+/g, ' ').trim()
        const booth = boothTok.join(',')
        const zero = after.includes('Y')
        if (booth && name) { out.push({ name: carry ? `${carry} ${name}` : name, booth, zero }); carry = null }
        else if (booth && carry) { out.push({ name: carry, booth, zero }); carry = null }
        else if (name && !after.length) carry = carry ? `${carry} ${name}` : name
      }
    }
  }
  return out
}

const exhibitorByBooth = new Map()
const exhibitors = args.exhibitors ? parseListing(args.exhibitors, args['exhibitors-pages'] || '1-99', Number(args['exhibitors-columns'] || 2), Number(args['exhibitors-max-x'] || 1)) : []
for (const e of exhibitors) for (const b of e.booth.split(',')) exhibitorByBooth.set(b, e.name)
// Without a line listing, every exhibitor is a line; "Carolina/Double H/Phantom Rider" is three lines in one booth.
const lines = args.lines
  ? parseListing(args.lines, args['lines-pages'], Number(args['lines-columns'] || 3), Number(args['lines-max-x'] || 1))
  : exhibitors.flatMap((e) => e.name.split('/').map((n) => n.trim()).filter((n) => n.length >= 3).map((n) => ({ ...e, name: n })))

// Optional list of zero-upcharge vendors for this show (names only)
const zeroNames = new Set()
if (args['zero-upcharge']) {
  const zx = execFileSync('pdftotext', ['-bbox-layout', args['zero-upcharge'], '-']).toString()
  for (const lm of zx.matchAll(/<line[^>]*>([\s\S]*?)<\/line>/g)) {
    const t = [...lm[1].matchAll(/<word[^>]*>([^<]*)<\/word>/g)].map((w) => decode(w[1])).join(' ').trim()
    if (!t || /upcharge|worldwide|membership|these vendors|^w$|^hat a/i.test(t)) continue
    zeroNames.add(dbKey(t))
  }
  console.log(`zero-upcharge names: ${zeroNames.size}`)
}

// new exhibitors page (optional): names only
const newNames = new Set()
if (args['new-pages']) {
  const t = pageRanges(args['new-pages']).map(([nFrom, nTo]) => execFileSync('pdftotext', ['-f', String(nFrom), '-l', String(nTo), args.lines, '-']).toString()).join('\n')
  for (const raw of t.split('\n')) { const m = raw.trim().match(/^(.+?)\s+(\d{3,4})$/); if (m) newNames.add(dbKey(m[1])) }
}

// dedupe + skip services
const seen = new Map()
for (const l of lines) {
  const k = dbKey(l.name)
  if (!k || k.length < 2) continue
  const booths = l.booth.split(',')
  if (booths.every((b) => SKIP_BOOTHS.has(b)) || SERVICE.test(l.name)) continue
  const zero = !!l.zero || zeroNames.has(k)
  if (!seen.has(k)) seen.set(k, { name: l.name, booth: l.booth, zero, exhibitor: booths.map((b) => exhibitorByBooth.get(b)).filter(Boolean).join(' / ') || null })
  else if (zero) seen.get(k).zero = true
}
const entries = [...seen.values()]
console.log(`exhibitors ${exhibitorByBooth.size} booths | lines ${lines.length} parsed, ${entries.length} distinct after skipping service booths | zero-upcharge ${entries.filter((e) => e.zero).length}`)

// ---- match to vendors ----
const live = await query(`select v.id, v.name, v.lightspeed_name, v.aliases, v.rep_group_id, (select array_agg(route::text) from public.vendor_billing_routes b where b.vendor_id = v.id) as routes from public.vendors v where organization_id = ${lit(ORG)} and is_active`)
const index = buildIndex(live)
const skip = new Set(String(args.skip || '').split(';').map((x) => dbKey(x)).filter(Boolean))
const matched = [], noRoute = [], notWwd = []
for (const e of entries) {
  const hit = skip.has(dbKey(e.name)) ? null : findVendor(index, e.name)
  if (!hit) continue
  e.vendorId = hit.vendor.id; e.vendorName = hit.vendor.name; e.how = hit.how
  matched.push(e)
  const routes = hit.vendor.routes || []
  if (routes.length === 0) noRoute.push(hit.vendor)
  else if (!routes.includes('worldwide')) notWwd.push({ v: hit.vendor, routes })
}
console.log(`matched vendors ${matched.length} | no route yet (will get WWD) ${noRoute.length} | tagged without WWD (left alone) ${notWwd.length}`)
if (notWwd.length) for (const c of notWwd) console.log(`  check: ${c.v.name} (VMS: ${c.routes.join(', ')})`)
if (dry) {
  console.log('\nNon-exact matches to eyeball:')
  for (const m of matched.filter((m) => m.how !== 'exact')) console.log(`  ${m.name}  => ${m.vendorName}`)
  console.log('\nDry run only. Nothing written.')
  process.exit(0)
}

// ---- write lines ----
const CH = 150
for (let i = 0; i < entries.length; i += CH) {
  const vals = entries.slice(i, i + CH).map((e) => `(${lit(ORG)}::uuid, ${lit(args.show)}, ${lit(args.label)}, ${lit(e.name)}, 'worldwide'::public.billing_route, ${e.vendorId ? lit(e.vendorId) + '::uuid' : 'null'}, ${!!e.zero})`)
  await query(`insert into public.vendor_directory (organization_id, source, source_label, name, route, matched_vendor_id, zero_upcharge) values ${vals.join(',\n')}
    on conflict (organization_id, name_key) do update set matched_vendor_id = coalesce(public.vendor_directory.matched_vendor_id, excluded.matched_vendor_id), zero_upcharge = public.vendor_directory.zero_upcharge or excluded.zero_upcharge`)
}
const ids = await query(`select id, name_key from public.vendor_directory where organization_id = ${lit(ORG)}`)
const idByKey = new Map(ids.map((r) => [r.name_key, r.id]))
const appVals = entries.map((e) => `(${lit(ORG)}::uuid, ${lit(args.show)}, ${lit(args.label)}, ${lit(args.date || null)}::date, ${lit(idByKey.get(dbKey(e.name)))}::uuid, ${e.vendorId ? lit(e.vendorId) + '::uuid' : 'null'}, ${lit(e.booth)}, ${lit(e.exhibitor)}, ${newNames.has(dbKey(e.name)) ? 'true' : 'false'})`)
for (let i = 0; i < appVals.length; i += CH) {
  await query(`insert into public.show_appearances (organization_id, show_code, show_label, show_date, line_id, vendor_id, booth, exhibitor, is_new) values ${appVals.slice(i, i + CH).join(',\n')}
    on conflict (organization_id, show_code, line_id) do update set booth = excluded.booth, exhibitor = excluded.exhibitor, vendor_id = coalesce(excluded.vendor_id, public.show_appearances.vendor_id), is_new = excluded.is_new`)
}
console.log(`lines written ${entries.length}; show appearances ${appVals.length}`)

if (noRoute.length) {
  const vids = noRoute.map((v) => lit(v.id) + '::uuid').join(',')
  await query(`insert into public.vendor_billing_routes (vendor_id, route, is_default) select id, 'worldwide', true from public.vendors where id in (${vids}) on conflict do nothing`)
  await query(`insert into public.activity_log (organization_id, entity_type, entity_id, action, details) select ${lit(ORG)}, 'vendor', id, 'route_from_show_list', ${lit(JSON.stringify({ show: args.show, route: 'worldwide' }))}::jsonb from public.vendors where id in (${vids})`)
  console.log(`WWD route added to ${noRoute.length} vendors`)
}
const zeroVendors = matched.filter((m) => m.zero).map((m) => m.vendorId)
if (zeroVendors.length) {
  const ids = zeroVendors.map((id) => lit(id) + '::uuid').join(',')
  const r = await query(`update public.vendors set wwd_zero_upcharge = true where id in (${ids}) and not wwd_zero_upcharge returning id`)
  if (r.length) await query(`insert into public.activity_log (organization_id, entity_type, entity_id, action, details) select ${lit(ORG)}, 'vendor', id, 'zero_upcharge_from_show_list', ${lit(JSON.stringify({ show: args.show }))}::jsonb from public.vendors where id in (${r.map((x) => lit(x.id) + '::uuid').join(',')})`)
  console.log(`WWD zero-upcharge set on ${r.length} vendors`)
}
await query(`insert into public.activity_log (organization_id, entity_type, action, details) values (${lit(ORG)}, 'show', 'import', ${lit(JSON.stringify({ show: args.show, label: args.label, lines: entries.length, matched: matched.length, routes_added: noRoute.length }))}::jsonb)`)
