#!/usr/bin/env node
/**
 * Apply pending SQL migrations in supabase/migrations to the hosted Supabase project
 * through the Management API (HTTPS only; no direct database connection needed).
 *
 *   npm run db:migrate            # apply everything not yet applied
 *   npm run db:migrate -- --dry   # list what would run
 *
 * Needs SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN (personal access token,
 * https://supabase.com/dashboard/account/tokens) in .env or the environment.
 *
 * Applied versions are recorded in supabase_migrations.schema_migrations, the same
 * table the Supabase CLI uses, so `supabase db push` stays compatible later.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const dry = process.argv.includes('--dry')
const ref = requireEnv('SUPABASE_PROJECT_REF')
const token = requireEnv('SUPABASE_ACCESS_TOKEN', 'Create one at https://supabase.com/dashboard/account/tokens')
const dir = resolve(process.cwd(), 'supabase/migrations')

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase API ${res.status}: ${text}`)
  return text ? JSON.parse(text) : []
}

const files = readdirSync(dir)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
if (files.length === 0) {
  console.log('No migrations found in supabase/migrations.')
  process.exit(0)
}

await query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  );
`)
const applied = new Set((await query('select version from supabase_migrations.schema_migrations')).map((r) => r.version))

let ran = 0
for (const file of files) {
  const version = file.slice(0, 14)
  const name = file.slice(15, -4)
  if (applied.has(version)) {
    console.log(`skip   ${file} (already applied)`)
    continue
  }
  if (dry) {
    console.log(`would  ${file}`)
    continue
  }
  const sql = readFileSync(join(dir, file), 'utf8')
  process.stdout.write(`apply  ${file} … `)
  // Run the migration and its bookkeeping row in one transaction.
  const wrapped = `begin;\n${sql}\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${lit(version)}, ${lit(name)}, array[${lit(sql)}]);\ncommit;`
  try {
    await query(wrapped)
    console.log('ok')
    ran++
  } catch (err) {
    console.log('FAILED')
    console.error(err.message)
    process.exit(1)
  }
}
console.log(dry ? 'Dry run complete.' : `Done. ${ran} migration(s) applied.`)

function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}
