// task-reminders: task reminders and "done" notices (Dana, Oct 11). Runs every minute from pg_cron (header
// x-cron-secret). Each person chooses dashboard, email and/or text (profiles.remind_*); the dashboard shows its own,
// so this sends the email (from orders@, marked X-VMS-Notice so gmail-sync never files it as mail) and the text
// (Twilio, once TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are set).
//   reminders: open tasks whose remind time has come, to the person it is assigned to
//   done:      tasks someone finished that another person gave them, to the giver
//   drafts:    emails Claude prepared (Mail › Drafts) that also go in the mailbox's Gmail Drafts (gmail_copy), Dana Oct 12
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress } from '../_shared/mime.ts'
import { fillSignature, htmlEmail, textEmail } from '../_shared/signature.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://vms.shaverlakesports.com'
const TZ = 'America/Los_Angeles'
const BATCH = 40

interface Person { id: string; full_name: string | null; email: string; remind_email: boolean; remind_text: boolean; mobile_phone: string | null }
interface TaskRow {
  id: string; organization_id: string; title: string; notes: string | null; due_date: string | null; assigned_to: string; created_by: string | null
  done_by: string | null; done_note: string | null; tag_other: string | null; auto_key: string | null; thread_id: string | null
  vendor: { name: string } | null; carrier: { name: string } | null; rep_group: { name: string } | null
  order: { po_number: string | null; description: string | null } | null
  thread: { subject: string | null; mailbox_id: string | null; shared_at: string | null } | null
}
const SELECT = `id, organization_id, title, notes, due_date, assigned_to, created_by, done_by, done_note, tag_other, auto_key, thread_id,
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
    const drafts = await copyDrafts(db)
    const routing = await routingReminders(db)
    const confirmations = await confirmReminders(db)
    return json({ reminded: reminded.length, done: finished.length, drafts, routing, confirmations })
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

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

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
    // a reply someone asked to hear about (Dana, Oct 19) opens that reply
    t.auto_key?.startsWith('reply:') && t.thread_id ? `\nOpen their reply: ${APP_URL}/mail/${t.thread_id}` : `\nOpen it in VMS: ${APP_URL}/tasks?task=${t.id}`,
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

/** Drafts that should also sit in Gmail Drafts: written as the draft's owner (name and signature with the logo), from orders@. */
async function copyDrafts(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('email_drafts').select('id, organization_id, owner_id, to_emails, cc_emails, subject, body, signature').eq('gmail_copy', true).is('gmail_draft_id', null).limit(10)
  let n = 0
  for (const d of data ?? []) {
    const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', d.organization_id).maybeSingle()
    const { data: owner } = await db.from('profiles').select('full_name, email_signature, signature_name, job_title, direct_phone').eq('id', d.owner_id).maybeSingle()
    const { data: org } = await db.from('organizations').select('name, app_name, signature_template').eq('id', d.organization_id).maybeSingle()
    if (!acct?.mailbox) continue
    const brand = (org?.app_name || org?.name || '').trim()
    const sig = d.signature ?? fillSignature(org?.signature_template ?? null, { name: owner?.signature_name || owner?.full_name || null, title: owner?.job_title ?? null, direct: owner?.direct_phone ?? null, own: owner?.email_signature ?? null })
    const raw = buildMime({ from: formatAddress([owner?.full_name, brand].filter(Boolean).join(' | '), acct.mailbox), to: d.to_emails, cc: d.cc_emails, replyTo: acct.mailbox, subject: d.subject, text: textEmail(d.body, sig), html: sig.trim() ? htmlEmail(d.body, sig) : null })
    const gmail = new Gmail(await googleAccessToken(acct.mailbox))
    const made = await gmail.call<{ id: string }>('drafts', { method: 'POST', body: JSON.stringify({ message: { raw: btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } }) })
    await db.from('email_drafts').update({ gmail_draft_id: made.id }).eq('id', d.id)
    n++
  }
  return n
}

/**
 * Routing letter reminders (Dana, Oct 13): a person who has not clicked "I received the routing instructions" a week
 * after it went out gets one reminder from orders@, signed by whoever sent the letter.
 */
async function routingReminders(db: SupabaseClient): Promise<number> {
  const { data } = await db.rpc('routing_reminder_queue', { p_limit: 20 })
  let n = 0
  for (const r of (data ?? []) as { send_id: string; organization_id: string; email: string; contact_name: string | null; vendor_name: string; token: string; subject: string; sent_by: string | null }[]) {
    const { data: claimed } = await db.from('routing_letter_sends').update({ reminded_at: new Date().toISOString() }).eq('id', r.send_id).is('reminded_at', null).select('id')
    if (!claimed?.length) continue
    const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', r.organization_id).maybeSingle()
    if (!acct?.mailbox) continue
    const { data: org } = await db.from('organizations').select('name, app_name, signature_template').eq('id', r.organization_id).maybeSingle()
    const { data: who } = r.sent_by ? await db.from('profiles').select('full_name, email_signature, signature_name, job_title, direct_phone').eq('id', r.sent_by).maybeSingle() : { data: null }
    const sig = fillSignature(org?.signature_template ?? null, { name: who?.signature_name || who?.full_name || null, title: who?.job_title ?? null, direct: who?.direct_phone ?? null, own: who?.email_signature ?? null })
    const first = r.contact_name?.trim().split(' ')[0] || 'there'
    const body = `Hi ${first},\n\nLast week we sent ${r.vendor_name} our updated freight routing instructions. Please click below to confirm you received them:\n\nhttps://vms.shaverlakesports.com/r/${r.token}\n\nNo order ships until we approve a freight quote. Thank you!`
    const brand = (org?.app_name || org?.name || '').trim()
    const raw = buildMime({ from: formatAddress([who?.full_name, brand].filter(Boolean).join(' | '), acct.mailbox), to: [r.email], replyTo: acct.mailbox, subject: `Reminder: ${r.subject}`, text: textEmail(body, sig), html: htmlEmail(body, sig) })
    try {
      const gmail = new Gmail(await googleAccessToken(acct.mailbox))
      await gmail.send(raw)
      n++
    } catch (e) {
      // let it try again next run
      await db.from('routing_letter_sends').update({ reminded_at: null }).eq('id', r.send_id)
      console.error('routing reminder', r.send_id, e instanceof Error ? e.message : e)
    }
  }
  return n
}

/** Contact confirmation reminders (Dana, Oct 13): one reminder a week after the email, for people who have not answered. */
async function confirmReminders(db: SupabaseClient): Promise<number> {
  const { data } = await db.rpc('vendor_confirm_reminder_queue', { p_limit: 20 })
  let n = 0
  for (const r of (data ?? []) as { id: string; organization_id: string; email: string; contact_name: string | null; vendor_name: string; token: string; sent_by: string | null }[]) {
    const { data: claimed } = await db.from('vendor_confirmations').update({ reminded_at: new Date().toISOString() }).eq('id', r.id).is('reminded_at', null).select('id')
    if (!claimed?.length) continue
    const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', r.organization_id).maybeSingle()
    if (!acct?.mailbox) continue
    const { data: org } = await db.from('organizations').select('name, app_name, signature_template, confirm_email_subject').eq('id', r.organization_id).maybeSingle()
    const { data: who } = r.sent_by ? await db.from('profiles').select('full_name, email_signature, signature_name, job_title, direct_phone').eq('id', r.sent_by).maybeSingle() : { data: null }
    const sig = fillSignature(org?.signature_template ?? null, { name: who?.signature_name || who?.full_name || null, title: who?.job_title ?? null, direct: who?.direct_phone ?? null, own: who?.email_signature ?? null })
    const first = r.contact_name?.trim().split(' ')[0] || 'there'
    const body = `Hi ${first},\n\nJust a reminder: please take 2 minutes to confirm the contact information we have for ${r.vendor_name}:\n\nhttps://vms.shaverlakesports.com/confirm/${r.token}\n\nIf it's all correct, just click Looks good. Thank you!`
    const brand = (org?.app_name || org?.name || '').trim()
    const raw = buildMime({ from: formatAddress([who?.full_name, brand].filter(Boolean).join(' | '), acct.mailbox), to: [r.email], replyTo: acct.mailbox, subject: `Reminder: ${org?.confirm_email_subject ?? 'Please confirm your contact info'}`, text: textEmail(body, sig), html: htmlEmail(body, sig) })
    try {
      await new Gmail(await googleAccessToken(acct.mailbox)).send(raw)
      n++
    } catch (e) {
      await db.from('vendor_confirmations').update({ reminded_at: null }).eq('id', r.id)
      console.error('confirm reminder', r.id, e instanceof Error ? e.message : e)
    }
  }
  return n
}
