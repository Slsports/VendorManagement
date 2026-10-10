// Create (or reset) the VMS login Claude sessions use to look at screens: "Claude (testing)", role buyer,
// all stores. Email and password come from the cloud environment variables VMS_TEST_EMAIL and
// VMS_TEST_PASSWORD (set by Dana in the environment settings); the password is never printed.
//   NODE_USE_ENV_PROXY=1 node scripts/create-test-login.mjs
import { query, lit } from './db.mjs'

const email = (process.env.VMS_TEST_EMAIL ?? '').trim().toLowerCase()
const password = process.env.VMS_TEST_PASSWORD ?? ''
if (!email.includes('@') || password.length < 8) {
  console.error('Set VMS_TEST_EMAIL and VMS_TEST_PASSWORD (8+ characters) in the cloud environment settings, then start a new session.')
  process.exit(1)
}
const ORG = '00000000-0000-0000-0000-000000000001'

const [existing] = await query(`select id from auth.users where lower(email) = ${lit(email)}`)
if (existing) {
  await query(`update auth.users set encrypted_password = extensions.crypt(${lit(password)}, extensions.gen_salt('bf')), updated_at = now() where id = ${lit(existing.id)}`)
  console.log('Test login exists; password reset from VMS_TEST_PASSWORD.')
} else {
  const [stores] = await query(`select coalesce(json_agg(code), '[]') as codes from public.stores where organization_id = ${lit(ORG)}`)
  const appMeta = JSON.stringify({ provider: 'email', providers: ['email'], role: 'buyer', organization_id: ORG, store_codes: stores.codes })
  const userMeta = JSON.stringify({ full_name: 'Claude (testing)' })
  const [u] = await query(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${lit(email)},
            extensions.crypt(${lit(password)}, extensions.gen_salt('bf')), now(), ${lit(appMeta)}::jsonb, ${lit(userMeta)}::jsonb,
            now(), now(), '', '', '', '')
    returning id`)
  await query(`
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), ${lit(u.id)}, ${lit(u.id)}, 'email',
            jsonb_build_object('sub', ${lit(u.id)}, 'email', ${lit(email)}, 'email_verified', true), now(), now(), now())`)
  console.log('Test login created: "Claude (testing)", buyer, all stores.')
}
const [p] = await query(`select full_name, role, is_active from public.profiles where lower(email) = ${lit(email)}`)
console.log(`Profile: ${p?.full_name} · ${p?.role} · ${p?.is_active ? 'active' : 'inactive'}`)
