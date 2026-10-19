// Provider mail watch (Dana, Oct 19): new mail from Anthropic, Vercel, GitHub and Supabase in Dana's own mailboxes
// (dana@ and billing@) in the last N minutes, for the Claude session that reads them to her. Read-only; prints the
// sender, subject, time and the start of the text; the body is fetched by id when something needs reading in full.
//   NODE_USE_ENV_PROXY=1 node scripts/provider-mail.mjs 70        (minutes back, default 70)
//   NODE_USE_ENV_PROXY=1 node scripts/provider-mail.mjs --body <email id>
//   NODE_USE_ENV_PROXY=1 node scripts/provider-mail.mjs --task <email id> "<what to do>" "<one plain line why>" [YYYY-MM-DD]
//     makes a task for the mailbox owner (Dana) on that email's conversation, reminded at once, so it shows on her
//     dashboard under Tasks and Go to it opens the email. One task per email; the text is Claude's own words, never the mail.
import { query } from './db.mjs'

const esc = (v) => String(v).replace(/'/g, "''")
if (process.argv[2] === '--task') {
  const [, , , id, title, note, due] = process.argv
  if (!id || !title) { console.error('usage: --task <email id> "<title>" "<note>" [YYYY-MM-DD]'); process.exit(1) }
  const rows = await query(`insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, thread_id, auto_key, area)
    select e.organization_id, '${esc(title)}', '${esc(note ?? '')}', ${due ? `'${esc(due)}'::date` : "(now() at time zone 'America/Los_Angeles')::date"}, now(),
      m.owner_id, m.owner_id, e.thread_id, 'provider:' || e.id, case when m.kind = 'accounting' then 'accounting' else 'general' end
    from emails e join mailboxes m on m.id = e.mailbox_id
    where e.id = '${esc(id).replace(/[^0-9a-f-]/g, '')}' and not exists (select 1 from public.tasks t where t.auto_key = 'provider:' || e.id)
    returning id, title, due_date, area`)
  console.log(rows.length ? rows[0] : 'No task made: email not found or a task for it already exists.')
  process.exit(0)
}

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
