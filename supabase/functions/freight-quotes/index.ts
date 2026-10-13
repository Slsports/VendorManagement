// freight-quotes: vendors' freight quotes become freight quotes on their orders and a task for Trevor (Dana, Oct 13: "No
// order is to be shipped without a freight quote from the vendor"). Runs every minute from pg_cron (header x-cron-secret).
// Mail from Oct 14 on, Orders mail or shared conversations only:
//   1. read   — Claude (cheapest model): is it a freight quote, the quote, the shipment details, the numbers in it
//   2. vendor — the vendor the email is filed to, else the one it names, else the ship-from zip
//   3. order  — our PO → the vendor's own order/confirmation/invoice number → the conversation → Claude compares the quote
//               with the vendor's open orders ("Sometimes the vendors screw up and dont use our po"; never "only one open
//               order" alone) → none: the task asks "which order?" and Trevor picks
//   4. save   — freight_quote_apply: the freight quote and "Get freight quote: <vendor>, PO <number>" due the next business day
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, pickFreightOrder, readFreightQuote, type FreightQuoteReading } from '../_shared/ai.ts'

const TIME_BUDGET_MS = 90_000

interface Queued { email_id: string; thread_id: string | null; vendor_id: string | null; sender_kind: string | null; from_name: string | null; from_email: string | null; subject: string | null; body_text: string; received_at: string; attachments: string[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const { data: accounts } = await db.from('mail_accounts').select('organization_id')
    const out: Record<string, unknown[]> = {}
    for (const a of accounts ?? []) {
      const org = a.organization_id as string
      const done: unknown[] = []
      while (Date.now() - started < TIME_BUDGET_MS * 0.7) {
        const { data, error } = await db.rpc('freight_quote_queue', { p_org: org, p_limit: 5 })
        if (error) throw new Error(error.message)
        const batch = (data ?? []) as Queued[]
        if (!batch.length) break
        for (const q of batch) done.push(await handle(db, org, q))
      }
      out[org] = done
    }
    return json(out)
  } catch (e) {
    return errorResponse(e)
  }
})

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

async function handle(db: SupabaseClient, org: string, q: Queued) {
  try {
    const r = await readFreightQuote(db, org, { from: [q.from_name, q.from_email].filter(Boolean).join(' '), subject: q.subject, text: ownPart(q.body_text), attachments: q.attachments })
    if (!r?.is_quote) {
      await apply(db, q.email_id, false, null, null, null, null)
      return { email: q.email_id, quote: false }
    }
    const vendorId = q.sender_kind === 'vendor' || q.sender_kind === 'rep_group' ? q.vendor_id ?? await vendorFor(db, org, r) : await vendorFor(db, org, r) ?? q.vendor_id
    const { order, how } = await orderFor(db, org, q, r, vendorId)
    const id = await apply(db, q.email_id, true, r, vendorId, order, how)
    return { email: q.email_id, quote: id, order, how }
  } catch (e) {
    return { email: q.email_id, error: e instanceof Error ? e.message : String(e) }
  }
}

async function apply(db: SupabaseClient, email: string, isQuote: boolean, r: FreightQuoteReading | null, vendor: string | null, order: string | null, how: string | null) {
  const reading = r ? { carrier: r.carrier, service: r.service, cost: r.cost === null ? null : String(r.cost), transit: r.transit, details: r.details } : {}
  const { data, error } = await db.rpc('freight_quote_apply', { p_email: email, p_is_quote: isQuote, p_reading: reading, p_vendor: vendor, p_order: order, p_how: how })
  if (error) throw new Error(error.message)
  return data as string | null
}

/** The email without the earlier mail quoted under it. */
function ownPart(text: string): string {
  const m = /\n(?:On .{4,200}wrote:|-{3,} ?Original Message|_{10,}|From: .+\n(?:Sent|Date): )/i.exec(text)
  return (m ? text.slice(0, m.index) : text).trim()
}

/** The vendor a freight company's email is about: the name it gives, else the ship-from zip (one vendor there). */
async function vendorFor(db: SupabaseClient, org: string, r: FreightQuoteReading): Promise<string | null> {
  if (r.vendor_name) {
    const { data } = await db.rpc('vendor_by_name', { p_org: org, p_name: r.vendor_name })
    if (data) return data as string
  }
  const zip = (r.details.ship_from_zip ?? '').match(/\d{5}/)?.[0]
  if (zip) {
    const { data } = await db.from('vendors').select('id').eq('organization_id', org).eq('is_active', true).like('postal_code', `${zip}%`).limit(2)
    if (data?.length === 1) return data[0]!.id
  }
  return null
}

async function orderFor(db: SupabaseClient, org: string, q: Queued, r: FreightQuoteReading, vendorId: string | null): Promise<{ order: string | null; how: string | null }> {
  const one = (ids: (string | null | undefined)[]) => {
    const set = [...new Set(ids.filter(Boolean) as string[])]
    return set.length === 1 ? set[0]! : null
  }
  // 1. our PO number
  const pos = r.po_numbers.map(norm).filter((p) => p.length >= 3)
  if (pos.length) {
    let query = db.from('orders').select('id, po_number').eq('organization_id', org).neq('status', 'cancelled').not('po_number', 'is', null)
    if (vendorId) query = query.eq('vendor_id', vendorId)
    const { data } = await query.limit(2000)
    const hit = one((data ?? []).filter((o) => pos.includes(norm(o.po_number))).map((o) => o.id))
    if (hit) return { order: hit, how: 'po' }
  }
  // 2. the vendor's own numbers: a confirmation or invoice on file, or the order notes
  const nums = r.vendor_numbers.map(norm).filter((n) => n.length >= 4)
  if (nums.length) {
    let checks = db.from('order_checks').select('order_id, doc_number').eq('organization_id', org).not('order_id', 'is', null).not('doc_number', 'is', null)
    if (vendorId) checks = checks.eq('vendor_id', vendorId)
    const { data: c } = await checks.limit(2000)
    let hit = one((c ?? []).filter((x) => nums.includes(norm(x.doc_number))).map((x) => x.order_id))
    if (!hit && vendorId) {
      const { data: o } = await db.from('orders').select('id, notes').eq('vendor_id', vendorId).neq('status', 'cancelled').not('notes', 'is', null)
      hit = one((o ?? []).filter((x) => nums.some((n) => norm(x.notes).includes(n))).map((x) => x.id))
    }
    if (hit) return { order: hit, how: 'vendor_number' }
  }
  // 3. the conversation it is in
  if (q.thread_id) {
    const { data } = await db.from('emails').select('order_id').eq('thread_id', q.thread_id).not('order_id', 'is', null).neq('id', q.email_id)
    const hit = one((data ?? []).map((e) => e.order_id))
    if (hit) return { order: hit, how: 'conversation' }
  }
  // 4. Claude compares the quote with the vendor's open orders
  if (vendorId) {
    const { data: open } = await db.from('orders').select('id, po_number, order_date, est_cost, final_cost, est_ship_date, description, lines:order_lines(description, vendor_item_id)')
      .eq('vendor_id', vendorId).in('status', ['open', 'awaiting_confirmation', 'confirmed']).order('order_date', { ascending: false }).limit(25)
    const list = (open ?? []).map((o) => ({
      id: o.id, po: o.po_number, placed: o.order_date, amount: o.est_cost ?? o.final_cost, ship_window: o.est_ship_date, description: o.description,
      items: ((o.lines ?? []) as { description: string | null; vendor_item_id: string | null }[]).slice(0, 8).map((l) => [l.vendor_item_id, l.description].filter(Boolean).join(' ')),
    }))
    const hit = await pickFreightOrder(db, org, r, list)
    if (hit) return { order: hit, how: 'claude' }
  }
  return { order: null, how: null }
}
