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
//   { action: 'rename_now' }                     → sends approved item names to LS now (item_name_changes; SOP-INV-001-NC)
//   { action: 'receiving_history', item_ids, from, to? } → read only: LS's stock changes for these items between the dates
// pg_cron (header x-cron-secret), every 2 minutes: sends approved item names; with none waiting, carries on a reading,
// or starts one when the last is a week old.
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { LS_API, LS_AUTHORIZE, LS_REDIRECT, LS_SCOPE_FULL, LS_SCOPE_READ, asList, lsAccessToken, lsGet, lsGetAll, lsPost, lsPut, lsTokenRequest, saveTokens } from '../_shared/lightspeed.ts'
import { changeKind, splitMarker } from '../_shared/itemNameSop.ts'
import type { Caller } from '../_shared/caller.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      // a look-up from the scheduler's secret (checking a question from the database side)
      const asked = await req.clone().json().catch(() => ({})) as { action?: string; organization_id?: string; item_ids?: string[]; vendor_ids?: string[]; from?: string; to?: string }
      if (asked.action === 'receiving_history' && asked.organization_id) return json(await receivingHistory(db, asked.organization_id, (asked.item_ids ?? []).map(String), String(asked.from ?? ''), asked.to ?? null))
      if (asked.action === 'purchase_orders' && asked.organization_id) return json(await purchaseOrders(db, asked.organization_id, (asked.vendor_ids ?? []).map(String), String(asked.from ?? '')))
      if (asked.action === 'inventory_adds' && asked.organization_id) return json(await inventoryAdds(db, asked.organization_id, String(asked.from ?? ''), (asked as { cursor?: string | null }).cursor ?? null))
      const { data: conns } = await db.from('lightspeed_connections').select('organization_id').not('refresh_token', 'is', null)
      const out = []
      for (const c of conns ?? []) {
        const renamed = await renameQueue(db, c.organization_id, RENAME_BUDGET_MS).catch((e) => ({ sent: 0, failed: 0, waiting: 0, error: e instanceof Error ? e.message : String(e) }))
        // one slow job per call (pg_net waits on it): the reading carries on once no names are waiting
        if (renamed.sent || renamed.failed) { out.push({ renamed }); continue }
        out.push(await scanItems(db, c.organization_id, false).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })))
      }
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
    if (body.action === 'receiving_history') {
      if (!['admin', 'manager', 'buyer'].includes(me.role)) throw new HttpError(403, 'Only admins, managers and buyers do this')
      const b = body as { item_ids?: string[]; from?: string; to?: string }
      return json(await receivingHistory(db, org, (b.item_ids ?? []).map(String), String(b.from ?? ''), b.to ?? null))
    }
    if (body.action === 'sync_vendors' || body.action === 'create_po' || body.action === 'send_items' || body.action === 'scan_items' || body.action === 'item_change_write' || body.action === 'rename_now') {
      if (!['admin', 'manager', 'buyer'].includes(me.role)) throw new HttpError(403, 'Only admins, managers and buyers do this')
      if (body.action === 'rename_now') return json(await renameQueue(db, org, RENAME_BUDGET_MS))
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

const RENAME_BUDGET_MS = 20_000

/**
 * Approved item names into LS (item_name_changes, oldest first). Each item is read first: when its LS name is no longer
 * the one approved against, nothing is written (someone changed it in LS; it shows again on the Item names page). The
 * * or ** marker LS has is always kept (VMS never changes markers here), no name another LS item has is written, and the
 * change counts only when LS answers with the new name. Renames that change what the name says then go on Trevor's
 * shelf-tag task.
 */
async function renameQueue(db: SupabaseClient, org: string, budgetMs: number): Promise<{ sent: number; failed: number; waiting: number; error?: string }> {
  const started = Date.now()
  // a run that died part way: its names go back in line
  await db.from('item_name_changes').update({ status: 'approved' }).eq('organization_id', org).eq('status', 'sending').lt('claimed_at', new Date(Date.now() - 5 * 60_000).toISOString())
  const waiting = async () => (await db.from('item_name_changes').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('status', 'approved')).count ?? 0
  const { data: rows } = await db.from('item_name_changes').select('id, ls_item_id, old_name, new_name, tries').eq('organization_id', org).eq('status', 'approved').order('approved_at').limit(60)
  if (!rows?.length) return { sent: 0, failed: 0, waiting: 0 }
  const { data: conn } = await db.from('lightspeed_connections').select('scope').eq('organization_id', org).maybeSingle()
  if (!String(conn?.scope ?? '').split(/\s+/).includes('employee:all')) return { sent: 0, failed: 0, waiting: rows.length, error: NO_FULL_ACCESS }
  const { token } = await lsAccessToken(db, org)
  const acct = await accountId(db, org)
  let sent = 0
  let failed = 0
  const fail = async (id: string, msg: string) => { failed++; await db.from('item_name_changes').update({ status: 'failed', ls_error: msg.slice(0, 400) }).eq('id', id) }
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break
    const { data: claimed } = await db.from('item_name_changes').update({ status: 'sending', tries: r.tries + 1, claimed_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'approved').select('id')
    if (!claimed?.length) continue
    try {
      const path = `/Account/${acct}/Item/${r.ls_item_id}.json`
      const now = String((await lsGet<{ Item?: { description?: string } }>(token, path)).Item?.description ?? '')
      if (now !== r.old_name) { await fail(r.id, `The name in LS changed since this was approved (it now reads "${now}"). Look at it again.`); continue }
      const marker = splitMarker(now).marker
      const name = marker + splitMarker(r.new_name).rest.trim()
      const { data: dup } = await db.from('ls_items').select('item_id').eq('organization_id', org).eq('description', name).neq('item_id', r.ls_item_id).limit(1)
      if (dup?.length) { await fail(r.id, `Another LS item (System ID ${dup[0]!.item_id}) already has the name "${name}". Add what tells them apart.`); continue }
      const back = String((await lsPut<{ Item?: { description?: string } }>(token, path, { description: name })).Item?.description ?? '')
      if (back !== name) { await fail(r.id, `Lightspeed took the change but shows "${back}".`); continue }
      await db.from('ls_items').update({ description: name }).eq('organization_id', org).eq('item_id', r.ls_item_id)
      await db.from('item_name_changes').update({ status: 'sent', new_name: name, sent_at: new Date().toISOString(), ls_error: null }).eq('id', r.id)
      sent++
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400)
      // LS busy or down: tried again on the next round, three tries in all
      if (r.tries + 1 >= 3) await fail(r.id, msg)
      else await db.from('item_name_changes').update({ status: 'approved', ls_error: msg }).eq('id', r.id)
    }
  }
  if (sent) await db.rpc('item_names_shelf_task', { p_org: org })
  return { sent, failed, waiting: await waiting() }
}

async function accountId(db: SupabaseClient, org: string): Promise<string> {
  const { data } = await db.from('lightspeed_connections').select('account_id').eq('organization_id', org).maybeSingle()
  if (!data?.account_id) throw new HttpError(400, 'Check the Lightspeed connection in Settings first')
  return data.account_id
}

/**
 * What LS shows as received for some items (Dana, Oct 21: "can't you look in the data in LS and see if we received those
 * 6 brushes?"): every change to their stock in LS's log between two dates, with LS's reason (a PO checked in, a quantity
 * typed in by hand, a sale, a transfer, a count) and who did it. Read only. LS's log can't be asked for one item, so the
 * days are read in order and kept to these items; a long stretch stops at the time limit and says how far it got.
 */
async function receivingHistory(db: SupabaseClient, org: string, itemIds: string[], from: string, to: string | null) {
  const ids = new Set(itemIds.filter((x) => /^\d+$/.test(x)))
  if (!ids.size || ids.size > 300) throw new HttpError(400, 'Which items?')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) throw new HttpError(400, 'Which dates?')
  const { token } = await lsAccessToken(db, org)
  const acct = await accountId(db, org)
  const started = Date.now()
  const end = to ? `${to}T23:59:59-07:00` : new Date().toISOString()
  type Log = { inventoryLogID: string; itemID: string; shopID?: string; employeeID?: string; qohChange?: string; createTime?: string; reason?: string; orderID?: string; saleID?: string; transferID?: string; inventoryCountID?: string; vendorReturnID?: string }
  const found: Log[] = []
  let url: string | null = `/Account/${acct}/InventoryLog.json?limit=100&createTime=${encodeURIComponent(`><,${from}T00:00:00-07:00,${end}`)}`
  let lastTime: string | null = null
  while (url && Date.now() - started < 110_000) {
    const body: Record<string, unknown> = await lsGet<Record<string, unknown>>(token, url)
    const page = asList(body.InventoryLog as Log | Log[] | undefined)
    for (const x of page) if (ids.has(String(x.itemID))) found.push(x)
    lastTime = page.at(-1)?.createTime ?? lastTime
    const next = (body['@attributes'] as { next?: string } | undefined)?.next
    url = next ? next.replace(LS_API, '') : null
  }
  // who did it: LS's employees by name
  const people = new Map<string, string>()
  for (const e of new Set(found.map((x) => x.employeeID).filter((x): x is string => !!x && x !== '0'))) {
    const r = await lsGet<{ Employee?: { firstName?: string; lastName?: string } }>(token, `/Account/${acct}/Employee/${e}.json`).catch(() => null)
    if (r?.Employee) people.set(e, `${(r.Employee.firstName ?? '').trim()} ${(r.Employee.lastName ?? '').trim()}`.trim())
  }
  const nz = (v?: string) => (v && v !== '0' ? v : null)
  return {
    from, to: to ?? new Date().toISOString().slice(0, 10), complete: !url, read_up_to: url ? lastTime : null,
    changes: found.map((x) => ({
      item_id: String(x.itemID), at: x.createTime ?? null, shop_id: x.shopID ?? null, change: Number(x.qohChange ?? 0), reason: x.reason ?? null,
      who: x.employeeID ? people.get(x.employeeID) ?? null : null, ls_order_id: nz(x.orderID), sale_id: nz(x.saleID), transfer_id: nz(x.transferID),
      count_id: nz(x.inventoryCountID), vendor_return_id: nz(x.vendorReturnID),
    })),
  }
}

/**
 * LS purchase orders for some LS vendors since a date, read only (Dana, Oct 21: did the orders VMS still shows as open
 * come in?). Each PO with its ordered/received dates and how much of it was received.
 */
/**
 * Read only (Dana, Oct 23: which vendors have had nothing new since we moved to LS): every time LS added to an item's
 * quantity after `from`, a page run at a time (about 100 seconds), with who did it (0 = no person: the May 7, 2021 import),
 * the store and why (received order, manual add, count, transfer, sale put back…). `cursor` carries on where the last
 * call stopped.
 */
async function inventoryAdds(db: SupabaseClient, org: string, from: string, cursor: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpError(400, 'Which date?')
  if (cursor && !cursor.startsWith('/Account/')) throw new HttpError(400, 'Bad cursor')
  const { token } = await lsAccessToken(db, org)
  const acct = await accountId(db, org)
  const started = Date.now()
  type Log = { inventoryLogID: string; itemID: string; shopID?: string; employeeID?: string; qohChange?: string; createTime?: string; reason?: string; orderID?: string; saleID?: string; transferID?: string; inventoryCountID?: string; vendorReturnID?: string }
  const rows: { item_id: string; shop_id: string | null; at: string | null; change: number; reason: string | null; employee_id: string | null; order: boolean; sale: boolean; transfer: boolean; count: boolean }[] = []
  let url: string | null = cursor ?? `/Account/${acct}/InventoryLog.json?limit=100&sort=inventoryLogID&qohChange=${encodeURIComponent('>,0')}&createTime=${encodeURIComponent(`>,${from}T00:00:00-07:00`)}`
  let pages = 0
  while (url && Date.now() - started < 100_000) {
    const body: Record<string, unknown> = await lsGet<Record<string, unknown>>(token, url)
    pages++
    const nz = (v?: string) => !!v && v !== '0'
    for (const x of asList(body.InventoryLog as Log | Log[] | undefined)) {
      rows.push({ item_id: String(x.itemID), shop_id: x.shopID ?? null, at: x.createTime ?? null, change: Number(x.qohChange ?? 0), reason: x.reason ?? null,
        employee_id: nz(x.employeeID) ? String(x.employeeID) : null, order: nz(x.orderID), sale: nz(x.saleID), transfer: nz(x.transferID), count: nz(x.inventoryCountID) })
    }
    const next = (body['@attributes'] as { next?: string } | undefined)?.next
    url = next ? next.replace(LS_API, '') : null
  }
  return { from, pages, done: !url, cursor: url, rows }
}

async function purchaseOrders(db: SupabaseClient, org: string, vendorIds: string[], from: string) {
  const ids = [...new Set(vendorIds.filter((x) => /^\d+$/.test(x)))]
  if (!ids.length || ids.length > 100) throw new HttpError(400, 'Which vendors?')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpError(400, 'From when?')
  const { token } = await lsAccessToken(db, org)
  const acct = await accountId(db, org)
  type Po = { orderID: string; vendorID?: string; shopID?: string; refNum?: string; orderedDate?: string; receivedDate?: string; arrivalDate?: string; complete?: string; archived?: string; timeStamp?: string }
  type Line = { orderID: string; itemID?: string; quantity?: string; numReceived?: string; checkedIn?: string }
  const pos: Po[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const q = `vendorID=${encodeURIComponent(`IN,[${ids.slice(i, i + 20).join(',')}]`)}&timeStamp=${encodeURIComponent(`>,${from}T00:00:00-07:00`)}`
    pos.push(...await lsGetAll<Po>(token, `/Account/${acct}/Order.json?${q}`, 'Order', 20))
  }
  const lines: Line[] = []
  const orderIds = pos.map((p) => p.orderID)
  for (let i = 0; i < orderIds.length; i += 50) {
    lines.push(...await lsGetAll<Line>(token, `/Account/${acct}/OrderLine.json?orderID=${encodeURIComponent(`IN,[${orderIds.slice(i, i + 50).join(',')}]`)}`, 'OrderLine', 20))
  }
  return pos.map((p) => {
    const mine = lines.filter((l) => String(l.orderID) === String(p.orderID))
    return {
      ls_order_id: String(p.orderID), ls_vendor_id: p.vendorID ?? null, shop_id: p.shopID ?? null, ref: p.refNum ?? null,
      ordered: p.orderedDate ?? null, received: p.receivedDate ?? null, arrival: p.arrivalDate ?? null,
      complete: p.complete === 'true', archived: p.archived === 'true', lines: mine.length,
      qty: mine.reduce((s, l) => s + Number(l.quantity ?? 0), 0), qty_received: mine.reduce((s, l) => s + Number(l.numReceived ?? 0), 0),
      item_ids: [...new Set(mine.map((l) => String(l.itemID ?? '')).filter((x) => x && x !== '0'))],
    }
  })
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

interface DraftLine { vid: string | null; upc: string | null; desc: string; qty: number; cost: number | null; system_id: string | null; name: string; category?: string; is_new: boolean; ls_item_id?: string | null; ls_line_id?: string | null; rename?: string | null; rename_ok?: boolean; renamed?: boolean; flags?: string[]; created_note?: string | null }

/**
 * The approved draft's items onto the order's PO in LS (making the PO first when there is none). Each line is found in
 * VMS's copy of LS (System ID, the vendor's item number, a UPC only one item has), else in LS itself. A new item the
 * reviewer checked is entered in LS first (createItem), unless a flag still needs a person. Ticked SOP renames go into
 * the Item names queue. Lines already sent are skipped, so it can run again. All sent → the draft is done.
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
  const { data: po } = await db.from('ls_pos').select('vendor_id, vendor:vendors!ls_pos_vendor_id_fkey(lightspeed_vendor_id, name)').eq('id', p.id).single()
  const lsVendor = (po?.vendor as unknown as { lightspeed_vendor_id: string | null } | null)?.lightspeed_vendor_id ?? null
  const started = Date.now()
  const missing: string[] = []
  let added = 0
  let created = 0
  for (const l of lines) {
    if (l.ls_line_id || !(l.qty > 0)) continue
    if (Date.now() - started > 100_000) break
    if (!l.ls_item_id) l.ls_item_id = await findLocalItem(db, org, lsVendor, l) ?? await findItem(token, acct, l)
    // a new item, named by the SOP and checked in this PO: VMS enters it in LS (Trevor's Proposal 1)
    if (!l.ls_item_id && l.is_new) {
      const made = await createItem(db, org, token, acct, p.order_id, lsVendor, l)
      if (made.item_id) { l.ls_item_id = made.item_id; l.created_note = made.note; created++ }
      else { missing.push(`${l.vid ?? ''} ${l.name || l.desc}`.trim() + (made.why ? ` (${made.why})` : '')); continue }
    }
    if (!l.ls_item_id) { missing.push(`${l.vid ?? ''} ${l.name || l.desc}`.trim()); continue }
    const res = await lsPost<{ OrderLine?: { orderLineID: string } }>(token, `/Account/${acct}/OrderLine.json`, {
      orderID: o!.ls_order_id, itemID: l.ls_item_id, quantity: l.qty, ...(l.cost !== null ? { price: l.cost, originalPrice: l.cost } : {}),
    })
    l.ls_line_id = res.OrderLine?.orderLineID ? String(res.OrderLine.orderLineID) : 'sent'
    added++
    // keep progress after every line, so a second click never adds a line twice
    await db.from('ls_pos').update({ lines }).eq('id', p.id)
  }
  // rename on reorder: the ticked SOP names go into the Item names queue (sent within minutes, marker kept, shelf tags)
  const renames = lines.filter((l) => l.rename && l.rename_ok && l.ls_item_id && !l.is_new && l.rename !== l.name)
  for (const l of renames) {
    await db.from('item_name_changes').delete().eq('organization_id', org).eq('ls_item_id', l.ls_item_id!).in('status', ['approved', 'skipped'])
    await db.from('item_name_changes').insert({
      organization_id: org, ls_item_id: l.ls_item_id!, vendor_id: po?.vendor_id ?? null, old_name: l.name, new_name: l.rename!.toUpperCase(),
      kind: changeKind(l.name, l.rename!) === 'content' ? 'content' : 'cosmetic', source: 'reorder', status: 'approved', approved_by: me.id,
    })
    // queued once; the line shows it went
    l.rename_ok = false
    l.renamed = true
  }
  const left = lines.filter((l) => l.qty > 0 && !l.ls_line_id)
  const done = left.length === 0
  await db.from('ls_pos').update({
    lines, status: done ? 'sent' : 'ready', ls_po_number: done ? o!.po_number : null, sent_at: done ? new Date().toISOString() : null,
    reviewed_by: me.id, reviewed_at: new Date().toISOString(),
    draft_note: done ? `In Lightspeed as ${o!.po_number}: ${lines.filter((l) => l.ls_line_id).length} items${created ? `, ${created} new item${created === 1 ? '' : 's'} entered in LS` : ''}${renames.length ? `, ${renames.length} LS name${renames.length === 1 ? '' : 's'} going to the naming SOP` : ''}.`
      : `${added} added to ${o!.po_number} in Lightspeed. Not in LS yet (add them in LS, then Send again): ${missing.slice(0, 20).join('; ')}${missing.length > 20 ? ` and ${missing.length - 20} more` : ''}`,
  }).eq('id', p.id)
  return { po_number: o!.po_number, added, created, renamed: renames.length, missing, done }
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

/** The LS item from VMS's copy of LS: the vendor's item number (the Vendor ID in LS), else a UPC only one item has. */
async function findLocalItem(db: SupabaseClient, org: string, lsVendor: string | null, l: DraftLine): Promise<string | null> {
  if (l.system_id) {
    const { data } = await db.from('ls_items').select('item_id').eq('organization_id', org).eq('system_sku', l.system_id).limit(2)
    if (data?.length === 1) return data[0]!.item_id
  }
  if (lsVendor && l.vid) {
    const { data } = await db.from('ls_items').select('item_id').eq('organization_id', org).eq('default_vendor_id', lsVendor).ilike('vendor_item_id', l.vid).eq('archived', false).limit(2)
    if (data?.length === 1) return data[0]!.item_id
  }
  if (l.upc) {
    const { data } = await db.from('ls_items').select('item_id').eq('organization_id', org).eq('upc', l.upc).eq('archived', false).limit(2)
    if (data?.length === 1) return data[0]!.item_id
  }
  return null
}

// Flags that keep a new item out of LS until a person settles them (SOP: never guessed; Vendor ID from the invoice).
const BLOCKING = [/^Needs manual description/, /^Part of the name is in \[brackets\]/, /^Waiting on Vendor ID/, /^Another LS item already has this name/]

/**
 * Enter a new item in LS from a checked LS PO line: the SOP name, its category (one LS already has), the vendor and its
 * item number (the Vendor ID), the UPC, cost, and the retail price from Check-in pricing when there is one. LS is read
 * back; the item counts when LS shows the name. What LS did not keep (vendor number, price) goes in the line's note.
 */
async function createItem(db: SupabaseClient, org: string, token: string, acct: string, orderId: string, lsVendor: string | null, l: DraftLine): Promise<{ item_id?: string; why?: string; note?: string | null }> {
  const name = (l.name ?? '').trim().toUpperCase()
  if (!name) return { why: 'no name yet' }
  const block = (l.flags ?? []).find((f) => BLOCKING.some((re) => re.test(f)))
  if (block) return { why: block.split(':')[0] }
  if (/\[[^\]]*\]/.test(name)) return { why: 'part of the name is in [brackets]' }
  const { data: same } = await db.from('ls_items').select('item_id').eq('organization_id', org).eq('description', name).limit(1)
  if (same?.length) return { why: 'another LS item has this name' }
  const path = String(l.category ?? '').replace(/\s*>\s*/g, '/').trim()
  const { data: cat } = path ? await db.from('ls_items').select('category_id, category_path').eq('organization_id', org).ilike('category_path', path).neq('category_id', '').limit(1) : { data: null }
  if (!cat?.length) return { why: path ? `no LS category "${path}" yet: pick one LS has` : 'no category' }
  const { data: ol } = l.vid ? await db.from('order_lines').select('retail_price').eq('order_id', orderId).ilike('vendor_item_id', l.vid).not('retail_price', 'is', null).limit(1) : { data: null }
  const retail = ol?.[0]?.retail_price ?? null
  const body: Record<string, unknown> = {
    description: name, categoryID: cat[0]!.category_id,
    ...(l.cost !== null ? { defaultCost: l.cost } : {}),
    ...(lsVendor ? { defaultVendorID: lsVendor } : {}),
    ...(l.upc ? { upc: l.upc } : {}),
    ...(lsVendor && l.vid ? { ItemVendorNums: { ItemVendorNum: [{ vendorID: lsVendor, value: l.vid }] } } : {}),
    ...(retail !== null ? { Prices: { ItemPrice: [{ amount: retail, useType: 'Default', useTypeID: '1' }] } } : {}),
  }
  type LsItem = { itemID?: string; description?: string; ItemVendorNums?: { ItemVendorNum?: unknown }; Prices?: { ItemPrice?: unknown } }
  const made = (await lsPost<{ Item?: LsItem }>(token, `/Account/${acct}/Item.json`, body)).Item
  if (!made?.itemID) return { why: 'Lightspeed did not make the item' }
  const back = (await lsGet<{ Item?: LsItem }>(token, `/Account/${acct}/Item/${made.itemID}.json?load_relations=${encodeURIComponent('["ItemVendorNums","Prices"]')}`)).Item ?? {}
  if (String(back.description ?? '') !== name) return { why: `Lightspeed shows the name as "${back.description ?? ''}"` }
  const nums = asList(back.ItemVendorNums?.ItemVendorNum as { value?: string } | { value?: string }[] | undefined)
  const prices = asList(back.Prices?.ItemPrice as { amount?: string; useType?: string } | { amount?: string; useType?: string }[] | undefined)
  const notes: string[] = []
  if (l.vid && !nums.some((n) => String(n.value ?? '').toUpperCase() === l.vid!.toUpperCase())) notes.push('add the Vendor ID in LS (it did not keep it)')
  if (retail !== null && !prices.some((x) => Number(x.amount) === Number(retail))) notes.push('set the price in LS (it did not keep it)')
  if (retail === null) notes.push('no retail price yet: price it at check-in')
  await db.from('ls_items').upsert({
    organization_id: org, item_id: String(made.itemID), description: name, vendor_item_id: l.vid ?? '', upc: l.upc ?? '', category_id: cat[0]!.category_id,
    category_path: cat[0]!.category_path, default_vendor_id: lsVendor ?? '', default_cost: l.cost, archived: false, synced_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,item_id' })
  return { item_id: String(made.itemID), note: notes.length ? `Entered in LS; ${notes.join('; ')}` : 'Entered in LS' }
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
