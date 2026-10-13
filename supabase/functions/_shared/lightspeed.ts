// Lightspeed Retail (R-Series) API access (Dana, Oct 13). The API client (Client ID + Secret) and the sign-in tokens live
// in lightspeed_connections (service role only). Access tokens last an hour; each refresh returns a new refresh token,
// which is saved at once. VMS only reads from LS here; writing waits for the per-batch approval step.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const LS_AUTHORIZE = 'https://cloud.lightspeedapp.com/auth/oauth/authorize'
export const LS_TOKEN = 'https://cloud.lightspeedapp.com/auth/oauth/token'
export const LS_API = 'https://api.lightspeedapp.com/API/V3'
export const LS_REDIRECT = 'https://vms.shaverlakesports.com/integrations/lightspeed/callback'
/** Read-only: items and inventory, reports, and costs. Creating POs later needs a reconnect with more access. */
export const LS_SCOPE_READ = 'employee:inventory_read employee:reports employee:product_cost'
export const LS_SCOPE_FULL = 'employee:all'

export interface LsConnection {
  organization_id: string; client_id: string | null; client_secret: string | null; scope: string | null; account_id: string | null; account_name: string | null
  access_token: string | null; access_expires_at: string | null; refresh_token: string | null
}

interface TokenAnswer { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string; message?: string }

/** Ask Lightspeed for tokens (a sign-in code, or a refresh). */
export async function lsTokenRequest(params: Record<string, string>): Promise<TokenAnswer> {
  const res = await fetch(LS_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(params) })
  const body = (await res.json().catch(() => ({}))) as TokenAnswer
  if (!res.ok || !body.access_token) throw new Error(`Lightspeed said: ${body.error_description ?? body.message ?? body.error ?? `error ${res.status}`}`)
  return body
}

/** Save fresh tokens (the refresh token changes on every refresh). */
export async function saveTokens(db: SupabaseClient, org: string, t: TokenAnswer) {
  const { error } = await db.from('lightspeed_connections').update({
    access_token: t.access_token, refresh_token: t.refresh_token ?? undefined,
    access_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), scope: t.scope ?? undefined, last_error: null,
  }).eq('organization_id', org)
  if (error) throw new Error(error.message)
}

/** A working access token: the saved one, or a refreshed one when it has (nearly) run out. */
export async function lsAccessToken(db: SupabaseClient, org: string): Promise<{ token: string; conn: LsConnection }> {
  const { data: conn } = await db.from('lightspeed_connections').select('*').eq('organization_id', org).maybeSingle()
  const c = conn as LsConnection | null
  if (!c?.refresh_token || !c.client_id || !c.client_secret) throw new Error('VMS is not connected to Lightspeed yet')
  if (c.access_token && c.access_expires_at && new Date(c.access_expires_at).getTime() > Date.now() + 60_000) return { token: c.access_token, conn: c }
  const t = await lsTokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.client_id, client_secret: c.client_secret })
  await saveTokens(db, org, t)
  return { token: t.access_token, conn: { ...c, access_token: t.access_token, refresh_token: t.refresh_token ?? c.refresh_token } }
}

/** GET from the LS API (path after /API/V3, e.g. "/Account.json"). Waits and retries once when LS says slow down. */
export async function lsGet<T>(token: string, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${LS_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 2000)); continue }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Lightspeed ${res.status}: ${(body as { message?: string }).message ?? 'request failed'}`)
    return body as T
  }
}
