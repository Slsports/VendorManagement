// Run SQL against the hosted Supabase project through the Management API.
// Shared by the migration runner and import scripts. Needs SUPABASE_PROJECT_REF and,
// unless the environment proxy attaches it, SUPABASE_ACCESS_TOKEN.
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const ref = requireEnv('SUPABASE_PROJECT_REF')
const token = process.env.SUPABASE_ACCESS_TOKEN

export async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase API ${res.status}: ${text}`)
  return text ? JSON.parse(text) : []
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
