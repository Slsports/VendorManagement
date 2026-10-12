// admin-users: Dana's staff list (Oct 12). Admin-only. Sign-ups are off on the project, so a person can sign in
// (with Google or a password) only after the admin adds them here; the auth user is created with the service role
// and the on_auth_user_created trigger builds the profile from app_metadata (role, store_codes).
//   { action: 'create', email, full_name, role, store_codes }  → creates the auth user + profile
//   { action: 'sign_ins' }                                      → per user: Google linked? password set? last sign-in
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'

const ROLES = ['manager', 'buyer', 'viewer', 'uploader'] // never admin: only Dana is admin

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const me = await caller(req, db)
    if (me.role !== 'admin') throw new HttpError(403, 'Only the admin manages people')
    const body = await req.json().catch(() => ({}))

    if (body.action === 'sign_ins') {
      const { data, error } = await db.auth.admin.listUsers({ perPage: 500 })
      if (error) throw error
      const rows = data.users.map((u) => ({
        id: u.id,
        google: (u.identities ?? []).some((i) => i.provider === 'google'),
        password: (u.identities ?? []).some((i) => i.provider === 'email'),
        last_sign_in_at: u.last_sign_in_at ?? null,
      }))
      return json({ rows })
    }

    if (body.action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const full_name = String(body.full_name ?? '').trim()
      const role = String(body.role ?? 'viewer')
      const store_codes = Array.isArray(body.store_codes) ? body.store_codes.map((c: unknown) => String(c).toUpperCase()) : []
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address')
      if (!full_name) throw new HttpError(400, "Enter the person's name")
      if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be manager, buyer, viewer or uploader')
      const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
      if (existing) throw new HttpError(409, 'That email is already on the list')
      const { data, error } = await db.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name },
        app_metadata: { organization_id: me.organization_id, role, store_codes },
      })
      if (error) throw new HttpError(400, error.message)
      const { data: profile } = await db.from('profiles').select('*').eq('id', data.user.id).single()
      return json({ profile })
    }

    throw new HttpError(400, 'Unknown action')
  } catch (e) {
    return errorResponse(e)
  }
})
