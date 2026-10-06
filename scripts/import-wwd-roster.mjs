#!/usr/bin/env node
/**
 * Load Worldwide's team roster PDF into partner_contacts and mark the few to show on WWD vendor pages.
 *
 *   node scripts/import-wwd-roster.mjs --file WORLDWIDETEAMROSTER.pdf --member 816 --main-phone 253-872-8746 [--dry]
 *
 * Shown on vendor pages (show_on_vendor): the Accounts Receivable specialist whose member range
 * covers our member number, the vendor liaisons (by vendor initial), the warehouse line and the
 * warehouse manager. Everything else is on the Settings page. Re-running updates in place.
 */
import { execFileSync } from 'node:child_process'
import { query, lit } from './db.mjs'
import { parseArgs, die } from './lib/match.mjs'

const args = parseArgs(process.argv.slice(2))
const dry = !!args.dry
const ORG = args.org || '00000000-0000-0000-0000-000000000001'
if (!args.file) die('--file is required')
if (!args.member) die('--member is required (our Worldwide member number)')

const text = execFileSync('pdftotext', ['-layout', args.file, '-']).toString()
const rows = []
let dept = null, section = null
for (const raw of text.split('\n')) {
  const line = raw.replace(/\s+$/, '')
  if (!line.trim()) continue
  const m = line.match(/^(\S.*?)\s{2,}(.*?)\s{2,}(\d{3})\s+(\S+@\S+)\s*$/)
  if (m) { rows.push({ name: m[1].trim(), title: m[2].trim(), extension: m[3], email: m[4].trim(), department: dept }); continue }
  const m2 = line.match(/^(\S.*?)\s{2,}(\d{3})\s+(\S+@\S+)\s*$/)   // "Warehouse   323   Warehouse@..."
  if (m2) { rows.push({ name: m2[1].trim(), title: null, extension: m2[2], email: m2[3].trim(), department: dept }); continue }
  const t = line.trim()
  if (/^[A-Z &|]+$/.test(t) && !/ROSTER/.test(t)) {
    // top-level sections (ACCOUNTING, MERCHANDISING) are followed by sub-departments; keep the most specific
    if (['MERCHANDISING', 'ACCOUNTING'].includes(t)) { section = t; dept = titleCase(t) } else dept = titleCase(t) + (section && ['HARDLINES', 'SOFTLINES'].includes(t) ? ' (Merchandising)' : '')
  }
}
function titleCase(s) { return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bIt\b/, 'IT') }
// obvious typo in the roster: one email is on "worldwidebuygoup.com"
for (const r of rows) if (/buygoup\.com$/i.test(r.email)) { r.notes = `Roster shows ${r.email}; corrected domain.`; r.email = r.email.replace(/buygoup\.com$/i, 'buygroup.com') }

const member = Number(args.member)
const covers = (range) => range.split(/[,.]\s*/).some((part) => { const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/); if (m) return member >= Number(m[1]) && member <= Number(m[2]); return Number(part.trim()) === member })
for (const r of rows) {
  const mr = r.title?.match(/Member\s*#\s*([\d\s,.-]+)\)/)
  if (mr) r.member_range = mr[1].trim()
  const ir = r.title?.match(/\(([A-Z])-([A-Z])\)/)
  if (ir) r.initial_range = `${ir[1]}-${ir[2]}`
  r.show = false
  if (r.member_range && covers(r.member_range)) { r.show = true; r.sort = 10 }
  else if (r.initial_range) { r.show = true; r.sort = 20 }
  else if (/^Warehouse$/i.test(r.name)) { r.show = true; r.sort = 30 }
  else if (/^Warehouse & Distribution Manager$/i.test(r.title || '')) { r.show = true; r.sort = 31 }
  else r.sort = 100
}
console.log(`${rows.length} people parsed`)
console.log('On the vendor box:')
for (const r of rows.filter((r) => r.show).sort((a, b) => a.sort - b.sort)) console.log(`  ${r.name} — ${r.title || r.department} — ext ${r.extension} — ${r.email}${r.member_range ? ` (members ${r.member_range})` : ''}${r.initial_range ? ` (vendors ${r.initial_range})` : ''}`)
if (dry) { console.log('\nDry run only. Nothing written.'); process.exit(0) }

const [p] = await query(`insert into public.partners (organization_id, route, name, member_number, main_phone, website)
  values (${lit(ORG)}, 'worldwide', 'Worldwide Distributors', ${lit(String(args.member))}, ${lit(args['main-phone'] || null)}, 'https://www.worldwidebuygroup.com')
  on conflict (organization_id, route) do update set member_number = excluded.member_number, main_phone = coalesce(excluded.main_phone, public.partners.main_phone)
  returning id`)
const vals = rows.map((r) => `(${lit(ORG)}, ${lit(p.id)}, ${lit(r.name)}, ${lit(r.department)}, ${lit(r.title)}, ${lit(r.extension)}, ${lit(r.email)}, ${lit(r.member_range || null)}, ${lit(r.initial_range || null)}, ${r.show}, ${r.sort}, ${lit(r.notes || null)})`)
await query(`insert into public.partner_contacts (organization_id, partner_id, name, department, title, extension, email, member_range, initial_range, show_on_vendor, sort_order, notes)
  values ${vals.join(',\n')}
  on conflict (partner_id, lower(email)) where email is not null do update set name = excluded.name, department = excluded.department, title = excluded.title, extension = excluded.extension,
    member_range = excluded.member_range, initial_range = excluded.initial_range, show_on_vendor = excluded.show_on_vendor, sort_order = excluded.sort_order, is_active = true`)
console.log(`written: ${rows.length} contacts for Worldwide (member #${args.member})`)
