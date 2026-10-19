// Provider mail watch (Dana, Oct 19): new mail from Anthropic, Vercel, GitHub and Supabase in Dana's own mailboxes
// (dana@ and billing@) in the last N minutes, for the Claude session that reads them to her. Read-only; prints the
// sender, subject, time and the start of the text; the body is fetched by id when something needs reading in full.
//   NODE_USE_ENV_PROXY=1 node scripts/provider-mail.mjs 70        (minutes back, default 70)
//   NODE_USE_ENV_PROXY=1 node scripts/provider-mail.mjs --body <email id>
import { query } from './db.mjs'

const DOMAINS = ['anthropic.com', 'vercel.com', 'github.com', 'supabase.com', 'supabase.io']
const BOXES = ['dana@shaverlakesports.com', 'billing@shaverlakesports.com']

if (process.argv[2] === '--body') {
  const rows = await query(`select e.from_email, e.subject, e.received_at, e.body_text from emails e where e.id = '${String(process.argv[3]).replace(/[^0-9a-f-]/g, '')}'`)
  for (const r of rows) console.log(`${r.received_at} ${r.from_email}\n${r.subject}\n\n${(r.body_text ?? '').slice(0, 12000)}`)
  process.exit(0)
}
const minutes = Math.max(1, Number(process.argv[2] ?? 70))
const like = DOMAINS.map((d) => `e.from_email ilike '%@%${d}'`).join(' or ')
const rows = await query(`select e.id, m.address box, e.from_email, e.subject, to_char(e.received_at, 'YYYY-MM-DD HH24:MI') received, left(regexp_replace(coalesce(e.snippet, e.body_text, ''), '[^[:print:]]+', ' ', 'g'), 240) snippet
  from emails e join mailboxes m on m.id = e.mailbox_id
  where m.address in (${BOXES.map((b) => `'${b}'`).join(', ')}) and e.received_at > now() - make_interval(mins => ${minutes}) and (${like})
  order by e.received_at desc limit 50`)
if (!rows.length) console.log(`No provider mail in the last ${minutes} minutes.`)
for (const r of rows) console.log(`${r.received} ${r.box} | ${r.from_email} | ${r.subject}\n  id ${r.id}\n  ${r.snippet}`)
