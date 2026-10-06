// Run SQL against the hosted Supabase project through the Management API.
// Shared by the migration runner and import scripts. Needs SUPABASE_PROJECT_REF and,
// unless the environment proxy attaches it, SUPABASE_ACCESS_TOKEN.
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const ref = requireEnv('SUPABASE_PROJECT_REF')
const token = process.env.SUPABASE_ACCESS_TOKEN

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Run SQL (one or many statements). Backs off and retries when the API throttles (429). */
export async function query(sql) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query: sql }),
    })
    const text = await res.text()
    if (res.status === 429 && attempt < 8) {
      const wait = Math.min(60000, 3000 * 2 ** attempt)
      process.stderr.write(`  (API throttled, waiting ${wait / 1000}s)\n`)
      await sleep(wait)
      continue
    }
    if (!res.ok) throw new Error(`Supabase API ${res.status}: ${text}`)
    return text ? JSON.parse(text) : []
  }
}

/** SQL string literal. */
export function lit(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

/** SQL text[] literal. */
export function textArray(values) {
  if (!values || values.length === 0) return "'{}'::text[]"
  return `array[${values.map(lit).join(', ')}]::text[]`
}
