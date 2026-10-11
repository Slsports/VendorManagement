// Schedule gmail-sync (and order-check) on the hosted project: pg_cron calls the function every minute with a shared
// secret header. The secret is generated here, stored in Vault and as the function secret
// MAIL_CRON_SECRET, and never printed. Safe to re-run (keeps an existing secret).
//   NODE_USE_ENV_PROXY=1 node scripts/setup-mail-cron.mjs [--every "* * * * *"] [--off] [--no-schedule]
// --run-now additionally starts one run immediately (through pg_net, with the secret from Vault).
import { randomBytes } from 'node:crypto'
import { query, lit } from './db.mjs'
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const ref = requireEnv('SUPABASE_PROJECT_REF')
const token = process.env.SUPABASE_ACCESS_TOKEN
const args = process.argv.slice(2)
const every = args.includes('--every') ? args[args.indexOf('--every') + 1] : '* * * * *'

await query(`create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;`)
await query(`select cron.unschedule(jobid) from cron.job where jobname in ('gmail-sync', 'order-check')`)
if (args.includes('--off')) {
  console.log('gmail-sync and order-check schedules removed')
  process.exit(0)
}

let [row] = await query(`select decrypted_secret as s from vault.decrypted_secrets where name = 'mail_cron_secret'`)
let secret = row?.s
if (!secret) {
  secret = randomBytes(32).toString('hex')
  await query(`select vault.create_secret(${lit(secret)}, 'mail_cron_secret', 'gmail-sync scheduler header')`)
}
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify([{ name: 'MAIL_CRON_SECRET', value: secret }]),
})
if (!res.ok) throw new Error(`Setting the function secret failed: ${res.status} ${await res.text()}`)

const call = `select net.http_post(
  url := 'https://${ref}.supabase.co/functions/v1/gmail-sync',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000)`
// order-check (Dana, Oct 10): Claude reads and compares confirmations and invoices, one or two a run.
const checkCall = call.replace('/functions/v1/gmail-sync', '/functions/v1/order-check')
if (!args.includes('--no-schedule')) {
  await query(`select cron.schedule('gmail-sync', ${lit(every)}, ${lit(call)})`)
  await query(`select cron.schedule('order-check', ${lit(every)}, ${lit(checkCall)})`)
  console.log(`gmail-sync and order-check scheduled (${every})`)
}
if (args.includes('--run-now')) {
  await query(call)
  console.log('gmail-sync started; watch mail_accounts.last_sync_at / last_error')
}
