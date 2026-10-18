// lightspeed: Settings → Lightspeed (Dana, Oct 13). Admin only.
//   { action: 'status' }                         → what is set and connected (never the secret or tokens)
//   { action: 'save_client', client_id, client_secret }
//   { action: 'authorize', access: 'read'|'full' } → the Lightspeed sign-in address (with a one-time state)
//   { action: 'exchange', code, state }          → after Dana approves in LS: tokens saved, account read, items counted
//   { action: 'test' }                           → reads the account and counts the items again
//   { action: 'disconnect' }                     → forgets the sign-in (the Client ID and Secret stay)
// Editors (admin, manager, buyer), once connected (Dana, Oct 13: one PO number, [VENDOR][MMDDYY] in LS's Reference #):
//   { action: 'sync_vendors' }                   → LS's vendors into VMS, matched to ours by name
//   { action: 'create_po', order_id, shop_id? }  → the empty PO in LS for the order's vendor and store; our PO on the order
//   { action: 'send_items', ls_po_id }           → the approved LS PO draft's items onto that PO in LS
//   { action: 'scan_items' }                     → read every LS item again now (counts per vendor; Dana, Oct 16)
//   { action: 'item_change_write', change_id }   → a Review decision on an unavailable item into LS: * or ** and a dated note line
//   { action: 'scan_status' }                    → the running or last reading
// pg_cron (header x-cron-secret), every 2 minutes: carries on a reading, or starts one when the last is a week old.
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { LS_API, LS_AUTHORIZE, LS_REDIRECT, LS_SCOPE_FULL, LS_SCOPE_READ, asList, lsAccessToken, lsGet, lsGetAll, lsPost, lsPut, lsTokenRequest, saveTokens } from '../_shared/lightspeed.ts'
import type { Caller } from '../_shared/caller.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      const { data: conns } = await db.from('lightspeed_connections').select('organization_id').not('refresh_token', 'is', null)
      const out = []
      for (const c of conns ?? []) out.push(await scanItems(db, c.organization_id, false).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })))
      return json(out)
    }
    const me = await caller(req, db)
    const org = me.organization_id
    const body = await req.json().catch(() => ({})) as { action?: string; client_id?: string; client_secret?: string; access?: string; code?: string; state?: string; order_id?: string; shop_id?: string; ls_po_id?: string; change_id?: string }

    // the buyers' steps
    if (body.action === 'scan_status') {
      const { data } = await db.from('ls_item_scans').select('started_at, finished_at, pages, items, archived, no_vendor, last_error').eq('organization_id', org).maybeSingle()
      return json(data ?? {})
    }
    if (body.action === 'sync_vendors' || body.action === 'create_po' || body.action === 'send_items' || body.action === 'scan_items' || body.action === 'item_change_write') {
      if (!['admin', 'manager', 'buyer'].includes(me.role)) throw new HttpError(403, 'Only admins, managers and buyers do this')
      if (body.action === 'item_change_write') return json(await writeItemChange(db, org, String(body.change_id ?? '')))
      if (body.action === 'scan_items') return json(await scanItems(db, org, true))
      if (body.action === 'sync_vendors') return json(await syncVendors(db, org))
      if (body.action === 'create_po') return json(await createPo(db, me, String(body.order_id ?? ''), body.shop_id ?? null))
      return json(await sendItems(db, me, String(body.ls_po_id ?? '')))
    }
    if (me.role !== 'admin') throw new HttpError(403, 'Only the admin connects Lightspeed')

    if (body.action === 'save_client') {
      const id = String(body.client_id ?? '').trim(), secret = String(body.client_secret ?? '').trim()
      if (id.length < 8 || secret.length < 8) throw new HttpError(400, 'Paste both the Client ID and the Client Secret')
      const { error } = await db.from('lightspeed_connections').upsert({
        organization_id: org, client_id: id, client_secret: secret,
        // a new client means a new sign-in
        access_token: null, refresh_token: null, access_expires_at: null, connected_at: null, last_error: null,
      })
      if (error) throw new Error(error.message)
      return json(await status(db, org))
    }

    if (body.action === 'authorize') {
      const { data: c } = await db.from('lightspeed_connections').select('client_id').eq('organization_id', org).maybeSingle()
      if (!c?.client_id) throw new HttpError(400, 'Save the Client ID and Secret first')
      const state = crypto.randomUUID()
      const scope = body.access === 'full' ? LS_SCOPE_FULL : LS_SCOPE_READ
      // LS's token answer carries no scope, so the access asked for here is what Settings shows after the sign-in
      await db.from('lightspeed_connections').update({ oauth_state: state, oauth_state_at: new Date().toISOString(), oauth_scope: scope }).eq('organization_id', org)
      const url = `${LS_AUTHORIZE}?${new URLSearchParams({ response_type: 'code', client_id: c.client_id, scope, state, redirect_uri: LS_REDIRECT })}`
      return json({ url })
    }

    if (body.action === 'exchange') {
      const { data: c } = await db.from('lightspeed_connections').select('client_id, client_secret, oauth_state, oauth_state_at, oauth_scope').eq('organization_id', org).maybeSingle()
      if (!c?.client_id || !c.client_secret) throw new HttpError(400, 'Save the Client ID and Secret first')
      const fresh = c.oauth_state_at && Date.now() - new Date(c.oauth_state_at).getTime() < 30 * 60_000
      if (!body.state || body.state !== c.oauth_state || !fresh) throw new HttpError(400, 'This sign-in link is old. Click Connect to Lightspeed again.')
      if (!body.code) throw new HttpError(400, 'Lightspeed did not send a sign-in code')
      try {
        const t = await lsTokenRequest({ grant_type: 'authorization_code', code: body.code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: LS_REDIRECT })
        await db.from('lightspeed_connections').update({ oauth_state: null, oauth_scope: null, connected_at: new Date().toISOString(), connected_by: me.id, scope: t.scope ?? c.oauth_scope ?? null }).eq('organization_id', org)
        await saveTokens(db, org, t)
      } catch (e) {
        await db.from('lightspeed_connections').update({ oauth_state: null, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', org)
        throw e
      }
      await check(db, org)
      return json(await status(db, org))
    }

    if (body.action === 'test') {
      await check(db, org)
      return json(await status(db, org))
    }

    if (body.action === 'disconnect') {
      await db.from('lightspeed_connections').update({ access_token: null, refresh_token: null, access_expires_at: null, connected_at: null, account_id: null, account_name: null, item_count: null }).eq('organization_id', org)
      return json(await status(db, org))
    }

    return json(await status(db, org))
  } catch (e) {
    return errorResponse(e)
  }
})

/** Read the account and count the items: proves the connection works. Errors are kept for the page. */
async function check(db: SupabaseClient, org: string) {
  try {
    const { token } = await lsAccessToken(db, org)
    const acct = await lsGet<{ Account?: { accountID: string; name: string } | { accountID: string; name: string }[] }>(token, '/Account.json')
    const a = Array.isArray(acct.Account) ? acct.Account[0] : acct.Account
    if (!a?.accountID) throw new Error('Lightspeed did not return the account')
    const items = await lsGet<{ '@attributes'?: { count?: string } }>(token, `/Account/${a.accountID}/Item.json?count=1&archived=false`)
    await db.from('lightspeed_connections').update({
      account_id: String(a.accountID), account_name: a.name, item_count: Number(items['@attributes']?.count ?? 0) || null, checked_at: new Date().toISOString(), last_error: null,
    }).eq('organization_id', org)
  } catch (e) {
    await db.from('lightspeed_connections').update({ checked_at: new Date().toISOString(), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', org)
  }
}

/** LS's vendors into VMS (for matching and the picker), then match ours by name where exactly one fits. */
async function syncVendors(db: SupabaseClient, org: string) {
  const { token } = await lsAccessToken(db, org)
  const vendors = await lsGetAll<{ vendorID: string; name: string; archived?: string }>(token, '/Account/' + (await accountId(db, org)) + '/Vendor.json', 'Vendor')
  const rows = vendors.map((v) => ({ organization_id: org, ls_vendor_id: String(v.vendorID), name: v.name, archived: v.archived === 'true', synced_at: new Date().toISOString() }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('ls_vendors').upsert(rows.slice(i, i + 500))
    if (error) throw new Error(error.message)
  }
  const { data: matched } = await db.rpc('ls_vendors_match', { p_org: org })
  return { vendors: rows.length, matched: matched ?? 0 }
}

// LS allows about one request a second; a run reads for about 25 seconds (on Oct 16 the other scheduled calls waited
// in pg_net while a 100-second run went) and keeps its place for the next one.
const SCAN_BUDGET_MS = 25_000
const SCAN_PAUSE_MS = 600
const SCAN_EVERY_DAYS = 7

interface Scan { started_at: string | null; finished_at: string | null; cursor: string | null; pages: number; items: number; archived: number; no_vendor: number; counts: Record<string, [number, number]>; last_error: string | null }

/**
 * Read every LS item (active and archived) with its vendor, a page at a time, and count them per LS vendor. Fresh: start
 * over now (unless a reading is under way). Otherwise carry on a reading, or start one when the last is a week old.
 * When the last page is in, the counts go onto LS vendors and our vendors (ls_items_apply).
 */
async function scanItems(db: SupabaseClient, org: string, fresh: boolean) {
  const now = new Date()
  await db.from('ls_item_scans').upsert({ organization_id: org }, { onConflict: 'organization_id', ignoreDuplicates: true })
  // one run at a time
  const { data: claimed } = await db.from('ls_item_scans').update({ lock_until: new Date(now.getTime() + 150_000).toISOString() })
    .eq('organization_id', org).or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`).select('*').maybeSingle()
  if (!claimed) return { busy: true }
  let s = claimed as Scan
  const running = !!s.started_at && !s.finished_at
  const stale = !s.finished_at || now.getTime() - new Date(s.finished_at).getTime() > SCAN_EVERY_DAYS * 86_400_000
  if (!running && (fresh || stale)) {
    s = { started_at: now.toISOString(), finished_at: null, cursor: null, pages: 0, items: 0, archived: 0, no_vendor: 0, counts: {}, last_error: null }
  } else if (!running) {
    await db.from('ls_item_scans').update({ lock_until: null }).eq('organization_id', org)
    return { started_at: s.started_at, finished_at: s.finished_at, pages: s.pages, items: s.items, archived: s.archived, no_vendor: s.no_vendor }
  }
  const save = (extra: Record<string, unknown> = {}) => db.from('ls_item_scans').update({ ...s, ...extra, updated_at: new Date().toISOString() }).eq('organization_id', org)
  try {
    const { token } = await lsAccessToken(db, org)
    let url: string | null = s.cursor ?? `/Account/${await accountId(db, org)}/Item.json?archived=true&limit=100`
    while (url && Date.now() - now.getTime() < SCAN_BUDGET_MS) {
      const body: Record<string, unknown> = await lsGet<Record<string, unknown>>(token, url)
      for (const it of asList(body.Item as { defaultVendorID?: string; archived?: string } | { defaultVendorID?: string; archived?: string }[] | undefined)) {
        const vid = String(it.defaultVendorID ?? '0')
        const gone = String(it.archived) === 'true'
        s.items++
        if (gone) s.archived++
        if (vid === '0' || vid === '') { s.no_vendor++; continue }
        const c = s.counts[vid] ?? [0, 0]
        c[gone ? 1 : 0]++
        s.counts[vid] = c
      }
      s.pages++
      const next = (body['@attributes'] as { next?: string } | undefined)?.next
      url = next ? next.replace(LS_API, '') : null
      s.cursor = url
      if (s.pages % 10 === 0) await save()
      if (url) await new Promise((r) => setTimeout(r, SCAN_PAUSE_MS))
    }
    if (!url) s.finished_at = new Date().toISOString()
    await save({ lock_until: null })
    const applied = s.finished_at ? (await db.rpc('ls_items_apply', { p_org: org })).data : null
    return { started_at: s.started_at, finished_at: s.finished_at, pages: s.pages, items: s.items, archived: s.archived, no_vendor: s.no_vendor, vendors: applied }
  } catch (e) {
    // a slow-down from LS is not an error: the next run carries on from the same page
    const msg = e instanceof Error ? e.message : String(e)
    await save({ lock_until: null, last_error: /Lightspeed 429/.test(msg) ? null : msg.slice(0, 500) })
    return { started_at: s.started_at, finished_at: null, pages: s.pages, items: s.items, error: msg }
  }
}

// ---- unavailable items (Dana, Oct 18): the Review decision written to LS ------------------------------------------

const NO_FULL_ACCESS = 'Lightspeed needs Full access first: Settings › Lightspeed, choose Full, Connect again.'

/** "*COGHLANS …" → "*", "**ROOSTER …" → "**", else "". */
const markerOf = (name: string) => /^\*{1,2}/.exec(name.trimStart())?.[0] ?? ''

/**
 * Write one decided item change to LS: * (discontinued or replaced) or ** (DNR) at the start of the name, an existing **
 * kept; the dated note line on top of the item's note (newest first). A note that prints on customer receipts is left
 * alone. LS is read back afterwards, and the change counts as written only when LS shows it.
 */
async function writeItemChange(db: SupabaseClient, org: string, changeId: string) {
  const { data: ch } = await db.from('item_changes').select('*, vendor:vendors(lightspeed_vendor_id)').eq('id', changeId).maybeSingle()
  if (!ch || ch.organization_id !== org) throw new HttpError(404, 'Item not found')
  if (!ch.decision || ch.decision === 'leave' || ch.decision === 'find_replacement') return { status: 'not_needed' }
  const result = async (status: string, error: string | null, item?: string | null, name?: string | null) => {
    await db.rpc('item_change_ls_result', { p_change: changeId, p_status: status, p_error: error, p_ls_item: item ?? null, p_ls_name: name ?? null })
    return { status, error }
  }
  const { data: conn } = await db.from('lightspeed_connections').select('scope').eq('organization_id', org).maybeSingle()
  if (!String(conn?.scope ?? '').split(/\s+/).includes('employee:all')) return result('no_access', NO_FULL_ACCESS)

  // the item in LS: the one found when Claude read the confirmation, else by the vendor's LS vendor and the Vendor ID
  let itemId: string | null = ch.ls_item_id
  const lsVendor = (ch.vendor as { lightspeed_vendor_id: string | null } | null)?.lightspeed_vendor_id ?? null
  if (!itemId && lsVendor && ch.vendor_item_id) {
    const { data: hit } = await db.from('ls_items').select('item_id').eq('organization_id', org).eq('default_vendor_id', lsVendor).ilike('vendor_item_id', ch.vendor_item_id).order('archived').limit(1)
    itemId = hit?.[0]?.item_id ?? null
  }
  if (!itemId) return result('no_item', `${ch.vendor_item_id ?? ch.item_name ?? 'This item'} is not in Lightspeed under this vendor. The decision is kept in VMS.`)

  try {
    const { token } = await lsAccessToken(db, org)
    const path = `/Account/${await accountId(db, org)}/Item/${itemId}.json`
    type LsItem = { description?: string; Note?: { note?: string; isPublic?: string } }
    const read = async () => (await lsGet<{ Item?: LsItem }>(token, `${path}?load_relations=${encodeURIComponent('["Note"]')}`)).Item ?? {}
    const now = await read()
    const name = String(now.description ?? '')
    // Don't need (a report dead end, Dana Oct 18) keeps the marker the item already has; only the note line is added
    const want = ch.decision === 'dnr' ? '**' : ch.decision === 'out_of_stock' || ch.decision === 'dont_need' ? '' : '*'
    const has = markerOf(name)
    const marker = has === '**' ? '**' : want || has
    const newName = marker ? marker + name.trimStart().replace(/^\*{1,2}\s*/, '') : name
    const oldNote = String(now.Note?.note ?? '').trim()
    const publicNote = String(now.Note?.isPublic) === 'true' && !!oldNote
    const line = String(ch.note_line ?? '')
    const update: Record<string, unknown> = {}
    if (newName !== name) update.description = newName
    if (line && !publicNote) update.Note = { note: oldNote ? `${line}\n${oldNote}` : line, isPublic: 'false' }
    if (!Object.keys(update).length) {
      return result('failed', publicNote ? 'This item\'s note prints on customer receipts, so VMS did not add to it. The decision is kept in VMS.' : 'Nothing to change in Lightspeed.', itemId, name)
    }
    await lsPut(token, path, update)
    const after = await read()
    const nameOk = !('description' in update) || String(after.description ?? '') === newName
    const noteOk = !('Note' in update) || String(after.Note?.note ?? '').trim().startsWith(line)
    if (!nameOk || !noteOk) {
      return result('failed', `Lightspeed took the change but does not show it: the name reads "${after.description ?? ''}"${'Note' in update ? `, the note starts "${String(after.Note?.note ?? '').slice(0, 60)}"` : ''}.`, itemId, String(after.description ?? name))
    }
    return result('written', publicNote ? 'Marker written. The item\'s note prints on customer receipts, so the note line is kept in VMS only.' : null, itemId, newName)
  } catch (e) {
    return result('failed', (e instanceof Error ? e.message : String(e)).slice(0, 400), itemId)
  }
}

async function accountId(db: SupabaseClient, org: string): Promise<string> {
  const { data } = await db.from('lightspeed_connections').select('account_id').eq('organization_id', org).maybeSingle()
  if (!data?.account_id) throw new HttpError(400, 'Check the Lightspeed connection in Settings first')
  return data.account_id
}

const LS_DATE = (d: string | null) => `${d ?? new Date().toISOString().slice(0, 10)}T12:00:00-07:00`

/**
 * The empty PO in LS for an order: its vendor (matched in LS), the store, Reference # = our PO ([CODE][MMDDYY]). The PO
 * goes on the order (po_number); that drafts the email asking the vendor to add it and closes the Create PO task.
 */
async function createPo(db: SupabaseClient, me: Caller, orderId: string, shopId: string | null) {
  const org = me.organization_id
  const { data: o } = await db.from('orders').select('id, organization_id, vendor_id, po_number, order_date, store_codes, ls_order_id, vendor:vendors!orders_vendor_id_fkey(name, lightspeed_vendor_id)').eq('id', orderId).maybeSingle()
  if (!o || o.organization_id !== org) throw new HttpError(404, 'Order not found')
  if (o.ls_order_id) throw new HttpError(409, `This order already has its PO in Lightspeed (${o.po_number ?? ''})`)
  const vendor = o.vendor as unknown as { name: string; lightspeed_vendor_id: string | null } | null
  if (!vendor?.lightspeed_vendor_id) throw new HttpError(400, `Pick ${vendor?.name ?? 'the vendor'} in Lightspeed first: on the vendor page, "In Lightspeed as"`)
  let shop = shopId
  if (!shop) {
    const code = (o.store_codes as string[] | null)?.[0] ?? 'SLS'
    shop = (await db.from('stores').select('ls_shop_id').eq('organization_id', org).eq('code', code).maybeSingle()).data?.ls_shop_id ?? '3'
  }
  const real = (p: string | null) => !!p && p.replace(/[^A-Za-z0-9]/g, '').length >= 3 && !/^\s*(n\/?a|none|tbd|pending|na|no po)\s*$/i.test(p)
  let po = o.po_number
  if (!real(po)) {
    const { data: next, error } = await db.rpc('po_number_next', { p_order: o.id })
    if (error || !next) throw new Error(error?.message ?? 'Could not make the PO number')
    po = next as string
  }
  const { token } = await lsAccessToken(db, org)
  const acct = await accountId(db, org)
  const made = await lsPost<{ Order?: { orderID: string } }>(token, `/Account/${acct}/Order.json`, {
    vendorID: vendor.lightspeed_vendor_id, shopID: shop, refNum: po, orderedDate: LS_DATE(o.order_date), complete: false,
  })
  const lsId = made.Order?.orderID
  if (!lsId) throw new Error('Lightspeed did not return the new PO')
  const { error } = await db.from('orders').update({ po_number: po, ls_order_id: String(lsId), ls_shop_id: shop }).eq('id', o.id)
  if (error) throw new Error(`The PO was made in LS (${po}) but not saved on the order: ${error.message}`)
  return { po_number: po, ls_order_id: String(lsId), shop_id: shop }
}

interface DraftLine { vid: string | null; upc: string | null; desc: string; qty: number; cost: number | null; system_id: string | null; name: string; is_new: boolean; ls_item_id?: string | null; ls_line_id?: string | null }

/**
 * The approved draft's items onto the order's PO in LS (making the PO first when there is none). Each line is found in
 * LS by System ID, else Vendor ID (manufacturer SKU), else UPC. Lines already sent are skipped, so it can run again after
 * new items are added in LS by hand. All sent → the draft is done and the PO is on the order.
 */
async function sendItems(db: SupabaseClient, me: Caller, lsPoId: string) {
  const org = me.organization_id
  const { data: p } = await db.from('ls_pos').select('id, organization_id, order_id, status, lines, reviewer_id').eq('id', lsPoId).maybeSingle()
  if (!p || p.organization_id !== org) throw new HttpError(404, 'LS PO not found')
  if (!['to_review', 'ready'].includes(p.status)) throw new HttpError(400, 'Approve it first')
  if (me.role !== 'admin' && me.id !== p.reviewer_id) throw new HttpError(403, 'Only the LS PO reviewer or the admin sends it to Lightspeed')
  let { data: o } = await db.from('orders').select('id, po_number, ls_order_id').eq('id', p.order_id).single()
  if (!o?.ls_order_id) {
    await createPo(db, me, p.order_id, null)
    o = (await db.from('orders').select('id, po_number, ls_order_id').eq('id', p.order_id).single()).data
  }
  const { token } = await lsAccessToken(db, org)
  const acct = await accountId(db, org)
  const lines = (p.lines ?? []) as DraftLine[]
  const started = Date.now()
  const missing: string[] = []
  let added = 0
  for (const l of lines) {
    if (l.ls_line_id || !(l.qty > 0)) continue
    if (Date.now() - started > 110_000) break
    if (!l.ls_item_id) l.ls_item_id = await findItem(token, acct, l)
    if (!l.ls_item_id) { missing.push(`${l.vid ?? ''} ${l.name || l.desc}`.trim()); continue }
    const res = await lsPost<{ OrderLine?: { orderLineID: string } }>(token, `/Account/${acct}/OrderLine.json`, {
      orderID: o!.ls_order_id, itemID: l.ls_item_id, quantity: l.qty, ...(l.cost !== null ? { price: l.cost, originalPrice: l.cost } : {}),
    })
    l.ls_line_id = res.OrderLine?.orderLineID ? String(res.OrderLine.orderLineID) : 'sent'
    added++
    // keep progress after every line, so a second click never adds a line twice
    await db.from('ls_pos').update({ lines }).eq('id', p.id)
  }
  const left = lines.filter((l) => l.qty > 0 && !l.ls_line_id)
  const done = left.length === 0
  await db.from('ls_pos').update({
    lines, status: done ? 'sent' : 'ready', ls_po_number: done ? o!.po_number : null, sent_at: done ? new Date().toISOString() : null,
    reviewed_by: me.id, reviewed_at: new Date().toISOString(),
    draft_note: done ? `In Lightspeed as ${o!.po_number}: ${lines.filter((l) => l.ls_line_id).length} items.`
      : `${added} added to ${o!.po_number} in Lightspeed. Not in LS yet (add them in LS, then Send again): ${missing.slice(0, 20).join('; ')}${missing.length > 20 ? ` and ${missing.length - 20} more` : ''}`,
  }).eq('id', p.id)
  return { po_number: o!.po_number, added, missing, done }
}

/** The LS item for a draft line: System ID, else Vendor ID (manufacturer SKU, also with leading zeros dropped), else UPC. */
async function findItem(token: string, acct: string, l: DraftLine): Promise<string | null> {
  const tries: [string, string][] = []
  if (l.system_id) tries.push(['systemSku', l.system_id])
  if (l.vid) { tries.push(['manufacturerSku', l.vid]); const nz = l.vid.replace(/^0+(?=\d)/, ''); if (nz !== l.vid) tries.push(['manufacturerSku', nz]) }
  if (l.upc) tries.push(['upc', l.upc])
  for (const [field, value] of tries) {
    const r = await lsGet<{ Item?: { itemID: string; archived?: string } | { itemID: string; archived?: string }[] }>(token, `/Account/${acct}/Item.json?${field}=${encodeURIComponent(value)}&archived=false`)
    const hits = asList(r.Item)
    if (hits.length === 1) return String(hits[0]!.itemID)
  }
  return null
}

/** What the page may see: never the secret or the tokens. */
async function status(db: SupabaseClient, org: string) {
  const { data: c } = await db.from('lightspeed_connections').select('client_id, client_secret, scope, account_id, account_name, refresh_token, connected_at, checked_at, item_count, last_error, connected_by').eq('organization_id', org).maybeSingle()
  let by: string | null = null
  if (c?.connected_by) by = (await db.from('profiles').select('full_name').eq('id', c.connected_by).maybeSingle()).data?.full_name ?? null
  return {
    client_id: c?.client_id ? `…${c.client_id.slice(-6)}` : null, secret_saved: !!c?.client_secret,
    connected: !!c?.refresh_token, connected_at: c?.connected_at ?? null, connected_by: by,
    read_only: c?.scope ? !/employee:all/.test(c.scope) : null,
    account_id: c?.account_id ?? null, account_name: c?.account_name ?? null, item_count: c?.item_count ?? null,
    checked_at: c?.checked_at ?? null, last_error: c?.last_error ?? null, redirect_uri: 'https://vms.shaverlakesports.com/integrations/lightspeed/callback',
  }
}
