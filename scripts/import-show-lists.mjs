#!/usr/bin/env node
/**
 * Load a Worldwide show into VMS from the two PDFs Worldwide publishes:
 *   - the Exhibitor Listing (exhibitor + booth)
 *   - the ShowTime "Exhibitor Line Listing" pages (line + booth, three columns)
 *
 *   node scripts/import-show-lists.mjs --show wwd_fall_2026 --label "Fall 2026 (Reno, Sept 1-3)" --date 2026-09-01 \
 *        --exhibitors ExhibitorListing.pdf --lines ShowTime.pdf --lines-pages 6-9 [--new-pages 18] [--dry]
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
for (const k of ['show', 'label', 'lines', 'lines-pages']) if (!args[k]) die(`--${k} is required`)

const BOOTH = /^(?:\d{3,4}|L\d)(?:,\d{3,4})*$/
const SERVICE = /payments?|insurance|paychex|nssf|guns\.com|gearfire|livescan|\bffl|4473|acumatica|celerant|lightspeed|clover|armslist|lipsey|bravo store|otter ?text|hub international|hobson/i
const SKIP_BOOTHS = new Set(['401', 'L1', 'L2', 'L3'])

// ---- parse "name + booth" listings from word boxes (poppler pdftotext -bbox-layout) ----
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") }
/** Returns [{name, booth}] for a PDF whose pages are `columns` columns of "Name   booth". */
function pageRanges(spec) {
  return String(spec).split(',').map((part) => { const [a, b] = part.trim().split('-').map(Number); return [a, b || a] })
}
function parseListing(pdf, pages, columns) {
  const xml = pageRanges(pages).map(([pFrom, pTo]) => execFileSync('pdftotext', ['-bbox-layout', '-f', String(pFrom), '-l', String(pTo), pdf, '-']).toString()).join('\n')
  const out = []
  for (const page of xml.split('<page ').slice(1)) {
    const width = Number(page.match(/width="([\d.]+)"/)[1])
    const cols = Array.from({ length: columns }, () => [])
    for (const wm of page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const x = Number(wm[1]), yc = (Number(wm[2]) + Number(wm[4])) / 2, text = decode(wm[5]).trim()
      if (!text) continue
      cols[Math.min(columns - 1, Math.floor(x / (width / columns)))].push({ x, y: yc, text })
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
        const boothTok = r.words.map((w) => w.text.replace(/,$/, '')).filter((t) => BOOTH.test(t))
        const name = r.words.map((w) => w.text).filter((t) => !BOOTH.test(t.replace(/,$/, ''))).join(' ').replace(/\s+/g, ' ').trim()
        const booth = boothTok.join(',')
        if (booth && name) { out.push({ name: carry ? `${carry} ${name}` : name, booth }); carry = null }
        else if (booth && carry) { out.push({ name: carry, booth }); carry = null }
        else if (name) carry = carry ? `${carry} ${name}` : name
      }
    }
  }
  return out
}

const exhibitorByBooth = new Map()
if (args.exhibitors) for (const e of parseListing(args.exhibitors, args['exhibitors-pages'] || '1-99', 2)) for (const b of e.booth.split(',')) exhibitorByBooth.set(b, e.name)
const lines = parseListing(args.lines, args['lines-pages'], 3)

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
  if (!seen.has(k)) seen.set(k, { name: l.name, booth: l.booth, exhibitor: booths.map((b) => exhibitorByBooth.get(b)).filter(Boolean).join(' / ') || null })
}
const entries = [...seen.values()]
console.log(`exhibitors ${exhibitorByBooth.size} booths | lines ${lines.length} parsed, ${entries.length} distinct after skipping service booths`)

// ---- match to vendors ----
const live = await query(`select v.id, v.name, v.lightspeed_name, v.aliases, v.rep_group_id, (select array_agg(route::text) from public.vendor_billing_routes b where b.vendor_id = v.id) as routes from public.vendors v where organization_id = ${lit(ORG)} and is_active`)
const index = buildIndex(live)
const matched = [], noRoute = [], notWwd = []
for (const e of entries) {
  const hit = findVendor(index, e.name)
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
  const vals = entries.slice(i, i + CH).map((e) => `(${lit(ORG)}::uuid, ${lit(args.show)}, ${lit(args.label)}, ${lit(e.name)}, 'worldwide'::public.billing_route, ${e.vendorId ? lit(e.vendorId) + '::uuid' : 'null'})`)
  await query(`insert into public.vendor_directory (organization_id, source, source_label, name, route, matched_vendor_id) values ${vals.join(',\n')}
    on conflict (organization_id, name_key) do update set matched_vendor_id = coalesce(public.vendor_directory.matched_vendor_id, excluded.matched_vendor_id)`)
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
await query(`insert into public.activity_log (organization_id, entity_type, action, details) values (${lit(ORG)}, 'show', 'import', ${lit(JSON.stringify({ show: args.show, label: args.label, lines: entries.length, matched: matched.length, routes_added: noRoute.length }))}::jsonb)`)
