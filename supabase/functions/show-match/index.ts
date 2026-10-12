// show-match: show list lines to vendors (Dana, Oct 12: Royal Deluxe was on the Spring lists but not on its vendor page).
// Run on demand after a show list is loaded (header x-cron-secret): Claude compares the lines with no vendor against the
// vendor list, 80 at a time, with each line's booth and booth-mates; sure matches are tied, maybes become "Show line" cards;
// then booth-mate cards ("add it to that rep group?"). Returns how many are left.
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, matchShowLines } from '../_shared/ai.ts'

const TIME_BUDGET_MS = 110_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const out: Record<string, unknown> = {}
    const { data: orgs } = await db.from('organizations').select('id')
    for (const o of orgs ?? []) {
      const org = o.id as string
      const { data: vendors } = await db.from('vendors').select('id, name, aliases').eq('organization_id', org).eq('is_active', true).is('merged_into_id', null).order('name').limit(5000)
      const byName = new Map((vendors ?? []).map((v) => [v.name.toLowerCase(), v.id as string]))
      const vendorList = (vendors ?? []).map((v) => `${v.name}${(v.aliases as string[] | null)?.length ? ` (also ${(v.aliases as string[]).join(', ')})` : ''}`).join('\n')
      const counts = { linked: 0, asked: 0, none: 0 }
      while (Date.now() - started < TIME_BUDGET_MS) {
        const { data: lines, error } = await db.rpc('show_line_queue', { p_org: org, p_limit: 80 })
        if (error) throw new Error(error.message)
        const list = (lines ?? []) as { line_id: string; name: string; exhibitors: string | null; shows: string | null; booth_mates: string | null }[]
        if (!list.length) break
        const readings = new Map((await matchShowLines(db, org, vendorList, list.map((l) => ({ id: l.line_id, name: l.name, exhibitors: l.exhibitors, shows: l.shows, booth_mates: l.booth_mates })))).map((r) => [r.id, r]))
        for (const l of list) {
          const r = readings.get(l.line_id)
          const vendorId = r?.vendor_name ? byName.get(r.vendor_name.toLowerCase()) ?? null : null
          const { data: res, error: e2 } = await db.rpc('show_line_apply', { p_line: l.line_id, p_vendor: vendorId, p_sure: !!r?.sure })
          if (e2) throw new Error(e2.message)
          counts[(res as 'linked' | 'asked' | 'none') ?? 'none'] = (counts[(res as 'linked' | 'asked' | 'none') ?? 'none'] ?? 0) + 1
        }
      }
      // booth-mates: a vendor with no rep group in a booth with a rep group's lines (Dana, Oct 12)
      const { data: cards } = await db.rpc('show_booth_rep_cards', { p_org: org })
      const { count } = await db.from('vendor_directory').select('id', { count: 'exact', head: true }).eq('organization_id', org).is('matched_vendor_id', null).is('show_match_read_at', null)
      out[org] = { ...counts, booth_cards: cards, left: count }
    }
    return json(out)
  } catch (e) {
    return errorResponse(e)
  }
})
