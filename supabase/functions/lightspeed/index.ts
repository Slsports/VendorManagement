// lightspeed: Settings → Lightspeed (Dana, Oct 13). Admin only.
//   { action: 'status' }                         → what is set and connected (never the secret or tokens)
//   { action: 'save_client', client_id, client_secret }
//   { action: 'authorize', access: 'read'|'full' } → the Lightspeed sign-in address (with a one-time state)
//   { action: 'exchange', code, state }          → after Dana approves in LS: tokens saved, account read, items counted
//   { action: 'test' }                           → reads the account and counts the items again
//   { action: 'disconnect' }                     → forgets the sign-in (the Client ID and Secret stay)
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { LS_AUTHORIZE, LS_REDIRECT, LS_SCOPE_FULL, LS_SCOPE_READ, lsAccessToken, lsGet, lsTokenRequest, saveTokens } from '../_shared/lightspeed.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const me = await caller(req, db)
    if (me.role !== 'admin') throw new HttpError(403, 'Only the admin connects Lightspeed')
    const org = me.organization_id
    const body = await req.json().catch(() => ({})) as { action?: string; client_id?: string; client_secret?: string; access?: string; code?: string; state?: string }

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
    const items = await lsGet<{ '@attributes'?: { count?: string } }>(token, `/Account/${a.accountID}/Item.json?limit=1&archived=false`)
    await db.from('lightspeed_connections').update({
      account_id: String(a.accountID), account_name: a.name, item_count: Number(items['@attributes']?.count ?? 0) || null, checked_at: new Date().toISOString(), last_error: null,
    }).eq('organization_id', org)
  } catch (e) {
    await db.from('lightspeed_connections').update({ checked_at: new Date().toISOString(), last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', org)
  }
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
