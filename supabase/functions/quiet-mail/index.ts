// quiet-mail: mail from quiet accounting contacts (Paychex, Blue Shield) is filed as Handled; Claude reads each new one and
// only a deadline Dana must meet becomes a task (Dana, Nov 2). Runs every 10 minutes from pg_cron (header x-cron-secret):
// quiet_deadline_queue → Claude → quiet_deadline_apply (marks it read; a task only for a deadline still ahead).
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled } from '../_shared/ai.ts'
import { readDeadline } from '../_shared/deadlineRead.ts'

const TIME_BUDGET_MS = 100_000

interface Queued { email_id: string; contact: string; from_email: string | null; subject: string | null; received_at: string; text: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const { data: accounts } = await db.from('mail_accounts').select('organization_id')
    let read = 0, tasks = 0
    const errors: string[] = []
    for (const a of accounts ?? []) {
      const org = a.organization_id as string
      while (Date.now() - started < TIME_BUDGET_MS * 0.7) {
        const { data, error } = await db.rpc('quiet_deadline_queue', { p_org: org, p_limit: 8 })
        if (error) throw new Error(error.message)
        const batch = (data ?? []) as Queued[]
        if (!batch.length) break
        for (const q of batch) {
          try {
            const d = await readDeadline(db, org, { contact: q.contact, from: q.from_email ?? '', subject: q.subject, received: q.received_at.slice(0, 10), text: q.text })
            const due = d.deadline && /^\d{4}-\d{2}-\d{2}$/.test(d.due ?? '') ? d.due : null
            const { data: id, error: e2 } = await db.rpc('quiet_deadline_apply', { p_email: q.email_id, p_what: d.deadline ? d.what : null, p_due: due })
            if (e2) throw new Error(e2.message)
            if (id) tasks++
          } catch (e) {
            // marked read so one bad email never blocks the queue
            await db.rpc('quiet_deadline_apply', { p_email: q.email_id, p_what: null, p_due: null })
            errors.push(`${q.email_id}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`)
          }
          read++
        }
      }
    }
    return json({ read, tasks, errors })
  } catch (e) {
    return errorResponse(e)
  }
})
