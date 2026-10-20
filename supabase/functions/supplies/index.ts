// supplies: store supply requests (Dana, Oct 12). Runs every minute from pg_cron (header x-cron-secret).
//   0. amazon        — Claude reads Amazon order emails: order #, PO (initials + store, Dana Oct 12), total, items, dates
//                      (Supplies › Amazon). Tyler's and Greg's orders stop there; Dana's (DP) go on to step 2.
//   1. requests      — Claude reads staff emails to orders@ (senders marked Ours, or a login's email): a supply request
//                      becomes a Supplies request and, when new, a task for Dana due in 2 days.
//   2. orders        — Claude reads order, shipping and delivery emails (orders@ and Dana's own inboxes) against the open
//                      requests: where it was ordered, the order number, the expected arrival; delivered = arrived.
//   3. tell them     — when a new request's confirmation comes in, the person who asked gets an email from orders@
//                      (marked X-VMS-Notice so the sync never files it). Requests from before today get none.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, readAmazonOrders, readSupplyOrders, readSupplyRequests, type AmazonEmail, type OpenSupply, type SupplyOrderEmail, type SupplyRequestEmail } from '../_shared/ai.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress } from '../_shared/mime.ts'

const TIME_BUDGET_MS = 90_000
// Requests asked for before Supplies started are loaded as old: no task, no email to the requester.
const SUPPLIES_START = '2026-10-12T20:00:00Z'
const TZ = 'America/Los_Angeles'

const check = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const { data: accounts } = await db.from('mail_accounts').select('organization_id, mailbox')
    const out: Record<string, unknown> = {}
    for (const a of accounts ?? []) {
      const org = a.organization_id as string
      out[org] = {
        amazon: await amazonStep(db, org, started),
        requests: await requestStep(db, org, started),
        orders: await orderStep(db, org, started),
        told: await tellStep(db, org, a.mailbox as string),
      }
    }
    return json(out)
  } catch (e) {
    return errorResponse(e)
  }
})

const isoDay = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

async function amazonStep(db: SupabaseClient, org: string, started: number) {
  let read = 0
  while (Date.now() - started < TIME_BUDGET_MS * 0.25) {
    const list = (await check(db.rpc('amazon_queue', { p_org: org, p_limit: 10 }))) as AmazonEmail[] | null
    if (!list?.length) break
    const readings = new Map((await readAmazonOrders(db, org, list)).map((r) => [r.id, r]))
    for (const e of list) {
      const r = readings.get(e.email_id)
      await check(db.rpc('amazon_apply', {
        p_email: e.email_id, p_kind: r?.kind ?? 'other', p_order: r?.order_number ?? null, p_po: r?.po ?? null, p_total: r?.total ?? null,
        p_items: r?.items ?? null, p_ordered: isoDay(r?.ordered_on), p_expected: isoDay(r?.expected),
      }))
      read++
    }
  }
  return read
}

async function requestStep(db: SupabaseClient, org: string, started: number) {
  let made = 0
  while (Date.now() - started < TIME_BUDGET_MS * 0.4) {
    const list = (await check(db.rpc('supply_request_queue', { p_org: org, p_limit: 10 }))) as SupplyRequestEmail[] | null
    if (!list?.length) break
    const readings = new Map((await readSupplyRequests(db, org, list)).map((r) => [r.id, r]))
    for (const e of list) {
      const r = readings.get(e.email_id)
      const id = await check(db.rpc('supply_from_email', {
        p_email: e.email_id, p_is_request: !!r?.is_request, p_summary: r?.summary ?? null, p_items: r?.items ?? [],
        p_requester: r?.requester ?? null, p_store: r?.store ?? null, p_old: new Date(e.sent_at) < new Date(SUPPLIES_START),
      }))
      if (id) made++
    }
  }
  return made
}

async function orderStep(db: SupabaseClient, org: string, started: number) {
  let matched = 0
  while (Date.now() - started < TIME_BUDGET_MS * 0.8) {
    const { data: openRows } = await db.from('supply_requests').select('id, requested_at, summary, status, ordered_from, order_number')
      .eq('organization_id', org).in('status', ['requested', 'ordered']).order('requested_at').limit(200)
    if (!openRows?.length) break
    const list = (await check(db.rpc('supply_confirmation_queue', { p_org: org, p_limit: 10 }))) as SupplyOrderEmail[] | null
    if (!list?.length) break
    const open: OpenSupply[] = openRows.map((r) => ({ id: r.id, requested_on: (r.requested_at as string).slice(0, 10), summary: r.summary, status: r.status, ordered_from: r.ordered_from, order_number: r.order_number }))
    const ids = new Set(open.map((o) => o.id))
    const readings = new Map((await readSupplyOrders(db, org, open, list)).map((r) => [r.id, r]))
    for (const e of list) {
      const r = readings.get(e.email_id)
      const reqs = (r?.request_ids ?? []).filter((x) => ids.has(x))
      const expected = r?.expected && /^\d{4}-\d{2}-\d{2}$/.test(r.expected) ? r.expected : null
      matched += (await check(db.rpc('supply_from_confirmation', {
        p_email: e.email_id, p_kind: reqs.length ? r!.kind : 'none', p_requests: reqs, p_seller: r?.seller ?? null,
        p_order: r?.order_number ?? null, p_expected: expected, p_total: r?.total ?? null, p_tracking: r?.tracking ?? null,
      }))) as number
    }
  }
  return matched
}

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })

interface Notice { id: string; summary: string; requested_by_name: string | null; requested_by_email: string; ordered_from: string | null; order_number: string | null; expected_at: string | null; gmail_thread_id: string | null; message_id_header: string | null; subject: string | null }

async function tellStep(db: SupabaseClient, org: string, mailbox: string | null) {
  const list = (await check(db.rpc('supply_notify_queue', { p_org: org }))) as Notice[] | null
  if (!list?.length || !mailbox) return 0
  const { data: admin } = await db.from('profiles').select('full_name').eq('organization_id', org).eq('role', 'admin').eq('is_active', true).order('created_at').limit(1).maybeSingle()
  const signer = (admin?.full_name as string | undefined)?.split(' ')[0] ?? 'Shaver Lake Sports'
  const gmail = new Gmail(await googleAccessToken(mailbox))
  let sent = 0
  for (const n of list) {
    const first = n.requested_by_name?.split(' ')[0]
    const text = [
      `Hi${first ? ` ${first}` : ''},`,
      '',
      `Your supply request is ordered: ${n.summary}.`,
      [n.ordered_from ? `Ordered from ${n.ordered_from}` : 'Ordered', n.order_number ? ` (order ${n.order_number})` : '', n.expected_at ? `, expected ${day(n.expected_at)}.` : '.'].join(''),
      '',
      'Thanks,',
      signer,
    ].join('\n')
    try {
      const subject = n.subject ? (/^re:/i.test(n.subject) ? n.subject : `Re: ${n.subject}`) : `Ordered: ${n.summary}`
      await gmail.send(buildMime({
        from: formatAddress('Shaver Lake Sports Orders', mailbox), to: [n.requested_by_email], subject, text,
        inReplyTo: n.message_id_header ?? undefined, headers: { 'X-VMS-Notice': 'supply' },
      }), n.gmail_thread_id ?? undefined)
      await check(db.rpc('supply_notified', { p_request: n.id, p_text: text, p_error: null }))
      sent++
    } catch (e) {
      await check(db.rpc('supply_notified', { p_request: n.id, p_text: text, p_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }))
    }
  }
  return sent
}
