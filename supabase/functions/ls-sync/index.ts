// ls-sync: Lightspeed's items and sales copied into VMS for the Sales Reports page (Dana, Oct 16: reports from LS
// replace LS Analytics). Runs every minute from pg_cron (header x-cron-secret). Each run takes a slice of the item pass
// (every item with stock per shop and its Vendor ID; a full pass every 6 hours), then a slice of the sales and sale-line
// passes (a 24-month backfill from the oldest forward, then whatever changed since the last run). A cursor (LS's "next"
// link) is kept so a run picks up where the last stopped. Once that copy is complete, an older pass brings in everything
// before it (Dana, Oct 17: back to May 2020, to compare a big snow year with a slow one). Reading only; nothing in LS changes.
//   { }                     → the scheduler's slice
//   { probe: '<path>' }     → trusted only: one GET, the first record (to learn the API's shapes)
//   { reset_items: true }   → trusted only: start a full item pass now
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { LS_API, asList, lsAccessToken, lsGet } from '../_shared/lightspeed.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
const BUDGET_MS = 40_000
const PAGE_PAUSE_MS = 1_100            // LS refills about one request a second; Opus's item count shares the same bucket
const ITEMS_EVERY_MS = 6 * 3_600_000   // stock per shop is at most this old

type Sync = {
  organization_id: string; items_cursor: string | null; items_pass_started: string | null; items_pass_finished: string | null; items_seen: number
  sales_cursor: string | null; sales_since: string | null; sales_backfill_done: boolean
  lines_cursor: string | null; lines_since: string | null; lines_backfill_done: boolean; lines_seen: number
  backfill_from: string; last_error: string | null; lock_until: string | null
  older_to: string | null; older_sales_cursor: string | null; older_lines_cursor: string | null; older_sales_done: boolean; older_lines_done: boolean; older_rows: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (!trusted) return json({ error: 'Not allowed' }, 403)
    const body = await req.json().catch(() => ({})) as { probe?: string; reset_items?: boolean }
    const { data: conns } = await db.from('lightspeed_connections').select('organization_id, account_id').not('refresh_token', 'is', null)
    const out: unknown[] = []
    for (const c of conns ?? []) {
      if (!c.account_id) continue
      if (body.probe) {
        const { token } = await lsAccessToken(db, c.organization_id)
        const path = body.probe.replace('{acct}', c.account_id)
        const res = await lsGet<Record<string, unknown>>(token, path)
        const key = Object.keys(res).find((k) => k !== '@attributes')
        const list = key ? asList(res[key] as unknown) : []
        out.push({ path, attrs: res['@attributes'], key, count: list.length, first: list[0] ?? null, second: list[1] ?? null })
        continue
      }
      if (body.reset_items) await db.from('ls_sync').upsert({ organization_id: c.organization_id, items_cursor: null, items_pass_started: null, items_pass_finished: null }, { onConflict: 'organization_id' })
      out.push(await syncSlice(db, c.organization_id, c.account_id))
    }
    return json(out)
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

const str = (v: unknown) => (v == null ? '' : String(v))
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const bool = (v: unknown) => String(v) === 'true'
/** LS's filter syntax: timeStamp >= a moment, URL-safe. */
const since = (iso: string) => encodeURIComponent(`>=,${iso.replace(/\.\d+Z$/, 'Z')}`)
/** LS's filter syntax: timeStamp before a moment (the older pass). */
const before = (iso: string) => encodeURIComponent(`<,${iso.replace(/\.\d+Z$/, 'Z')}`)

async function syncSlice(db: SupabaseClient, org: string, acct: string) {
  const now = new Date()
  // one run at a time per organization; a lock older than three minutes is assumed dead
  const { data: got } = await db.from('ls_sync').upsert({ organization_id: org }, { onConflict: 'organization_id', ignoreDuplicates: true }).select('organization_id')
  void got
  const { data: claimed } = await db.from('ls_sync').update({ lock_until: new Date(now.getTime() + 180_000).toISOString() })
    .eq('organization_id', org).or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`).select('*').maybeSingle()
  if (!claimed) return { org, busy: true }
  const s = claimed as Sync
  const result: Record<string, unknown> = { org }
  const save = (fields: Partial<Sync>) => db.from('ls_sync').update({ ...fields, updated_at: new Date().toISOString() }).eq('organization_id', org)
  try {
    const { token } = await lsAccessToken(db, org)
    const base = `/Account/${acct}`
    const deadline = now.getTime() + BUDGET_MS

    // ---- items: a full pass every six hours (stock per shop changes with every sale) -------------------------------
    const itemsRunning = !!s.items_pass_started && !s.items_pass_finished
    const itemsDue = !s.items_pass_finished || now.getTime() - new Date(s.items_pass_finished).getTime() > ITEMS_EVERY_MS
    if (itemsRunning || itemsDue) {
      if (!itemsRunning) { s.items_pass_started = now.toISOString(); s.items_pass_finished = null; s.items_cursor = null; s.items_seen = 0 }
      let url: string | null = s.items_cursor ?? `${base}/Item.json?limit=100&archived=true&load_relations=${encodeURIComponent('["ItemShops","Category","ItemVendorNums","Note"]')}&sort=itemID`
      let pages = 0
      while (url && Date.now() < deadline) {
        const page = await lsGet<Record<string, unknown>>(token, url)
        const rows = asList(page.Item as unknown).map((it) => itemRow(org, it as Record<string, unknown>))
        if (rows.length) { const { error } = await db.from('ls_items').upsert(rows, { onConflict: 'organization_id,item_id' }); if (error) throw new Error(`items: ${error.message}`) }
        s.items_seen += rows.length
        pages++
        const next = (page['@attributes'] as { next?: string } | undefined)?.next
        url = next ? next.replace(LS_API, '') : null
        s.items_cursor = url
        if (!url) s.items_pass_finished = new Date().toISOString()
        await save({ items_cursor: s.items_cursor, items_pass_started: s.items_pass_started, items_pass_finished: s.items_pass_finished, items_seen: s.items_seen })
        if (url) await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS))
      }
      result.items = { pages, seen: s.items_seen, finished: !!s.items_pass_finished }
    }

    // ---- sales (completed / voided per sale) and sale lines: backfill from 24 months ago, then what changed --------
    for (const kind of ['sales', 'lines'] as const) {
      if (Date.now() >= deadline) break
      const cursorKey = kind === 'sales' ? 'sales_cursor' : 'lines_cursor'
      const sinceKey = kind === 'sales' ? 'sales_since' : 'lines_since'
      const doneKey = kind === 'sales' ? 'sales_backfill_done' : 'lines_backfill_done'
      const from = s[sinceKey] ?? s.backfill_from
      let url: string | null = s[cursorKey] ?? `${base}/${kind === 'sales' ? 'Sale' : 'SaleLine'}.json?limit=100&sort=timeStamp&timeStamp=${since(from)}`
      let pages = 0, rows = 0, newest = s[sinceKey]
      while (url && Date.now() < deadline) {
        const page = await lsGet<Record<string, unknown>>(token, url)
        const list = asList(page[kind === 'sales' ? 'Sale' : 'SaleLine'] as unknown) as Record<string, unknown>[]
        if (list.length) {
          if (kind === 'sales') {
            const { error } = await db.from('ls_sales').upsert(list.map((x) => saleRow(org, x)), { onConflict: 'organization_id,sale_id' })
            if (error) throw new Error(`sales: ${error.message}`)
          } else {
            const { error } = await db.from('ls_sale_lines').upsert(list.map((x) => lineRow(org, x)), { onConflict: 'organization_id,sale_line_id' })
            if (error) throw new Error(`lines: ${error.message}`)
            s.lines_seen += list.length
          }
          for (const x of list) { const t = str(x.timeStamp); if (t && (!newest || t > newest)) newest = t }
        }
        rows += list.length
        pages++
        const next = (page['@attributes'] as { next?: string } | undefined)?.next
        url = next ? next.replace(LS_API, '') : null
        const fields: Partial<Sync> = { [cursorKey]: url } as Partial<Sync>
        if (!url) {
          // the pass is complete: the next run asks for what changed since the newest moment seen (minus a second)
          const next = newest ? new Date(new Date(newest).getTime() - 1000).toISOString() : from
          ;(fields as Record<string, unknown>)[sinceKey] = next
          ;(fields as Record<string, unknown>)[doneKey] = true
          s[sinceKey] = next
        }
        if (kind === 'lines') fields.lines_seen = s.lines_seen
        await save(fields)
        if (url) await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS))
      }
      result[kind] = { pages, rows, backfill_done: !url ? true : s[doneKey], since: s[sinceKey] }
    }

    // ---- the older pass: everything before the first copy's start, once that copy is complete ---------------------
    if (s.older_to && s.sales_backfill_done && s.lines_backfill_done) {
      for (const kind of ['sales', 'lines'] as const) {
        if (Date.now() >= deadline) break
        const cursorKey = kind === 'sales' ? 'older_sales_cursor' : 'older_lines_cursor'
        const doneKey = kind === 'sales' ? 'older_sales_done' : 'older_lines_done'
        if (s[doneKey]) continue
        let url: string | null = s[cursorKey] ?? `${base}/${kind === 'sales' ? 'Sale' : 'SaleLine'}.json?limit=100&sort=timeStamp&timeStamp=${before(s.older_to)}`
        let pages = 0, rows = 0
        while (url && Date.now() < deadline) {
          const page = await lsGet<Record<string, unknown>>(token, url)
          const list = asList(page[kind === 'sales' ? 'Sale' : 'SaleLine'] as unknown) as Record<string, unknown>[]
          if (list.length) {
            const { error } = kind === 'sales'
              ? await db.from('ls_sales').upsert(list.map((x) => saleRow(org, x)), { onConflict: 'organization_id,sale_id' })
              : await db.from('ls_sale_lines').upsert(list.map((x) => lineRow(org, x)), { onConflict: 'organization_id,sale_line_id' })
            if (error) throw new Error(`older ${kind}: ${error.message}`)
            if (kind === 'lines') s.lines_seen += list.length
          }
          rows += list.length
          pages++
          s.older_rows += list.length
          const next = (page['@attributes'] as { next?: string } | undefined)?.next
          url = next ? next.replace(LS_API, '') : null
          const fields: Partial<Sync> = { [cursorKey]: url, older_rows: s.older_rows, lines_seen: s.lines_seen } as Partial<Sync>
          if (!url) { (fields as Record<string, unknown>)[doneKey] = true; s[doneKey] = true }
          await save(fields)
          if (url) await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS))
        }
        result[`older_${kind}`] = { pages, rows, done: s[doneKey] }
      }
    }
    await save({ lock_until: null, last_error: null })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // a slow-down from LS is not an error: the next run carries on from the same cursor
    await save({ lock_until: null, last_error: /Lightspeed 429/.test(msg) ? null : msg.slice(0, 500) })
    return { ...result, error: msg }
  }
}

function itemRow(org: string, it: Record<string, unknown>) {
  const shops = asList((it.ItemShops as { ItemShop?: unknown } | undefined)?.ItemShop) as Record<string, unknown>[]
  const qoh: Record<string, number> = {}
  for (const sh of shops) qoh[str(sh.shopID)] = num(sh.qoh)
  const vendorNums = asList((it.ItemVendorNums as { ItemVendorNum?: unknown } | undefined)?.ItemVendorNum) as Record<string, unknown>[]
  const vendorId = str(it.defaultVendorID) === '0' ? '' : str(it.defaultVendorID)
  const forVendor = vendorNums.find((v) => str(v.vendorID) === vendorId) ?? vendorNums[0]
  const cat = it.Category as Record<string, unknown> | undefined
  const note = it.Note as { note?: unknown; isPublic?: unknown } | undefined   // the item's Note: public prints on the receipt
  return {
    organization_id: org, item_id: str(it.itemID), system_sku: str(it.systemSku), upc: str(it.upc) || str(it.ean), custom_sku: str(it.customSku), manufacturer_sku: str(it.manufacturerSku),
    vendor_item_id: str(forVendor?.value), description: str(it.description), default_cost: it.defaultCost == null ? null : num(it.defaultCost),
    category_id: str(it.categoryID) === '0' ? '' : str(it.categoryID), category_path: str(cat?.fullPathName), default_vendor_id: vendorId,
    archived: bool(it.archived), item_type: str(it.itemType) || 'default', matrix_id: str(it.itemMatrixID) === '0' ? '' : str(it.itemMatrixID),
    qoh, note: str(note?.note).trim(), note_public: bool(note?.isPublic), ls_updated_at: str(it.timeStamp) || null, synced_at: new Date().toISOString(),
  }
}

function saleRow(org: string, x: Record<string, unknown>) {
  return { organization_id: org, sale_id: str(x.saleID), shop_id: str(x.shopID), completed: bool(x.completed), voided: bool(x.voided), sold_at: str(x.completeTime) || str(x.createTime) || null, ls_updated_at: str(x.timeStamp) || null }
}

function lineRow(org: string, x: Record<string, unknown>) {
  return { organization_id: org, sale_line_id: str(x.saleLineID), sale_id: str(x.saleID), item_id: str(x.itemID), shop_id: str(x.shopID), qty: num(x.unitQuantity), sold_at: str(x.createTime) || str(x.timeStamp), ls_updated_at: str(x.timeStamp) || null }
}
