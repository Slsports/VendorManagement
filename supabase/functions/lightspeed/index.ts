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
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { LS_AUTHORIZE, LS_REDIRECT, LS_SCOPE_FULL, LS_SCOPE_READ, asList, lsAccessToken, lsGet, lsGetAll, lsPost, lsTokenRequest, saveTokens } from '../_shared/lightspeed.ts'
import type { Caller } from '../_shared/caller.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const me = await caller(req, db)
    const org = me.organization_id
    const body = await req.json().catch(() => ({})) as { action?: string; client_id?: string; client_secret?: string; access?: string; code?: string; state?: string; order_id?: string; shop_id?: string; ls_po_id?: string }

    // the buyers' steps
    if (body.action === 'sync_vendors' || body.action === 'create_po' || body.action === 'send_items') {
      if (!['admin', 'manager', 'buyer'].includes(me.role)) throw new HttpError(403, 'Only admins, managers and buyers do this')
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
      await db.from('lightspeed_connections').update({ oauth_state: state, oauth_state_at: new Date().toISOString() }).eq('organization_id', org)
      const url = `${LS_AUTHORIZE}?${new URLSearchParams({ response_type: 'code', client_id: c.client_id, scope: body.access === 'full' ? LS_SCOPE_FULL : LS_SCOPE_READ, state, redirect_uri: LS_REDIRECT })}`
      return json({ url })
    }

    if (body.action === 'exchange') {
      const { data: c } = await db.from('lightspeed_connections').select('client_id, client_secret, oauth_state, oauth_state_at').eq('organization_id', org).maybeSingle()
      if (!c?.client_id || !c.client_secret) throw new HttpError(400, 'Save the Client ID and Secret first')
      const fresh = c.oauth_state_at && Date.now() - new Date(c.oauth_state_at).getTime() < 30 * 60_000
      if (!body.state || body.state !== c.oauth_state || !fresh) throw new HttpError(400, 'This sign-in link is old. Click Connect to Lightspeed again.')
      if (!body.code) throw new HttpError(400, 'Lightspeed did not send a sign-in code')
      try {
        const t = await lsTokenRequest({ grant_type: 'authorization_code', code: body.code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: LS_REDIRECT })
        await db.from('lightspeed_connections').update({ oauth_state: null, connected_at: new Date().toISOString(), connected_by: me.id }).eq('organization_id', org)
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
