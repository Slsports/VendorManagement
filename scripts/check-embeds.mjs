// Run every .from('<table>').select('<...(...)...>') string in the app against the live API: an embed that
// became ambiguous (a second foreign key between two tables) answers PGRST201 before any permission check,
// so this works without a signed-in user. Run it after any migration that adds a foreign key.
//   NODE_USE_ENV_PROXY=1 node scripts/check-embeds.mjs src supabase/functions
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, requireEnv } from './env.mjs'
loadEnv()
const ref = requireEnv('SUPABASE_PROJECT_REF')
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`)).json()
const pub = keys.find((k) => k.type === 'publishable')?.api_key
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !/test/.test(f)) files.push(p) } }
walk(process.argv[2]); if (process.argv[3]) walk(process.argv[3])
const consts = {}
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/const (\w+) = '([^']*\([^']*)'/g)) consts[m[1]] = m[2]
let bad = 0, n = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/\s*\n\s*\./g, '.')
  for (const m of src.matchAll(/from\('(\w+)'\)\.select\((?:'([^']*)'|(\w+))/g)) {
    const sel = m[2] ?? consts[m[3]]
    if (!sel || !sel.includes('(')) continue
    n++
    const r = await fetch(`https://${ref}.supabase.co/rest/v1/${m[1]}?select=${encodeURIComponent(sel.replace(/\s+/g, ''))}&limit=1`, { headers: { apikey: pub } })
    const body = await r.text()
    if (/PGRST2\d\d|Could not find a relationship|more than one relationship/.test(body)) { bad++; console.log('BAD', f, m[1], sel, body.slice(0, 200)) }
  }
}
console.log(`${n} embedded selects checked, ${bad} ambiguous`)
if (bad) process.exit(1)
