// Deploy Supabase Edge Functions through the Management API (no Supabase CLI needed).
//   NODE_USE_ENV_PROXY=1 node scripts/deploy-functions.mjs gmail-sync [gmail-send …]
// Each function is supabase/functions/<name>/index.ts plus everything in supabase/functions/_shared.
// JWT checking is done inside the functions (the scheduler calls with a secret header), so verify_jwt is off.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const ref = requireEnv('SUPABASE_PROJECT_REF')
const token = process.env.SUPABASE_ACCESS_TOKEN
const names = process.argv.slice(2)
if (!names.length) {
  console.error('Usage: node scripts/deploy-functions.mjs <function-name> …')
  process.exit(1)
}

const shared = readdirSync('supabase/functions/_shared').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join('supabase/functions/_shared', f))
for (const name of names) {
  const entry = join('supabase/functions', name, 'index.ts')
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify({ name, entrypoint_path: entry, verify_jwt: false })], { type: 'application/json' }))
  for (const path of [entry, ...shared]) form.append('file', new Blob([readFileSync(path)], { type: 'application/typescript' }), path)
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${name}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`${name}: ${res.status} ${text}`)
    process.exit(1)
  }
  const body = JSON.parse(text)
  console.log(`${name}: deployed version ${body.version} (${body.status})`)
}
