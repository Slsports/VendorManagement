// mail-commands: "VMS:" notes in email (Dana, Oct 23: "Please create a task reminder and create an email to check on these
// backorder items. I would like one on Nov 1, 2026, December 15, 2026, January 30, 2027 & March 21, 2027"; "it should only
// activate if I say VMS:"). Runs every minute from pg_cron (header x-cron-secret).
//   1. find    — mail_commands_find: a note starting "VMS:", from one of us, to one of our own mailboxes; once per message
//   2. read    — Claude reads the note and the email under it: the vendor, the dates, the items, the email to send
//   3. make    — mail_command_make: one task per date (9 am Pacific reminder) for the person, tagged to the vendor and
//                linked to the email, each with the email to the vendor ready in Drafts
//   4. tell    — an email to the person: what was made with a link to each task, or the one question when it can't tell
//   5. watch   — once a task's email is sent, the vendor's answer in that conversation is read: when everything is settled
//                the remaining tasks close (Closed by VMS, with why) and the person is told
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress } from '../_shared/mime.ts'
import { aiEnabled, readBackorderAnswer, readVmsNote } from '../_shared/ai.ts'
import { cleanDates, longDay, pacificIso, pacificToday, splitVmsNote } from '../_shared/vmsNote.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://vms.shaverlakesports.com'
const TIME_BUDGET_MS = 50_000

interface Command { id: string; organization_id: string; email_id: string; person_id: string; thread_id: string | null; vendor_id: string | null }
interface EmailRow {
  id: string; subject: string | null; body_text: string | null; from_email: string | null; from_name: string | null; forwarded_from: string | null
  vendor_id: string | null; mentioned_vendor_ids: string[] | null; sender_id: string | null; thread_id: string | null
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'no API key' })
    const db = serviceClient()
    const started = Date.now()
    const out: Record<string, unknown>[] = []
    const { data: accounts } = await db.from('mail_accounts').select('organization_id, mailbox')
    for (const acct of (accounts ?? []) as { organization_id: string; mailbox: string }[]) {
      const org = acct.organization_id
      const found = await ok(db.rpc('mail_commands_find', { p_org: org }))
      const mailer = new Mailer(acct.mailbox)
      let made = 0, asked = 0, failed = 0, closed = 0
      while (Date.now() - started < TIME_BUDGET_MS) {
        const next = (await ok(db.rpc('mail_command_next', { p_org: org }))) as Command[] | null
        const c = next?.[0]
        if (!c) break
        try {
          const r = await runNote(db, org, c, mailer)
          if (r === 'done') made++
          else asked++
        } catch (e) {
          failed++
          const msg = e instanceof Error ? e.message : String(e)
          await db.rpc('mail_command_finish', { p_cmd: c.id, p_status: 'failed', p_summary: null, p_error: msg })
          await tell(db, mailer, c.person_id, 'VMS could not read your note', `VMS could not read your VMS: note (${msg.slice(0, 200)}).\n\nForward the email again, or make the task on the Tasks page: ${APP_URL}/tasks`)
        }
      }
      if (Date.now() - started < TIME_BUDGET_MS) closed = await watchAnswers(db, org, mailer)
      out.push({ org, found, made, asked, failed, closed })
    }
    return json(out)
  } catch (e) {
    return errorResponse(e)
  }
})

async function runNote(db: SupabaseClient, org: string, c: Command, mailer: Mailer): Promise<'done' | 'asked'> {
  const e = (await ok(db.from('emails').select('id, subject, body_text, from_email, from_name, forwarded_from, vendor_id, mentioned_vendor_ids, sender_id, thread_id').eq('id', c.email_id).single())) as EmailRow
  const split = splitVmsNote(e.body_text)
  if (!split) throw new Error('the note does not start with VMS:')
  const { data: person } = await db.from('profiles').select('full_name').eq('id', c.person_id).maybeSingle()

  // the vendors this email is about: filed to, named in it, or the sender's
  const ids = new Set<string>([e.vendor_id, ...(e.mentioned_vendor_ids ?? [])].filter((x): x is string => !!x))
  if (e.thread_id) {
    const { data: th } = await db.from('email_threads').select('vendor_id, tagged_vendor_ids').eq('id', e.thread_id).maybeSingle()
    for (const x of [th?.vendor_id, ...((th?.tagged_vendor_ids ?? []) as string[])]) if (x) ids.add(x)
  }
  if (e.forwarded_from) {
    const { data: s } = await db.from('email_senders').select('vendor_id').eq('organization_id', org).in('sender_key', [e.forwarded_from.toLowerCase(), e.forwarded_from.toLowerCase().split('@')[1] ?? '']).not('vendor_id', 'is', null).limit(2)
    for (const x of s ?? []) if (x.vendor_id) ids.add(x.vendor_id as string)
  }
  const { data: cands } = ids.size ? await db.from('vendors').select('id, name').in('id', [...ids]).eq('organization_id', org) : { data: [] }
  const candidates = (cands ?? []) as { id: string; name: string }[]

  const r = await readVmsNote(db, org, {
    today: pacificToday(), person: (person?.full_name as string | undefined) ?? 'staff', note: split.note,
    subject: e.subject, email_text: split.rest || (e.body_text ?? ''), from: e.forwarded_from ?? null, candidates,
  })
  let vendor = candidates.find((v) => v.id === r.vendor_id) ?? null
  if (!vendor && r.vendor_name) {
    const { data: hit } = await db.from('vendors').select('id, name').eq('organization_id', org).eq('is_active', true).is('merged_into_id', null).ilike('name', r.vendor_name.trim()).limit(2)
    if (hit?.length === 1) vendor = hit[0] as { id: string; name: string }
  }
  const dates = cleanDates(r.dates)
  if (!r.understood || !dates.length || !vendor) {
    const q = r.question ?? (!dates.length ? 'Which dates should the reminders be on?' : 'Which vendor is this about?')
    await db.rpc('mail_command_finish', { p_cmd: c.id, p_status: 'asked', p_summary: q, p_error: null })
    await tell(db, mailer, c.person_id, `VMS needs one more thing: ${e.subject ?? 'your note'}`,
      `VMS read your VMS: note on "${e.subject ?? '(no subject)'}" but couldn't make the reminders yet.\n\n${q}\n\nForward the email again with VMS: and the missing part.`)
    return 'asked'
  }

  const to = r.email_wanted ? await vendorAddresses(db, org, vendor.id, e.forwarded_from) : []
  const items = r.items.map((i) => `- ${[i.vid, i.name].filter(Boolean).join(' ')}${i.qty ? ` (${i.qty})` : ''}${i.note ? `: ${i.note}` : ''}`).join('\n')
  const tasks = dates.map((d, n) => ({
    due: d.date,
    remind_at: pacificIso(d.date, d.time ?? '09:00'),
    title: `${r.title} (${n + 1} of ${dates.length})`,
    notes: [r.summary, items ? `Items:\n${items}` : null, `From your VMS: note: "${split.note.slice(0, 400)}"`].filter(Boolean).join('\n\n'),
    draft: r.email_wanted && to.length && r.email_body ? { to, subject: r.email_subject ?? `Update on backordered items`, body: r.email_body } : null,
  }))
  const made = (await ok(db.rpc('mail_command_make', { p_cmd: c.id, p_vendor: vendor.id, p_summary: r.summary, p_tasks: tasks }))) as { task_id: string; due: string; draft_id: string | null }[] | null
  if (!made) return 'done'
  const lines = made.map((m) => `- ${longDay(m.due)}: ${APP_URL}/tasks?task=${m.task_id}`).join('\n')
  const mailNote = r.email_wanted
    ? to.length ? `Each one has an email to ${to.join(', ')} ready to send: open the task, look it over and click Send.` : `VMS found no email address for ${vendor.name}, so there is no email ready. Add their rep on the vendor page.`
    : ''
  await tell(db, mailer, c.person_id, `Done: ${made.length} reminder${made.length === 1 ? '' : 's'} for ${vendor.name}`,
    `From your VMS: note on "${e.subject ?? '(no subject)'}":\n\n${r.summary}\n\n${made.length} task${made.length === 1 ? '' : 's'} for ${vendor.name}, each reminding you at 9 am:\n${lines}\n\n${mailNote}\n\nWhen ${vendor.name} answers that everything shipped, VMS closes the rest (Tasks › Closed by VMS).`)
  return 'done'
}

/** Who gets the check-in: whoever sent the forwarded email (when not one of us), the vendor's rep, its other people, its order address. */
async function vendorAddresses(db: SupabaseClient, org: string, vendorId: string, original: string | null): Promise<string[]> {
  if (original) {
    const { data: ours } = await db.rpc('is_our_address', { p_org: org, p_email: original })
    if (ours === false) return [original.toLowerCase()]
  }
  const { data: v } = await db.from('vendors').select('email, assigned_rep_contact_id, assigned_rep_group_contact_id').eq('id', vendorId).maybeSingle()
  if (v?.assigned_rep_group_contact_id) {
    const { data: g } = await db.from('rep_group_contacts').select('email').eq('id', v.assigned_rep_group_contact_id).maybeSingle()
    if (g?.email) return [String(g.email).toLowerCase()]
  }
  const { data: people } = await db.from('vendor_emails').select('id, email, roles, is_primary').eq('vendor_id', vendorId).is('former_at', null).is('bad_email_at', null).not('email', 'is', null)
  const list = (people ?? []) as { id: string; email: string; roles: string[] | null; is_primary: boolean | null }[]
  const pick = list.find((p) => p.id === v?.assigned_rep_contact_id) ?? list.find((p) => (p.roles ?? []).includes('rep')) ?? list.find((p) => (p.roles ?? []).includes('orders')) ?? list.find((p) => p.is_primary) ?? list[0]
  if (pick) return [pick.email.toLowerCase()]
  return v?.email ? [String(v.email).toLowerCase()] : []
}

/** The vendor answered a check-in: when everything is settled the remaining tasks close and the person is told. */
async function watchAnswers(db: SupabaseClient, org: string, mailer: Mailer): Promise<number> {
  const rows = (await ok(db.rpc('mail_command_replies', { p_org: org }))) as { command_id: string; person_id: string; vendor_id: string | null; summary: string | null; email_ids: string[] | null }[] | null
  let closed = 0
  for (const w of rows ?? []) {
    const { data: mails } = await db.from('emails').select('from_email, received_at, body_text, snippet').in('id', w.email_ids ?? [])
    const a = await readBackorderAnswer(db, org, w.summary ?? 'backordered items', (mails ?? []).map((m) => ({ from: m.from_email as string | null, date: String(m.received_at).slice(0, 10), text: String(m.body_text ?? m.snippet ?? '') })))
    const n = (await ok(db.rpc('mail_command_answered', { p_cmd: w.command_id, p_close: a.all_settled, p_why: a.why }))) as number
    if (a.all_settled && n > 0) {
      closed += n
      await tell(db, mailer, w.person_id, `Closed ${n} reminder${n === 1 ? '' : 's'}: ${w.summary ?? 'backorders'}`,
        `${a.why}\n\nSo VMS closed the ${n} remaining reminder${n === 1 ? '' : 's'}. Check them under Tasks › Closed by VMS: ${APP_URL}/tasks?view=vms`)
    }
  }
  return closed
}

/** Plain emails to our own people, from orders@ (marked X-VMS-Notice, so they are never filed as mail). */
class Mailer {
  private gmail: Gmail | null = null
  constructor(private box: string) {}
  async send(to: string, subject: string, text: string) {
    this.gmail ??= new Gmail(await googleAccessToken(this.box))
    await this.gmail.send(buildMime({ from: formatAddress('VMS', this.box), to: [to], subject, text, headers: { 'X-VMS-Notice': 'vms-note' } }))
  }
}

async function tell(db: SupabaseClient, mailer: Mailer, personId: string, subject: string, text: string) {
  const { data: p } = await db.from('profiles').select('email').eq('id', personId).maybeSingle()
  if (!p?.email) return
  await mailer.send(String(p.email), subject, text).catch((e) => console.error('tell:', e instanceof Error ? e.message : e))
}
