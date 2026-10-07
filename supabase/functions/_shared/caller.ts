// Who is calling an Edge Function: the signed-in VMS user behind the Authorization header. Deno only.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
}

export interface Caller { id: string; organization_id: string; role: string; full_name: string | null; email: string; email_signature: string | null }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** The signed-in person; editors only when `editor` is set (admin, manager, buyer). */
export async function caller(req: Request, db: SupabaseClient, editor = false): Promise<Caller> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: u } = await db.auth.getUser(jwt)
  if (!u.user) throw new HttpError(401, 'Not signed in')
  const { data: p } = await db.from('profiles').select('id, organization_id, role, full_name, email, email_signature, is_active').eq('id', u.user.id).single()
  if (!p?.is_active) throw new HttpError(403, 'Not an active user')
  if (editor && !['admin', 'manager', 'buyer'].includes(p.role)) throw new HttpError(403, 'Only admins, managers and buyers send mail')
  return p as Caller
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status)
  return json({ error: e instanceof Error ? e.message : String(e) }, 500)
}
