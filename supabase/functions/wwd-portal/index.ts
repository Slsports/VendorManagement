// wwd-portal: the Worldwide portal into VMS (Dana, Oct 16, "go!!"). Admin only. Settings → Worldwide.
//   { action: 'status' }  → how many portal vendors, tied to ours, lines, cards waiting, last read and import
// The scheduler header (x-cron-secret) may run the import too: { action: 'import', organization_id }.
//   { action: 'import' }  → the vendors from the last "Read all vendors" run: each tied to our vendor when the name is
//                           sure (the same name or other name, or a show-list line already tied), its details landed by
//                           wwd_portal_apply_all; a look-alike name becomes a line with a card; the rest become lines.
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { readPortalVendor } from '../_shared/wwdPortal.ts'
import type { PortalVendor } from '../_shared/wwdPortal.ts'
import { buildIndex, dbKey, findVendor, nameKey } from '../_shared/vendorMatch.ts'
import type { MatchVendor } from '../_shared/vendorMatch.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const body = await req.json().catch(() => ({})) as { action?: string; organization_id?: string }
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret && body.organization_id) {
      const out = await importPortal(db, body.organization_id)
      console.log('wwd-portal import', JSON.stringify(out))
      return json(out)
    }
    const me = await caller(req, db)
    if (me.role !== 'admin') throw new HttpError(403, 'Only the admin brings the Worldwide portal into VMS')
    if (body.action === 'import') return json(await importPortal(db, me.organization_id))
    return json(await status(db, me.organization_id))
  } catch (e) {
    return errorResponse(e)
  }
})

async function status(db: SupabaseClient, org: string) {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0
  const base = () => db.from('wwd_portal_vendors').select('id', { count: 'exact', head: true }).eq('organization_id', org)
  const [portal, tied, lines, cards, conflicts, last] = await Promise.all([
    count(base()), count(base().not('vendor_id', 'is', null)), count(base().is('vendor_id', null)),
    count(db.from('review_items').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('kind', 'show_line').eq('status', 'pending').eq('details->>from', 'wwd_portal')),
    count(db.from('review_items').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('kind', 'portal_conflict').eq('status', 'pending')),
    db.from('wwd_portal_vendors').select('read_at, applied_at').eq('organization_id', org).order('read_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const { data: read } = await db.from('portal_captures').select('created_at').eq('organization_id', org).eq('source', 'wwd_vendors').order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { portal, tied, lines, cards, conflicts, imported_read_at: last.data?.read_at ?? null, last_read_at: read?.created_at ?? null }
}

/** Every row of a query, past the 1,000-row page. */
async function all<T>(q: () => { range: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

// "Do - It Corporation": the portal spaces its dashes; read as one name ("Do-It"), so the part before the dash
// ("Do") never stands for the whole name.
const undash = (s: string) => s.replace(/\s+[-–]\s+/g, '-')

interface Line { id: string; name: string; name_key: string; matched_vendor_id: string | null }
interface Row { id?: string; number: string; vendor_id: string | null; line_id: string | null; match_how: string | null }

async function importPortal(db: SupabaseClient, org: string) {
  // the vendors as last read (a later batch wins)
  const caps = await all<{ html: string; created_at: string }>(() => db.from('portal_captures').select('html, created_at').eq('organization_id', org).eq('source', 'wwd_vendors').order('created_at'))
  if (!caps.length) throw new HttpError(400, 'Run "Read all vendors" on the Worldwide portal first')
  const portal = new Map<string, { p: PortalVendor; read_at: string }>()
  for (const c of caps) {
    for (const raw of JSON.parse(c.html) as { number: string; name: string; detail?: { vendorDetail?: Record<string, unknown> } }[]) {
      const p = readPortalVendor({ ...raw, number: String(raw.number).replace(/<[^>]*>/g, '').trim() })
      if (p) portal.set(p.number, { p, read_at: c.created_at })
    }
  }

  const vendors = await all<MatchVendor>(() => db.from('vendors').select('id, name, lightspeed_name, aliases').eq('organization_id', org).is('merged_into_id', null))
  // other names are indexed both as typed and with the portal's spaced dashes closed up
  const index = buildIndex(vendors.map((v) => ({ ...v, aliases: [...(v.aliases ?? []), ...[v.name, v.lightspeed_name, ...(v.aliases ?? [])].filter((n): n is string => !!n).map(undash)] })))
  const byId = new Map(vendors.map((v) => [v.id, v]))
  const lines = await all<Line>(() => db.from('vendor_directory').select('id, name, name_key, matched_vendor_id').eq('organization_id', org))
  const lineByKey = new Map(lines.map((l) => [l.name_key, l]))
  const known = new Map((await all<Row>(() => db.from('wwd_portal_vendors').select('id, number, vendor_id, line_id, match_how').eq('organization_id', org))).map((r) => [r.number, r]))

  const match = (name: string) => {
    const a = findVendor(index, undash(name))
    if (a) return a
    const b = nameKey(name).length >= 4 ? findVendor(index, name) : null
    return b
  }

  const rows: (Row & { organization_id: string; name: string; data: PortalVendor; read_at: string })[] = []
  const doubtful: { number: string; vendor: MatchVendor }[] = []
  const newLines: { p: PortalVendor }[] = []
  for (const [number, { p, read_at }] of portal) {
    const was = known.get(number)
    const row = { organization_id: org, number, name: p.name, data: p, read_at, vendor_id: null as string | null, line_id: was?.line_id ?? null, match_how: null as string | null }
    const line = lineByKey.get(dbKey(p.name))
    if (was?.vendor_id && (was.match_how === 'confirmed' || was.match_how === 'manual') && byId.has(was.vendor_id)) {
      row.vendor_id = was.vendor_id; row.match_how = was.match_how
    } else if (line?.matched_vendor_id && byId.has(line.matched_vendor_id)) {
      row.vendor_id = line.matched_vendor_id; row.match_how = 'line'; row.line_id = line.id
    } else {
      const m = match(p.name)
      if (m?.how === 'exact') { row.vendor_id = m.vendor.id; row.match_how = 'exact' }
      else {
        if (m) doubtful.push({ number, vendor: m.vendor })
        if (line) row.line_id = line.id
        else if (!row.line_id) newLines.push({ p })
      }
    }
    rows.push(row)
  }

  // new lines ("not bought from yet"), one per name
  const seen = new Set<string>()
  const toInsert = newLines.filter(({ p }) => { const k = dbKey(p.name); if (!k || seen.has(k) || lineByKey.has(k)) return false; seen.add(k); return true }).map(({ p }) => ({
    organization_id: org, source: 'wwd_portal', source_label: 'Worldwide portal', name: p.name, route: 'worldwide',
    email: p.email, email_domain: p.email ? p.email.split('@')[1] : null, phone: p.address?.phone ?? null,
    data: { portal_number: p.number, city: p.address?.city ?? null, state: p.address?.state ?? null },
  }))
  for (let i = 0; i < toInsert.length; i += 200) {
    const { data, error } = await db.from('vendor_directory').insert(toInsert.slice(i, i + 200)).select('id, name, name_key, matched_vendor_id')
    if (error) throw new Error(`Adding lines: ${error.message}`)
    for (const l of (data ?? []) as Line[]) lineByKey.set(l.name_key, l)
  }
  for (const r of rows) if (!r.vendor_id && !r.line_id) r.line_id = lineByKey.get(dbKey(r.name))?.id ?? null

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('wwd_portal_vendors').upsert(rows.slice(i, i + 200), { onConflict: 'organization_id,number' })
    if (error) throw new Error(`Saving portal vendors: ${error.message}`)
  }

  // look-alike names: a card each ("Is … in the Worldwide portal our vendor …?")
  let cards = 0
  for (const d of doubtful) {
    const r = rows.find((x) => x.number === d.number)
    if (!r?.line_id) continue
    const { count } = await db.from('review_items').select('id', { count: 'exact', head: true }).eq('kind', 'show_line').eq('details->>line_id', r.line_id)
    if (count) continue
    const { error } = await db.from('review_items').insert({
      organization_id: org, kind: 'show_line', entity_type: 'vendor', entity_id: d.vendor.id,
      title: `Is "${r.name}" in the Worldwide portal our vendor ${d.vendor.name}?`,
      details: { line_id: r.line_id, line_name: r.name, vendor_id: d.vendor.id, vendor_name: d.vendor.name, vendor_id_for_rules: d.vendor.id, from: 'wwd_portal', portal_number: r.number },
    })
    if (error) throw new Error(error.message)
    cards++
  }

  const { data: landed, error } = await db.rpc('wwd_portal_apply_all', { p_org: org })
  if (error) throw new Error(`Landing details: ${error.message}`)
  return {
    portal: portal.size, tied: rows.filter((r) => r.vendor_id).length,
    tied_by: rows.reduce<Record<string, number>>((a, r) => { if (r.match_how) a[r.match_how] = (a[r.match_how] ?? 0) + 1; return a }, {}),
    lines_new: toInsert.length, lines: rows.filter((r) => !r.vendor_id).length, cards, landed,
  }
}
