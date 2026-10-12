// task-reminders: task reminders and "done" notices (Dana, Oct 11). Runs every minute from pg_cron (header
// x-cron-secret). Each person chooses dashboard, email and/or text (profiles.remind_*); the dashboard shows its own,
// so this sends the email (from orders@, marked X-VMS-Notice so gmail-sync never files it as mail) and the text
// (Twilio, once TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are set).
//   reminders: open tasks whose remind time has come, to the person it is assigned to
//   done:      tasks someone finished that another person gave them, to the giver
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress } from '../_shared/mime.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://vms.shaverlakesports.com'
const TZ = 'America/Los_Angeles'
const BATCH = 40

interface Person { id: string; full_name: string | null; email: string; remind_email: boolean; remind_text: boolean; mobile_phone: string | null }
interface TaskRow {
  id: string; organization_id: string; title: string; notes: string | null; due_date: string | null; assigned_to: string; created_by: string | null
  done_by: string | null; done_note: string | null; tag_other: string | null
  vendor: { name: string } | null; carrier: { name: string } | null; rep_group: { name: string } | null
  order: { po_number: string | null; description: string | null } | null
  thread: { subject: string | null; mailbox_id: string | null; shared_at: string | null } | null
}
const SELECT = `id, organization_id, title, notes, due_date, assigned_to, created_by, done_by, done_note, tag_other,
  vendor:vendors!tasks_vendor_id_fkey(name), carrier:carriers!tasks_carrier_id_fkey(name), rep_group:rep_groups!tasks_rep_group_id_fkey(name),
  order:orders!tasks_order_id_fkey(po_number, description), thread:email_threads!tasks_thread_id_fkey(subject, mailbox_id, shared_at)`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    const db = serviceClient()
    const sender = new Sender(db)
    const now = new Date().toISOString()

    // Reminders whose time has come (claimed first, so two runs never send one twice).
    const { data: due } = await db.from('tasks').select('id').is('done_at', null).is('reminded_at', null).lte('remind_at', now).limit(BATCH)
    const reminded = await claim(db, (due ?? []).map((r) => r.id), 'reminded_at')
    for (const t of reminded) {
      const errors = await sender.notify(t.organization_id, t.assigned_to, `Reminder: ${t.title}`, reminderText(t), `VMS reminder: ${t.title}${t.due_date ? ` (due ${day(t.due_date)})` : ''}`)
      if (errors.length) await db.from('tasks').update({ remind_error: errors.join('; ').slice(0, 500) }).eq('id', t.id)
    }

    // Finished tasks someone else gave: tell the giver.
    const { data: done } = await db.from('tasks').select('id').not('done_at', 'is', null).is('done_notified_at', null).limit(BATCH)
    const finished = await claim(db, (done ?? []).map((r) => r.id), 'done_notified_at')
    for (const t of finished) {
      if (!t.created_by || t.created_by === t.done_by) continue
      const who = (await sender.person(t.done_by ?? t.assigned_to))?.full_name?.split(' ')[0] ?? 'Someone'
      await sender.notify(t.organization_id, t.created_by, `Done: ${t.title}`, doneText(t, who), `VMS: ${who} finished "${t.title}"${t.done_note ? ` — ${t.done_note}` : ''}`)
    }
    return json({ reminded: reminded.length, done: finished.length })
  } catch (e) {
    return errorResponse(e)
  }
})

async function claim(db: SupabaseClient, ids: string[], column: 'reminded_at' | 'done_notified_at'): Promise<TaskRow[]> {
  if (!ids.length) return []
  const { data, error } = await db.from('tasks').update({ [column]: new Date().toISOString() }).in('id', ids).is(column, null).select(SELECT)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as TaskRow[]
}

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })

/** What the task is about, without the subject of anyone's private mail. */
function about(t: TaskRow): string | null {
  const thread = t.thread ? (t.thread.mailbox_id && !t.thread.shared_at ? 'an email' : `email "${t.thread.subject ?? '(no subject)'}"`) : null
  const order = t.order ? `order${t.order.po_number ? ` PO ${t.order.po_number}` : ''}${t.order.description ? ` (${t.order.description})` : ''}` : null
  const parts = [t.vendor?.name, t.carrier?.name, t.rep_group?.name, order, thread, t.tag_other].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function reminderText(t: TaskRow): string {
  return [
    `Reminder: ${t.title}`,
    t.due_date ? `Due: ${day(t.due_date)}` : null,
    about(t) ? `About: ${about(t)}` : null,
    t.notes ? `\n${t.notes}` : null,
    `\nOpen it in VMS: ${APP_URL}/tasks?task=${t.id}`,
  ].filter((x) => x !== null).join('\n')
}

function doneText(t: TaskRow, who: string): string {
  return [
    `${who} finished a task you gave them: ${t.title}`,
    about(t) ? `About: ${about(t)}` : null,
    t.done_note ? `Note: ${t.done_note}` : null,
    `\nOpen it in VMS: ${APP_URL}/tasks?task=${t.id}`,
  ].filter((x) => x !== null).join('\n')
}

/** US numbers: 10 digits get +1; anything already starting with + is kept. */
function phoneE164(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+')) return digits.length >= 8 ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

class Sender {
  private people = new Map<string, Person | null>()
  private mail = new Map<string, { gmail: Gmail; from: string } | null>()
  constructor(private db: SupabaseClient) {}

  async person(id: string): Promise<Person | null> {
    if (!this.people.has(id)) {
      const { data } = await this.db.from('profiles').select('id, full_name, email, remind_email, remind_text, mobile_phone').eq('id', id).maybeSingle()
      this.people.set(id, (data as Person | null) ?? null)
    }
    return this.people.get(id) ?? null
  }

  private async mailbox(org: string) {
    if (!this.mail.has(org)) {
      const { data } = await this.db.from('mail_accounts').select('mailbox').eq('organization_id', org).maybeSingle()
      this.mail.set(org, data?.mailbox ? { gmail: new Gmail(await googleAccessToken(data.mailbox)), from: data.mailbox } : null)
    }
    return this.mail.get(org) ?? null
  }

  /** Email and/or text the person, as they chose; returns what went wrong. */
  async notify(org: string, personId: string, subject: string, body: string, sms: string): Promise<string[]> {
    const p = await this.person(personId)
    if (!p) return ['person not found']
    const errors: string[] = []
    if (p.remind_email && p.email) {
      try {
        const box = await this.mailbox(org)
        if (!box) throw new Error('no orders@ mailbox')
        await box.gmail.send(buildMime({ from: formatAddress('VMS Reminders', box.from), to: [p.email], subject, text: body, headers: { 'X-VMS-Notice': 'task' } }))
      } catch (e) {
        errors.push(`email: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (p.remind_text) {
      const to = phoneE164(p.mobile_phone)
      const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), token = Deno.env.get('TWILIO_AUTH_TOKEN'), from = Deno.env.get('TWILIO_FROM')
      if (!to) errors.push('text: no mobile number')
      else if (!sid || !token || !from) errors.push('text: texting is not set up yet')
      else {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: to, From: from, Body: `${sms.slice(0, 280)} Reply STOP to stop.` }),
        })
        if (!res.ok) errors.push(`text: ${res.status} ${(await res.text()).slice(0, 200)}`)
      }
    }
    return errors
  }
}
