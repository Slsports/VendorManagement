#!/usr/bin/env node
/**
 * Create (or update) an application user with the Supabase admin API.
 * The database trigger creates the profile; this script sets role and store access.
 *
 *   npm run db:create-user -- --email dana@example.com --name "Dana Powell" --role admin --password "..."
 *   npm run db:create-user -- --email jw@example.com --name "Jarrett W" --role buyer --stores SLS,SLH,SLM,GS
 *
 * Without --password the user receives an invite email instead.
 * Admins automatically have every store; --stores only matters for other roles.
 *
 * Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or the environment.
 */
import { createClient } from '@supabase/supabase-js'
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const args = parseArgs(process.argv.slice(2))
const email = (args.email ?? '').trim().toLowerCase()
const role = args.role ?? 'viewer'
const fullName = args.name ?? ''
const storeCodes = (args.stores ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const organizationId = args.org // optional; defaults to the seeded first tenant

if (!email) die('--email is required')
if (!['admin', 'manager', 'buyer', 'viewer'].includes(role)) die('--role must be admin, manager, buyer or viewer')

const url = process.env.VITE_SUPABASE_URL || requireEnv('SUPABASE_URL')
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', 'Project settings → API keys (secret key). Never commit it.')
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const appMetadata = { role, ...(storeCodes.length ? { store_codes: storeCodes } : {}), ...(organizationId ? { organization_id: organizationId } : {}) }
const userMetadata = { full_name: fullName }

let user = await findUserByEmail(email)
if (user) {
  console.log(`User ${email} already exists (${user.id}); updating role and metadata.`)
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, ...appMetadata },
    user_metadata: { ...user.user_metadata, ...userMetadata },
    ...(args.password ? { password: args.password } : {}),
  })
  if (error) die(error.message)
  const { error: pErr } = await supabase.from('profiles').update({ role, ...(fullName ? { full_name: fullName } : {}) }).eq('id', user.id)
  if (pErr) die(pErr.message)
} else if (args.password) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: args.password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  })
  if (error) die(error.message)
  user = data.user
  console.log(`Created ${email} (${user.id}) with a password.`)
} else {
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { data: userMetadata })
  if (error) die(error.message)
  user = data.user
  // inviteUserByEmail cannot set app_metadata, so patch it before the user accepts.
  const { error: uErr } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: appMetadata })
  if (uErr) die(uErr.message)
  const { error: pErr } = await supabase.from('profiles').update({ role }).eq('id', user.id)
  if (pErr) die(pErr.message)
  console.log(`Invited ${email} (${user.id}); they will set a password from the email link.`)
}

// Store grants (idempotent). Admins do not need rows but harmless to add.
if (storeCodes.length) {
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  const { data: stores, error } = await supabase
    .from('stores')
    .select('id, code')
    .eq('organization_id', profile.organization_id)
    .in('code', storeCodes)
  if (error) die(error.message)
  const missing = storeCodes.filter((c) => !stores.some((s) => s.code === c))
  if (missing.length) console.warn(`Unknown store code(s) ignored: ${missing.join(', ')}`)
  if (stores.length) {
    const { error: gErr } = await supabase
      .from('user_store_access')
      .upsert(stores.map((s) => ({ user_id: user.id, store_id: s.id })), { onConflict: 'user_id,store_id', ignoreDuplicates: true })
    if (gErr) die(gErr.message)
    console.log(`Store access: ${stores.map((s) => s.code).join(', ')}`)
  }
}

const { data: finalProfile } = await supabase.from('profiles').select('email, full_name, role, organization_id').eq('id', user.id).single()
console.log('Profile:', finalProfile)

async function findUserByEmail(target) {
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) die(error.message)
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target)
    if (hit) return hit
    if (data.users.length < 200) return null
    page++
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

function die(msg) {
  console.error(msg)
  process.exit(1)
}
