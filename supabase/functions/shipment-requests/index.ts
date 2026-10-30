// shipment-requests: the shipment details / freight email VMS sends the vendor when an order is confirmed, the form the
// vendor fills in, their replies, and the 3-business-day follow-up (Dana, Oct 30; migration 0268).
//   {action:"cron"}            — trusted (x-cron-secret), every 5 minutes: send 'ready' requests as Trevor (through
//                                gmail-send), read new replies on sent requests (Claude), make the follow-ups
//   {action:"send", id}        — a signed-in editor: send one request now (a held one from the backfill)
//   {action:"form", token}     — no login: the form's data (marks it opened)
//   {action:"submit", token, method, answers} — no login: the vendor's answers
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, readShipmentReply } from '../_shared/ai.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEND_PER_RUN = 10
const TIME_BUDGET_MS = 45_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  const started = Date.now()
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; token?: string; id?: string; method?: string; answers?: Record<string, unknown> }
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret

    if (body.action === 'form' || body.action === 'submit') {
      if (!body.token || !UUID.test(body.token)) throw new HttpError(404, 'This link is not valid.')
      if (body.action === 'form') {
        const { data, error } = await db.rpc('shipment_form_get', { p_token: body.token })
        if (error) throw new Error(error.message)
        if (!data) throw new HttpError(404, 'This link is not valid.')
        return json(data)
      }
      const answers = body.answers ?? {}
      if (JSON.stringify(answers).length > 60_000) throw new HttpError(400, 'Too much text')
      if (body.method !== 'pallet' && body.method !== 'parcel') throw new HttpError(400, 'Pick Pallet or Parcel')
      const { data, error } = await db.rpc('shipment_form_submit', { p_token: body.token, p_method: body.method, p_answers: answers })
      if (error) throw new Error(error.message)
      if (!data) throw new HttpError(404, 'This link is not valid.')
      return json(data)
    }

    if (body.action === 'send') {
      const me = await caller(req, db, true)
      if (!body.id || !UUID.test(body.id)) throw new HttpError(400, 'Which request?')
      const { data: r } = await db.from('shipment_requests').select('id, organization_id, status, to_emails').eq('id', body.id).maybeSingle()
      if (!r || r.organization_id !== me.organization_id) throw new HttpError(404, 'Request not found')
      if (r.status !== 'ready') throw new HttpError(400, 'This one already went out')
      if (!r.to_emails?.length) throw new HttpError(400, 'No email on file for this vendor yet')
      await db.from('shipment_requests').update({ hold: false }).eq('id', r.id)
      const out = await sendOne(db, cronSecret ?? '', r.id)
      return json(out)
    }

    if (!trusted) throw new HttpError(403, 'Not allowed')
    const { data: orgs } = await db.from('organizations').select('id')
    const out: unknown[] = []
    for (const o of orgs ?? []) {
      const r = { org: o.id, sent: 0, send_errors: [] as string[], replies: 0, followups: 0 }
      // 1. send what is ready (not on hold, with somebody to send to), as the person it goes as
      const { data: ready } = await db.from('shipment_requests').select('id').eq('organization_id', o.id).eq('status', 'ready').eq('hold', false).neq('to_emails', '{}').not('send_as', 'is', null).order('created_at').limit(SEND_PER_RUN)
      for (const s of ready ?? []) {
        if (Date.now() - started > TIME_BUDGET_MS) break
        try { await sendOne(db, cronSecret!, s.id); r.sent++ } catch (e) { r.send_errors.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)) }
      }
      // 2. replies on sent requests: Claude reads what the vendor said
      if (aiEnabled()) r.replies = await readReplies(db, o.id, started)
      // 3. nothing back after 3 business days: Trevor's task with the follow-up draft
      const { data: n } = await db.rpc('shipment_request_followups', { p_org: o.id })
      r.followups = Number(n ?? 0)
      out.push(r)
    }
    return json(out)
  } catch (e) {
    return errorResponse(e)
  }
})

/** The email for one request, sent through gmail-send as the person it goes as (Trevor); gmail-send stamps it sent. */
async function sendOne(db: SupabaseClient, secret: string, id: string): Promise<{ email_id: string; thread_id: string }> {
  const { data: rows, error } = await db.rpc('shipment_request_email', { p_req: id })
  if (error) throw new Error(error.message)
  const m = (rows ?? [])[0] as { subject: string; body: string; to_emails: string[]; cc_emails: string[]; reply_to_email_id: string | null; thread_id: string | null; send_as: string; vendor_id: string; order_id: string; attach_routing_letter: boolean } | undefined
  if (!m) throw new Error('No email to send')
  if (!m.to_emails?.length) throw new Error('No email on file for this vendor')
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({
      as_profile: m.send_as, to: m.to_emails, cc: m.cc_emails, subject: m.subject, body: m.body,
      thread_id: m.thread_id, reply_to_email_id: m.reply_to_email_id, vendor_id: m.vendor_id,
      attach_routing_letter: m.attach_routing_letter, shipment_request_id: id,
    }),
  })
  const out = await res.json().catch(() => ({})) as { email_id?: string; thread_id?: string; error?: string }
  if (!res.ok || !out.email_id) throw new Error(out.error ?? `gmail-send ${res.status}`)
  return { email_id: out.email_id, thread_id: out.thread_id! }
}

/** New emails from the vendor on a sent request's conversation, read one at a time; what they say is applied. */
async function readReplies(db: SupabaseClient, org: string, started: number): Promise<number> {
  let n = 0
  const { data: reqs } = await db.from('shipment_requests').select('id, kind, thread_id, last_reply_read_at, sent_at, order:orders!shipment_requests_order_id_fkey(po_number, freight_terms, free_shipping, freight_cap_pct), vendor:vendors!shipment_requests_vendor_id_fkey(name)')
    .eq('organization_id', org).in('status', ['sent', 'opened', 'answered']).not('thread_id', 'is', null).limit(100)
  for (const s of reqs ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const since = s.last_reply_read_at ?? s.sent_at
    const { data: mails } = await db.from('emails').select('id, from_email, from_name, subject, body_text, received_at, direction, is_bulk').eq('thread_id', s.thread_id!).eq('direction', 'in').gt('received_at', since).order('received_at').limit(3)
    for (const e of mails ?? []) {
      const order = s.order as unknown as { po_number: string | null; freight_terms: string | null; free_shipping: boolean | null; freight_cap_pct: number | null } | null
      const terms = order?.freight_terms ?? (order?.free_shipping ? 'free' : 'charged')
      const reading = await readShipmentReply(db, org, { email_id: e.id, from: [e.from_name, e.from_email].filter(Boolean).join(' '), subject: e.subject, body_text: e.body_text, received_on: String(e.received_at).slice(0, 10), kind: s.kind, terms, cap_pct: order?.freight_cap_pct ?? null, po: order?.po_number ?? null, vendor: (s.vendor as unknown as { name: string } | null)?.name ?? null })
      if (!reading) { await db.from('shipment_requests').update({ last_reply_read_at: e.received_at }).eq('id', s.id); continue }
      // the details by email: the same answers the form would give
      const answers = reading.answer === 'details' ? { ...reading.answers, quote_amount: reading.answers.quote_amount == null ? '' : String(reading.answers.quote_amount), items: reading.answers.items.map((i) => ({ ...i, stackable: i.stackable ?? false, hazmat: i.hazmat ?? false })) } : {}
      const { error } = await db.rpc('shipment_request_reply', { p_req: s.id, p_email: e.id, p_reading: { answer: reading.answer, method: reading.method, answers, note: reading.note } })
      if (error) console.error('shipment reply', s.id, error.message)
      else n++
    }
  }
  return n
}
