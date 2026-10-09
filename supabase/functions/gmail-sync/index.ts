// gmail-sync: copy orders@ into VMS (docs/gmail-connection.md). Runs every few minutes from pg_cron
// (header x-cron-secret) and on "Sync now" (a signed-in admin, manager or buyer). Each run: new mail
// since the last run (Gmail history), then another slice of the 12-month backfill until it is done.
// Bodies are stored as plain text; matching and thread status happen in SQL (mail_process).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Gmail, GmailError, googleAccessToken } from '../_shared/gmail.ts'
import { clueText, htmlBody, isBulk, parseMessage, type Address, type GmailMessage, type GmailPart, type ParsedMessage } from '../_shared/mailParse.ts'
import { buildVendorIndex, domainVendors, mentionedVendors, shipperVendors, type VendorIndex } from '../_shared/mailMatch.ts'
import { extractLinks, seasonLabel, wantAttachment, wantLink } from '../_shared/offerFiles.ts'
import { aiEnabled, readEmailVendors, readPaidNote, readReplyNeeded, readSender, sortEmails, type ReplyEmail, type UnsureEmail } from '../_shared/ai.ts'
import { applyFreightReading, applyReceiptReading, freightIndex, freshText, invoiceNumberFrom, looksLikeBill, looksLikePaymentReceipt, looksLikeReceipt, mentionsPayment, proNumberFrom, readFreightPdf, readPaymentPdf, readReceiptPdf } from '../_shared/freight.ts'

// Small slices: an Edge Function run has little CPU time and memory, so each run takes about 100
// messages and the scheduler comes back every minute until the 12 months are in.
const TIME_BUDGET_MS = 20_000
const PAGE = 25
const PARALLEL = 5
const MAX_PER_RUN = 100
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'protonmail.com', 'proton.me'])

interface Account {
  organization_id: string; mailbox: string; internal_domains: string[]; history_id: string | null; backfill_after: string | null
  backfill_page_token: string | null; backfill_done: boolean; sync_started_at: string | null; messages_synced: number
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({})
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Who may run it: the scheduler, or a signed-in editor pressing Sync now.
  let onlyOrg: string | null = null
  const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
  if (!trusted) {
    const { data: u } = await db.auth.getUser(jwt)
    if (!u.user) return json({ error: 'Not signed in' }, 401)
    const { data: p } = await db.from('profiles').select('organization_id, role, is_active').eq('id', u.user.id).single()
    if (!p?.is_active || !['admin', 'manager', 'buyer'].includes(p.role)) return json({ error: 'Not allowed' }, 403)
    onlyOrg = p.organization_id
  }

  let q = db.from('mail_accounts').select('*')
  if (onlyOrg) q = q.eq('organization_id', onlyOrg)
  const { data: accounts, error } = await q
  if (error) return json({ error: error.message }, 500)
  const results = []
  for (const acct of (accounts ?? []) as Account[]) results.push(await syncAccount(db, acct))
  return json({ results })
})

async function syncAccount(db: SupabaseClient, acct: Account) {
  const started = Date.now()
  const org = acct.organization_id
  // One run at a time per mailbox; a run older than five minutes is assumed dead.
  if (acct.sync_started_at && Date.now() - new Date(acct.sync_started_at).getTime() < 5 * 60_000) return { org, skipped: 'already running' }
  await db.from('mail_accounts').update({ sync_started_at: new Date().toISOString() }).eq('organization_id', org)
  let stored = 0
  try {
    const gmail = new Gmail(await googleAccessToken(acct.mailbox))
    const labelNames = new Map((await gmail.labels()).labels.map((l) => [l.id, l.name]))
    const ctx = await loadContext(db, acct, labelNames)

    // Start the history cursor before the backfill so nothing that arrives meanwhile is missed.
    let historyId = acct.history_id
    if (!historyId) {
      historyId = (await gmail.profile()).historyId
      await db.from('mail_accounts').update({ history_id: historyId }).eq('organization_id', org)
    } else {
      const fresh: string[] = []
      const relabel = new Set<string>()
      let pageToken: string | undefined
      try {
        do {
          const h = await gmail.history(historyId, pageToken)
          for (const item of h.history ?? []) {
            for (const a of item.messagesAdded ?? []) fresh.push(a.message.id)
            for (const a of [...(item.labelsAdded ?? []), ...(item.labelsRemoved ?? [])]) relabel.add(a.message.id)
          }
          pageToken = h.nextPageToken
          historyId = h.historyId
        } while (pageToken)
      } catch (e) {
        // An expired cursor (404): pick up the last two days instead, then carry on from now.
        if (!(e instanceof GmailError && e.status === 404)) throw e
        const recent = await gmail.list('newer_than:2d -in:chats', undefined, 500)
        fresh.push(...(recent.messages ?? []).map((m) => m.id))
        historyId = (await gmail.profile()).historyId
      }
      stored += await storeMessages(db, gmail, ctx, fresh, false)
      await updateLabels(db, gmail, ctx, [...relabel].filter((id) => !fresh.includes(id)))
      await db.from('mail_accounts').update({ history_id: historyId }).eq('organization_id', org)
    }

    // Backfill slices while there is time left in this run.
    let pageToken = acct.backfill_page_token ?? undefined
    let done = acct.backfill_done
    while (!done && Date.now() - started < TIME_BUDGET_MS && stored < MAX_PER_RUN) {
      const after = (acct.backfill_after ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)).replace(/-/g, '/')
      const page = await gmail.list(`after:${after} -in:chats`, pageToken, PAGE)
      stored += await storeMessages(db, gmail, ctx, (page.messages ?? []).map((m) => m.id), true)
      pageToken = page.nextPageToken
      done = !pageToken
      await db.from('mail_accounts').update({ backfill_page_token: pageToken ?? null, backfill_done: done }).eq('organization_id', org)
    }

    // Older mail stored before the views existed: read its bulk-mail headers, a few hundred a run.
    if (done && Date.now() - started < TIME_BUDGET_MS) await readBulkHeaders(db, gmail, org)
    // Price lists, catalogs and order forms into the vendor's files, a few emails a run.
    if (done && Date.now() - started < TIME_BUDGET_MS) await saveVendorFiles(db, gmail, org, started)
    // Freight bills from carriers: a bill per invoice email; Claude reads the PDF when it is attached.
    if (done && Date.now() - started < TIME_BUDGET_MS) await freightBills(db, gmail, org, started)
    // Claude reads what the rules could not place (only with an API key).
    if (done && aiEnabled() && Date.now() - started < TIME_BUDGET_MS) await aiSteps(db, org, started)

    await db.from('mail_accounts').update({
      last_sync_at: new Date().toISOString(), last_error: null, sync_started_at: null, messages_synced: acct.messages_synced + stored,
    }).eq('organization_id', org)
    return { org, stored, backfill_done: done, ms: Date.now() - started }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from('mail_accounts').update({ last_error: message.slice(0, 1000), last_error_at: new Date().toISOString(), sync_started_at: null, messages_synced: acct.messages_synced + stored }).eq('organization_id', org)
    return { org, stored, error: message }
  }
}

interface Context { org: string; mailbox: string; internal: Set<string>; staff: Set<string>; index: VendorIndex; labelNames: Map<string, string> }

async function loadContext(db: SupabaseClient, acct: Account, labelNames: Map<string, string>): Promise<Context> {
  const vendors: { id: string; name: string; aliases: string[] }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('vendors').select('id, name, aliases').eq('organization_id', acct.organization_id).eq('is_active', true).range(from, from + 999)
    if (error) throw new Error(error.message)
    vendors.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const { data: org } = await db.from('organizations').select('name').eq('id', acct.organization_id).single()
  // Staff write from personal addresses too (billing.slsports@gmail.com): those are us, never a sender.
  const { data: people } = await db.from('profiles').select('email').eq('organization_id', acct.organization_id)
  const staff = new Set((people ?? []).map((p) => (p.email as string).toLowerCase()))
  // Our own names appear in every email (signatures, addresses); they are never a vendor clue.
  const ours = ['Shaver Lake', org?.name ?? ''].filter(Boolean)
  // PO numbers on file decide which vendor an email is about.
  const orders: { po_number: string | null; vendor_id: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('orders').select('po_number, vendor_id').eq('organization_id', acct.organization_id).not('po_number', 'is', null).range(from, from + 999)
    if (error) throw new Error(error.message)
    orders.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { org: acct.organization_id, mailbox: acct.mailbox.toLowerCase(), internal: new Set(acct.internal_domains.map((d) => d.toLowerCase())), staff, index: buildVendorIndex(vendors, ours, orders), labelNames }
}

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? ''

/** in = from outside; out = from us to someone outside; internal = only us. The other party is who the mail is with. */
function classify(ctx: Context, p: ParsedMessage): { direction: 'in' | 'out' | 'internal'; party: Address | null } {
  const ours = (a: Address) => a.email === ctx.mailbox || ctx.staff.has(a.email) || ctx.internal.has(domainOf(a.email))
  const fromUs = !p.from || ours(p.from) || p.label_ids.includes('SENT')
  if (!fromUs) return { direction: 'in', party: p.from }
  const outside = [...p.to, ...p.cc].find((a) => !ours(a))
  return outside ? { direction: 'out', party: outside } : { direction: 'internal', party: null }
}

async function fetchAll(gmail: Gmail, ids: string[], format: 'full' | 'minimal'): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += PARALLEL) {
    const batch = await Promise.all(ids.slice(i, i + PARALLEL).map((id) => gmail.message(id, format).catch((e) => {
      if (e instanceof GmailError && e.status === 404) return null // deleted since it was listed
      throw e
    })))
    out.push(...batch.filter((m): m is Record<string, unknown> => m !== null))
  }
  return out
}

async function storeMessages(db: SupabaseClient, gmail: Gmail, ctx: Context, ids: string[], backfill: boolean): Promise<number> {
  const unique = [...new Set(ids)]
  if (!unique.length) return 0
  const { data: have } = await db.from('emails').select('gmail_id').eq('organization_id', ctx.org).in('gmail_id', unique)
  const known = new Set((have ?? []).map((r) => r.gmail_id))
  const todo = unique.filter((id) => !known.has(id))
  if (!todo.length) return 0
  const parsed = (await fetchAll(gmail, todo, 'full')).map((m) => parseMessage(m as unknown as GmailMessage))
  // Gmail drafts and chats are not mail.
  const msgs = parsed.filter((p) => !p.label_ids.includes('DRAFT') && !p.label_ids.includes('CHAT'))
  if (!msgs.length) return 0

  // Senders: the other party's domain, or the whole address for free mail.
  const rows = msgs.map((p) => {
    const { direction, party } = classify(ctx, p)
    const domain = party ? domainOf(party.email) : ''
    const free = FREEMAIL.has(domain)
    return { p, direction, party, senderKey: party ? (free ? party.email : domain) : null, isDomain: !free }
  })
  const senderRows = new Map<string, { organization_id: string; sender_key: string; is_domain: boolean; display_name: string | null; domain_vendor_ids: string[] }>()
  for (const r of rows) {
    if (!r.senderKey || senderRows.has(r.senderKey)) continue
    senderRows.set(r.senderKey, {
      organization_id: ctx.org, sender_key: r.senderKey, is_domain: r.isDomain, display_name: r.party?.name ?? null,
      domain_vendor_ids: r.isDomain ? domainVendors(ctx.index, r.senderKey) : [],
    })
  }
  const senderIds = new Map<string, string>()
  if (senderRows.size) {
    const keys = [...senderRows.keys()]
    await check(db.from('email_senders').upsert([...senderRows.values()], { onConflict: 'organization_id,sender_key', ignoreDuplicates: true }))
    const { data } = await db.from('email_senders').select('id, sender_key').eq('organization_id', ctx.org).in('sender_key', keys)
    for (const s of data ?? []) senderIds.set(s.sender_key, s.id)
  }

  const threadKeys = [...new Set(msgs.map((p) => p.gmail_thread_id))]
  await check(db.from('email_threads').upsert(threadKeys.map((t) => ({ organization_id: ctx.org, gmail_thread_id: t })), { onConflict: 'organization_id,gmail_thread_id', ignoreDuplicates: true }))
  const threadIds = new Map<string, string>()
  for (let i = 0; i < threadKeys.length; i += 200) {
    const { data } = await db.from('email_threads').select('id, gmail_thread_id').eq('organization_id', ctx.org).in('gmail_thread_id', threadKeys.slice(i, i + 200))
    for (const t of data ?? []) threadIds.set(t.gmail_thread_id, t.id)
  }

  const emailRows = rows.map(({ p, direction, senderKey }) => ({
    organization_id: ctx.org,
    gmail_id: p.gmail_id,
    thread_id: threadIds.get(p.gmail_thread_id)!,
    message_id_header: p.message_id_header,
    in_reply_to: p.in_reply_to,
    direction,
    from_email: p.from?.email ?? null,
    from_name: p.from?.name ?? null,
    to_emails: p.to.map((a) => a.email),
    cc_emails: p.cc.map((a) => a.email),
    subject: p.subject,
    snippet: p.snippet,
    body_text: p.body_text,
    received_at: p.received_at,
    labels: p.label_ids.map((id) => ctx.labelNames.get(id) ?? id),
    has_attachments: p.attachments.length > 0,
    sender_id: senderKey ? senderIds.get(senderKey) ?? null : null,
    is_bulk: p.is_bulk,
    mentioned_vendor_ids: mentionedVendors(ctx.index, clueText(p)),
  }))
  const { data: inserted, error } = await db.from('emails').upsert(emailRows, { onConflict: 'organization_id,gmail_id', ignoreDuplicates: true }).select('id, gmail_id')
  if (error) throw new Error(`Saving mail: ${error.message}`)
  const idOf = new Map((inserted ?? []).map((r) => [r.gmail_id, r.id]))

  const attachments = rows.flatMap(({ p }) => idOf.has(p.gmail_id) ? p.attachments.map((a) => ({ ...a, organization_id: ctx.org, email_id: idOf.get(p.gmail_id)! })) : [])
  if (attachments.length) await check(db.from('email_attachments').insert(attachments))

  const newIds = [...idOf.values()]
  if (newIds.length) await check(db.rpc('mail_process', { p_org: ctx.org, p_email_ids: newIds, p_backfill: backfill }))
  return newIds.length
}

/** An attachment's bytes from Gmail (base64url). */
async function attachmentBytes(gmail: Gmail, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const part = await gmail.call<{ data: string }>(`messages/${messageId}/attachments/${attachmentId}`)
  const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Freight bills (Oct 8): each invoice email from a carrier becomes a freight bill for Trevor. With the PDF
 * attached (Worldwide Express), it is saved and Claude reads it into one line per shipper; without it
 * (PartnerShip), the bill waits for the PDF. Delivery receipts (XPO) are read and filed to the shipper's vendor and order.
 * A few emails a run; tracking updates are only marked looked-at.
 */
async function freightBills(db: SupabaseClient, gmail: Gmail, org: string, started: number) {
  let index: Awaited<ReturnType<typeof freightIndex>> | null = null

  // Bills made by hand from a PDF in an email ("Make a freight bill"): fetch it from Gmail and read it.
  const { data: made } = await db.from('freight_bills')
    .select('id, carriers(name), attachment:email_attachments!freight_bills_source_attachment_id_fkey(id, file_name, gmail_attachment_id, email:emails(gmail_id))')
    .eq('organization_id', org).eq('status', 'reading').not('source_attachment_id', 'is', null).is('storage_path', null).limit(3)
  for (const b of made ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const a = b.attachment as unknown as { id: string; file_name: string; gmail_attachment_id: string | null; email: { gmail_id: string } | null } | null
    try {
      if (!a?.gmail_attachment_id || !a.email) throw new Error('The PDF is not available from Gmail')
      const bytes = await attachmentBytes(gmail, a.email.gmail_id, a.gmail_attachment_id)
      const path = `${org}/freight/${crypto.randomUUID()}-${a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
      const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw new Error(`Saving ${a.file_name}: ${upErr.message}`)
      await db.from('freight_bills').update({ storage_path: path, file_name: a.file_name }).eq('id', b.id)
      const reading = await readFreightPdf(db, org, bytes, (b.carriers as unknown as { name: string } | null)?.name ?? 'a freight carrier')
      index ??= await freightIndex(db, org)
      await applyFreightReading(db, b.id, org, reading, index)
    } catch (err) {
      await db.from('freight_bills').update({ status: 'failed', read_note: (err instanceof Error ? err.message : String(err)).slice(0, 500) }).eq('id', b.id)
    }
  }

  const { data: queue } = await db.from('emails')
    .select('id, gmail_id, subject, body_text, received_at, thread:email_threads!inner(carrier_id, carriers(name)), attachments:email_attachments(id, file_name, mime_type, gmail_attachment_id)')
    .eq('organization_id', org).eq('direction', 'in').not('thread.carrier_id', 'is', null).is('freight_checked_at', null)
    .order('received_at', { ascending: false }).limit(6)
  for (const e of queue ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    // Freight mail is the carrier's conversation: its own address, or a partner's freight people (WWD Warehouse).
    const sender = e.thread as unknown as { carrier_id: string | null; carriers: { name: string } | null }
    try {
      const atts = (e.attachments ?? []) as { id: string; file_name: string; mime_type: string | null; gmail_attachment_id: string | null }[]
      const pdf = atts.find((a) => a.gmail_attachment_id && (/pdf/i.test(a.mime_type ?? '') || /\.pdf$/i.test(a.file_name)))
      if (pdf && looksLikePaymentReceipt(e.subject, e.body_text)) {
        // A payment receipt (Priority1): mark the bill it paid, keep the receipt on the bill.
        const bytes = await attachmentBytes(gmail, e.gmail_id, pdf.gmail_attachment_id!)
        const path = `${org}/freight/${crypto.randomUUID()}-${pdf.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
        if (upErr) throw new Error(`Saving ${pdf.file_name}: ${upErr.message}`)
        await db.from('email_attachments').update({ storage_path: path }).eq('id', pdf.id)
        if (aiEnabled()) {
          const p = await readPaymentPdf(db, org, bytes, sender.carriers?.name ?? 'a freight carrier')
          await check(db.rpc('freight_apply_payment', {
            p_org: org, p_carrier: sender.carrier_id, p_email: e.id, p_source: 'receipt', p_amount: p.amount, p_date: p.paid_on, p_via: p.method,
            p_ref: p.reference, p_invoices: p.invoice_numbers, p_payer: null, p_receipt_path: path, p_receipt_file: pdf.file_name,
          }))
        }
        await db.from('emails').update({ paid_read_at: new Date().toISOString() }).eq('id', e.id)
      } else if (pdf && looksLikeReceipt(e.subject)) {
        // A delivery receipt (XPO): file it to the shipper's vendor and order, never a bill.
        const { data: rcpt, error } = await db.from('delivery_receipts').upsert({
          organization_id: org, carrier_id: sender.carrier_id, email_id: e.id, pro_number: proNumberFrom(e.subject), file_name: pdf.file_name,
        }, { onConflict: 'email_id', ignoreDuplicates: true }).select('id').maybeSingle()
        if (error) throw new Error(error.message)
        if (rcpt) {
          const bytes = await attachmentBytes(gmail, e.gmail_id, pdf.gmail_attachment_id!)
          const path = `${org}/freight/${crypto.randomUUID()}-${pdf.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
          const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
          if (upErr) throw new Error(`Saving ${pdf.file_name}: ${upErr.message}`)
          await db.from('delivery_receipts').update({ storage_path: path }).eq('id', rcpt.id)
          await db.from('email_attachments').update({ storage_path: path }).eq('id', pdf.id)
          try {
            if (!aiEnabled()) throw new Error('Claude is not set up; pick the vendor by hand.')
            const reading = await readReceiptPdf(db, org, bytes, sender.carriers?.name ?? 'a freight carrier')
            index ??= await freightIndex(db, org)
            await applyReceiptReading(db, rcpt.id, reading, index)
          } catch (err) {
            await db.from('delivery_receipts').update({ status: 'failed', read_note: (err instanceof Error ? err.message : String(err)).slice(0, 500) }).eq('id', rcpt.id)
            await db.rpc('delivery_receipt_loaded', { p_receipt: rcpt.id })
          }
        }
      } else if (looksLikeBill(e.subject, e.body_text, !!pdf)) {
        const { data: bill, error } = await db.from('freight_bills').upsert({
          organization_id: org, carrier_id: sender.carrier_id, email_id: e.id, invoice_number: invoiceNumberFrom(e.subject), invoice_date: e.received_at.slice(0, 10),
          status: pdf ? 'reading' : 'needs_pdf',
        }, { onConflict: 'email_id', ignoreDuplicates: true }).select('id').maybeSingle()
        if (error) throw new Error(error.message)
        if (bill && pdf && aiEnabled()) {
          const bytes = await attachmentBytes(gmail, e.gmail_id, pdf.gmail_attachment_id!)
          const path = `${org}/freight/${crypto.randomUUID()}-${pdf.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
          const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
          if (upErr) throw new Error(`Saving ${pdf.file_name}: ${upErr.message}`)
          await db.from('freight_bills').update({ storage_path: path, file_name: pdf.file_name }).eq('id', bill.id)
          await db.from('email_attachments').update({ storage_path: path }).eq('id', pdf.id)
          try {
            const reading = await readFreightPdf(db, org, bytes, sender.carriers?.name ?? 'a freight carrier')
            index ??= await freightIndex(db, org)
            await applyFreightReading(db, bill.id, org, reading, index)
          } catch (err) {
            await db.from('freight_bills').update({ status: 'failed', read_note: (err instanceof Error ? err.message : String(err)).slice(0, 500) }).eq('id', bill.id)
          }
        } else if (bill && pdf) {
          await db.from('freight_bills').update({ status: 'needs_pdf', read_note: 'Claude is not set up; add the lines by hand.' }).eq('id', bill.id)
        }
      }
    } catch (err) {
      console.error(`freight from ${e.id}:`, err instanceof Error ? err.message : err)
    }
    await db.from('emails').update({ freight_checked_at: new Date().toISOString() }).eq('id', e.id)
  }

  // Our own "it's paid" on a carrier's conversation (Dana, Oct 8): "This order was paid by ACH 10/8/26 by Dana".
  if (!aiEnabled()) return
  const { data: ours } = await db.from('emails')
    .select('id, subject, body_text, received_at, thread:email_threads!inner(carrier_id)')
    .eq('organization_id', org).eq('direction', 'out').is('paid_read_at', null).not('thread.carrier_id', 'is', null)
    .gte('received_at', new Date(Date.now() - 45 * 86_400_000).toISOString()).order('received_at', { ascending: false }).limit(5)
  for (const e of ours ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    try {
      const text = freshText(e.body_text)
      if (mentionsPayment(`${e.subject ?? ''} ${text}`)) {
        const r = await readPaidNote(db, org, { subject: e.subject, text, sent_on: e.received_at.slice(0, 10) })
        if (r?.paid && r.sure) {
          await check(db.rpc('freight_apply_payment', {
            p_org: org, p_carrier: (e.thread as unknown as { carrier_id: string }).carrier_id, p_email: e.id, p_source: 'email', p_amount: r.amount, p_date: r.paid_on,
            p_via: r.method, p_ref: null, p_invoices: r.invoice_numbers, p_payer: r.payer, p_receipt_path: null, p_receipt_file: null,
          }))
        }
      }
    } catch (err) {
      console.error(`paid note ${e.id}:`, err instanceof Error ? err.message : err)
    }
    await db.from('emails').update({ paid_read_at: new Date().toISOString() }).eq('id', e.id)
  }
}

/**
 * Save price lists, catalogs, specials and order forms from mail filed to a vendor into that vendor's files
 * (docs/orders-and-mail-plan.md §2), and catalog / price-list links from offers mail. Mail filed later (a
 * sender answered in the review queue) is picked up the same way, so history catches up on its own.
 */
async function saveVendorFiles(db: SupabaseClient, gmail: Gmail, org: string, started: number) {
  const { data: queue } = await db.from('emails')
    .select('id, gmail_id, vendor_id, view, subject, received_at, has_attachments, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, vendor_link_id)')
    .eq('organization_id', org).eq('direction', 'in').not('vendor_id', 'is', null).is('files_scanned_at', null)
    .order('received_at', { ascending: false }).limit(25)
  for (const e of queue ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const atts = (e.attachments ?? []) as { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; vendor_link_id: string | null }[]
    const wanted = atts.filter((a) => !a.vendor_link_id && a.gmail_attachment_id).map((a) => ({ a, kind: wantAttachment(a, e.view, e.subject) })).filter((x) => x.kind)
    const lookForLinks = e.view === 'offers'
    try {
    if (wanted.length || lookForLinks) {
      const note = `From an email: ${e.subject ?? '(no subject)'}`
      const base = { organization_id: org, vendor_id: e.vendor_id, received_at: e.received_at.slice(0, 10), source: 'email', email_id: e.id, notes: note }
      for (const { a, kind } of wanted) {
        const part = await gmail.call<{ data: string }>(`messages/${e.gmail_id}/attachments/${a.gmail_attachment_id}`)
        const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
        const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const path = `${org}/${e.vendor_id}/${crypto.randomUUID()}-${a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: a.mime_type ?? 'application/octet-stream', upsert: false })
        if (upErr) throw new Error(`Saving ${a.file_name}: ${upErr.message}`)
        const { data: link } = await db.from('vendor_links').insert({
          ...base, kind, label: a.file_name.replace(/\.[a-z0-9]{2,5}$/i, ''), storage_path: path, file_name: a.file_name, file_size: bytes.length, mime_type: a.mime_type,
          season_label: seasonLabel(`${a.file_name} ${e.subject ?? ''}`, e.received_at),
        }).select('id').single()
        if (link) await db.from('email_attachments').update({ vendor_link_id: link.id, storage_path: path }).eq('id', a.id)
      }
      if (lookForLinks) {
        const html = htmlBody(await gmail.message(e.gmail_id, 'full') as unknown as GmailMessage)
        const found = extractLinks(html).map((l) => ({ l, kind: wantLink(l, e.subject) })).filter((x) => x.kind)
        if (found.length) {
          const { data: have } = await db.from('vendor_links').select('url').eq('vendor_id', e.vendor_id).in('url', found.map((f) => f.l.url))
          const known = new Set((have ?? []).map((h) => h.url))
          const rows = found.filter((f, i) => !known.has(f.l.url) && found.findIndex((g) => g.l.url === f.l.url) === i).slice(0, 10).map(({ l, kind }) => ({
            ...base, kind, url: l.url, label: (l.text && l.text.length < 120 ? l.text : null) ?? decodeURIComponent(l.url.split(/[?#]/)[0]!.split('/').pop() ?? 'Link'),
            season_label: seasonLabel(`${l.text} ${e.subject ?? ''}`, e.received_at),
          }))
          if (rows.length) await check(db.from('vendor_links').insert(rows))
        }
      }
    }
    } catch (err) {
      // One bad file must not hold up the rest; the email is marked looked-at and stays in Mail.
      console.error(`files from ${e.id}:`, err instanceof Error ? err.message : err)
    }
    await db.from('emails').update({ files_scanned_at: new Date().toISOString() }).eq('id', e.id)
  }
}

/**
 * Claude, on the cheapest model: sort emails the rules left unsure, and read "Who is this mail from?"
 * senders with no guess. A failure here never stops the sync; the work is picked up next run.
 */
async function aiSteps(db: SupabaseClient, org: string, started: number) {
  try {
    const { data: unsure } = await db.rpc('mail_unsure_emails', { p_org: org, p_limit: 40 })
    const list = (unsure ?? []) as UnsureEmail[]
    for (let i = 0; i < list.length && Date.now() - started < TIME_BUDGET_MS; i += 20) {
      const batch = list.slice(i, i + 20)
      const views = await sortEmails(db, org, batch)
      await check(db.rpc('mail_set_ai_views', { p_org: org, p_ids: batch.map((e) => e.id), p_views: batch.map((e) => views.get(e.id) ?? 'unsure') }))
    }

    // Does the newest email of each conversation waiting on us need an answer? (Dana, Oct 8.) Ads go to
    // Handled without asking; Claude reads the rest, ten at a time; unsure ones become review cards.
    const { data: waiting } = await db.rpc('mail_reply_queue', { p_org: org, p_limit: 30 })
    const replyList = (waiting ?? []) as ReplyEmail[]
    let rIndex: Awaited<ReturnType<typeof freightIndex>> | null = null
    for (const e of replyList.filter((x) => x.sender_kind === 'marketing')) {
      await check(db.rpc('mail_apply_reply', { p_email: e.email_id, p_reply: 'no', p_note: 'Marketing', p_ship: null, p_shipper: null }))
    }
    const toRead = replyList.filter((x) => x.sender_kind !== 'marketing')
    for (let i = 0; i < toRead.length && Date.now() - started < TIME_BUDGET_MS; i += 10) {
      const batch = toRead.slice(i, i + 10)
      const readings = await readReplyNeeded(db, org, batch)
      for (const e of batch) {
        const r = readings.get(e.email_id)
        if (!r) continue
        let shipper: string | null = null
        if (r.shipper && e.sender_kind === 'carrier') {
          rIndex ??= await freightIndex(db, org)
          const ids = shipperVendors(rIndex, r.shipper)
          if (ids.length === 1) shipper = ids[0]!
        }
        await check(db.rpc('mail_apply_reply', { p_email: e.email_id, p_reply: r.reply, p_note: r.note, p_ship: r.ship_status, p_shipper: shipper }))
      }
    }

    // Mail from Worldwide, carriers, services and rep groups: every vendor it names gets the email too, and a
    // quoted freight rate (Worldwide's pallet rate) is kept for check-in. Last 90 days, a few a run.
    const { data: multi } = await db.from('emails')
      .select('id, subject, body_text, sender:email_senders!inner(kind)')
      .eq('organization_id', org).eq('direction', 'in').is('vendors_read_at', null).not('is_bulk', 'is', true)
      .in('sender.kind', ['platform', 'carrier', 'rep_group'])
      .gte('received_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
      .order('received_at', { ascending: false }).limit(8)
    let vIndex: Awaited<ReturnType<typeof freightIndex>> | null = null
    for (const e of multi ?? []) {
      if (Date.now() - started > TIME_BUDGET_MS) break
      const reading = await readEmailVendors(db, org, e)
      vIndex ??= await freightIndex(db, org)
      const ids = [...new Set((reading?.vendors ?? []).flatMap((n) => shipperVendors(vIndex!, n)))]
      if (ids.length) await check(db.from('email_vendor_tags').upsert(ids.map((vendor_id) => ({ email_id: e.id, vendor_id, organization_id: org, how: 'ai' })), { onConflict: 'email_id,vendor_id', ignoreDuplicates: true }))
      await check(db.from('emails').update({ vendors_read_at: new Date().toISOString(), freight_pct: reading?.freight_pct ?? null }).eq('id', e.id))
    }

    const { data: senders } = await db.from('email_senders').select('id, sender_key, display_name')
      .eq('organization_id', org).eq('kind', 'unknown').is('ai_read_at', null).is('proposed_vendor_id', null).gt('message_count', 0)
      .order('message_count', { ascending: false }).limit(4)
    if (!senders?.length) return
    const { data: vendors } = await db.from('vendors').select('id, name').eq('organization_id', org).eq('is_active', true).order('name').limit(5000)
    const byName = new Map((vendors ?? []).map((v) => [v.name.toLowerCase().replace(/[^a-z0-9]+/g, ''), v.id as string]))
    const vendorList = (vendors ?? []).map((v) => v.name).join('\n')
    const { data: reps } = await db.from('rep_groups').select('name, email, vendors(name)').eq('organization_id', org).eq('is_active', true).order('name')
    const repList = (reps ?? []).map((g) => `${g.name}${g.email ? ` <${g.email}>` : ''}: ${((g.vendors ?? []) as { name: string }[]).map((v) => v.name).join(', ') || 'no lines on file'}`).join('\n')
    for (const s of senders) {
      if (Date.now() - started > TIME_BUDGET_MS) break
      const { data: mails } = await db.from('emails').select('subject, body_text, snippet').eq('sender_id', s.id).order('received_at', { ascending: false }).limit(3)
      const reading = await readSender(db, org, vendorList, repList, {
        key: s.sender_key, display_name: s.display_name,
        samples: (mails ?? []).map((m) => ({ subject: m.subject, text: (m.body_text || m.snippet || '').replace(/\s+/g, ' ').slice(0, 600) })),
      })
      if (!reading) continue
      const vendorId = reading.kind === 'vendor' && reading.vendor_name ? byName.get(reading.vendor_name.toLowerCase().replace(/[^a-z0-9]+/g, '')) ?? null : null
      const note = reading.kind === 'vendor' && reading.vendor_name && !vendorId ? `${reading.vendor_name}, not in your vendor list yet. ${reading.note}` : reading.note
      await check(db.rpc('mail_set_sender_ai', { p_sender: s.id, p_kind: reading.kind, p_vendor: vendorId, p_note: note }))
    }
  } catch (e) {
    console.error('Claude step:', e instanceof Error ? e.message : e)
  }
}

/** Fill emails.is_bulk for mail stored before it was read, then let SQL re-sort those emails. */
async function readBulkHeaders(db: SupabaseClient, gmail: Gmail, org: string) {
  const { data } = await db.from('emails').select('id, gmail_id').eq('organization_id', org).is('is_bulk', null).eq('direction', 'in').limit(300)
  if (!data?.length) return
  const ids: string[] = []
  const flags: boolean[] = []
  for (let i = 0; i < data.length; i += PARALLEL * 2) {
    const batch = await Promise.all(data.slice(i, i + PARALLEL * 2).map(async (e) => {
      try {
        const m = await gmail.headers(e.gmail_id, ['List-Unsubscribe', 'Precedence'])
        return { id: e.id, bulk: isBulk(m.payload as GmailPart | undefined) }
      } catch (err) {
        if (err instanceof GmailError && err.status === 404) return { id: e.id, bulk: false } // gone from Gmail
        throw err
      }
    }))
    for (const b of batch) { ids.push(b.id); flags.push(b.bulk) }
  }
  await check(db.rpc('mail_set_bulk', { p_org: org, p_ids: ids, p_bulk: flags }))
}

/** Labels changed in Gmail (Assigned/<name>, stars): keep ours in step. */
async function updateLabels(db: SupabaseClient, gmail: Gmail, ctx: Context, ids: string[]) {
  if (!ids.length) return
  for (const m of await fetchAll(gmail, ids.slice(0, 200), 'minimal')) {
    const labels = ((m.labelIds as string[] | undefined) ?? []).map((id) => ctx.labelNames.get(id) ?? id)
    await db.from('emails').update({ labels }).eq('organization_id', ctx.org).eq('gmail_id', m.id as string)
  }
}

async function check(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) throw new Error(error.message)
}
