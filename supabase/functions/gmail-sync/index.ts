// gmail-sync: copy orders@ into VMS (docs/gmail-connection.md). Runs every few minutes from pg_cron
// (header x-cron-secret) and on "Sync now" (a signed-in admin, manager or buyer). Each run: new mail
// since the last run (Gmail history), then another slice of the 12-month backfill until it is done.
// Bodies are stored as plain text; matching and thread status happen in SQL (mail_process).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Gmail, GmailError, googleAccessToken } from '../_shared/gmail.ts'
import { clueText, htmlBody, isBulk, isOldGmail, parseMessage, type Address, type GmailMessage, type GmailPart, type ParsedMessage } from '../_shared/mailParse.ts'
import { buildVendorIndex, domainVendors, mentionedVendors, shipperVendors, type VendorIndex } from '../_shared/mailMatch.ts'
import { extractLinks, itemPicture, maybePaperwork, paperworkKind, pictureLabel, seasonLabel, wantAttachment, wantLink } from '../_shared/offerFiles.ts'
import { aiEnabled, classifyPaperwork, classifyPictures, imageType, type PictureKind, readArtwork, readEmailVendors, readPaidNote, readPromises, readRepLines, readReplyNeeded, sortEmails, sortSenders, type ArtEmail, type PromiseEmail, type ReplyEmail, type SenderToSort, type UnsureEmail } from '../_shared/ai.ts'
import { applyFreightReading, applyReceiptReading, freightIndex, freshText, invoiceFromBody, invoiceNumberFrom, looksLikeBill, looksLikePaymentReceipt, looksLikeReceipt, mentionsPayment, proNumberFrom, readFreightPdf, readPaymentPdf, readReceiptPdf } from '../_shared/freight.ts'

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
  /** A personal mailbox (Dana, Oct 11): its row in mailboxes and its owner; null for the shared orders@. */
  box_id: string | null; owner_id: string | null
  /** The old Gmail, which arrives in orders@ (only on the shared account). */
  legacy: { id: string; address: string } | null
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

  // the picture back-check (Dana, Oct 15), run by hand from the scheduler's secret
  const body = await req.clone().json().catch(() => ({})) as { pictures_backcheck?: boolean }
  if (trusted && body.pictures_backcheck) {
    const { data: orgs } = await db.from('mail_accounts').select('organization_id')
    const started = Date.now()
    const out: unknown[] = []
    for (const o of orgs ?? []) out.push(await picturesBackcheck(db, o.organization_id, started))
    return json(out)
  }

  let q = db.from('mail_accounts').select('*')
  if (onlyOrg) q = q.eq('organization_id', onlyOrg)
  const { data: accounts, error } = await q
  if (error) return json({ error: error.message }, 500)
  // Personal mailboxes and the old Gmail (Dana, Oct 11) after orders@.
  let mq = db.from('mailboxes').select('id, organization_id, kind, address, owner_id, history_id, backfill_after, backfill_page_token, backfill_done, sync_started_at, messages_synced').eq('is_active', true)
  if (onlyOrg) mq = mq.eq('organization_id', onlyOrg)
  const { data: boxes } = await mq
  const results = []
  for (const a of (accounts ?? []) as Account[]) {
    const legacy = (boxes ?? []).find((b) => b.organization_id === a.organization_id && b.kind === 'legacy')
    results.push(await syncAccount(db, { ...a, box_id: null, owner_id: null, legacy: legacy ? { id: legacy.id, address: legacy.address } : null }))
  }
  for (const b of (boxes ?? []).filter((x) => x.kind === 'personal')) {
    const shared = (accounts ?? []).find((a) => a.organization_id === b.organization_id) as Account | undefined
    results.push(await syncAccount(db, { ...b, mailbox: b.address, internal_domains: shared?.internal_domains ?? [], box_id: b.id, owner_id: b.owner_id, legacy: null } as Account))
  }
  return json({ results })
})

/** Save sync state on the account's own row: mail_accounts for orders@, mailboxes for a personal one. */
function saveState(db: SupabaseClient, acct: Account, fields: Record<string, unknown>) {
  return acct.box_id ? db.from('mailboxes').update(fields).eq('id', acct.box_id) : db.from('mail_accounts').update(fields).eq('organization_id', acct.organization_id)
}

async function syncAccount(db: SupabaseClient, acct: Account) {
  // a personal mailbox gets a short slice of each run (orders@ comes first)
  const started = acct.box_id ? Date.now() - (TIME_BUDGET_MS - 8_000) : Date.now()
  const org = acct.organization_id
  // One run at a time per mailbox; a run older than five minutes is assumed dead.
  if (acct.sync_started_at && Date.now() - new Date(acct.sync_started_at).getTime() < 5 * 60_000) return { org, mailbox: acct.mailbox, skipped: 'already running' }
  await saveState(db, acct, { sync_started_at: new Date().toISOString() })
  let stored = 0
  try {
    const gmail = new Gmail(await googleAccessToken(acct.mailbox))
    const labelNames = new Map((await gmail.labels()).labels.map((l) => [l.id, l.name]))
    const ctx = await loadContext(db, acct, labelNames)

    // Start the history cursor before the backfill so nothing that arrives meanwhile is missed.
    let historyId = acct.history_id
    if (!historyId) {
      historyId = (await gmail.profile()).historyId
      await saveState(db, acct, { history_id: historyId })
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
      await saveState(db, acct, { history_id: historyId })
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
      await saveState(db, acct, { backfill_page_token: pageToken ?? null, backfill_done: done })
    }

    // Older mail stored before the views existed: read its bulk-mail headers, a few hundred a run.
    if (done && Date.now() - started < TIME_BUDGET_MS) await readBulkHeaders(db, gmail, org, ctx.mailbox)
    // Price lists, catalogs and order forms into the vendor's files, a few emails a run.
    if (done && Date.now() - started < TIME_BUDGET_MS) await saveVendorFiles(db, gmail, org, started, ctx.mailbox)
    // Vendors' order confirmations and invoices into their folders; order-check compares them with the order.
    if (done && Date.now() - started < TIME_BUDGET_MS) await savePaperwork(db, gmail, org, started, ctx.mailbox)
    // Pictures of items from vendors into their Images folder (12 months back); artwork proofs stay in the email.
    if (done && Date.now() - started < TIME_BUDGET_MS) await saveItemPictures(db, gmail, org, started, ctx.mailbox)
    // Freight bills from carriers: a bill per invoice email; Claude reads the PDF when it is attached.
    if (done && Date.now() - started < TIME_BUDGET_MS) await freightBills(db, gmail, org, started, ctx.mailbox)
    // Claude reads what the rules could not place (only with an API key).
    if (done && !acct.box_id && aiEnabled() && Date.now() - started < TIME_BUDGET_MS) await aiSteps(db, org, started)

    await saveState(db, acct, { last_sync_at: new Date().toISOString(), last_error: null, sync_started_at: null, messages_synced: acct.messages_synced + stored })
    return { org, mailbox: acct.mailbox, stored, backfill_done: done, ms: Date.now() - started }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await saveState(db, acct, { last_error: message.slice(0, 1000), last_error_at: new Date().toISOString(), sync_started_at: null, messages_synced: acct.messages_synced + stored })
    return { org, mailbox: acct.mailbox, stored, error: message }
  }
}

interface Context { org: string; mailbox: string; internal: Set<string>; staff: Set<string>; index: VendorIndex; labelNames: Map<string, string>; boxId: string | null; legacy: { id: string; address: string } | null }

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
  return { org: acct.organization_id, mailbox: acct.mailbox.toLowerCase(), internal: new Set(acct.internal_domains.map((d) => d.toLowerCase())), staff, index: buildVendorIndex(vendors, ours, orders), labelNames, boxId: acct.box_id, legacy: acct.legacy }
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
  // Gmail drafts and chats are not mail, nor VMS's own task reminders.
  const msgs = parsed.filter((p) => !p.label_ids.includes('DRAFT') && !p.label_ids.includes('CHAT') && !p.vms_notice)
  if (!msgs.length) return 0

  // Senders: the other party's domain, or the whole address for free mail. Which mailbox: a personal one, the
  // old Gmail (forwarded into orders@), or orders@ (null).
  const rows = msgs.map((p) => {
    const { direction, party } = classify(ctx, p)
    const domain = party ? domainOf(party.email) : ''
    const free = FREEMAIL.has(domain)
    const boxId = ctx.boxId ?? (ctx.legacy && isOldGmail(p, ctx.legacy.address) ? ctx.legacy.id : null)
    return { p, direction, party, senderKey: party ? (free ? party.email : domain) : null, isDomain: !free, boxId }
  })
  // Private mail (personal, old Gmail) never adds new senders: they would ask everyone "who is this?". It still
  // uses the senders VMS knows.
  const senderRows = new Map<string, { organization_id: string; sender_key: string; is_domain: boolean; display_name: string | null; domain_vendor_ids: string[] }>()
  for (const r of rows) {
    if (!r.senderKey || senderRows.has(r.senderKey) || r.boxId) continue
    senderRows.set(r.senderKey, {
      organization_id: ctx.org, sender_key: r.senderKey, is_domain: r.isDomain, display_name: r.party?.name ?? null,
      domain_vendor_ids: r.isDomain ? domainVendors(ctx.index, r.senderKey) : [],
    })
  }
  const senderIds = new Map<string, string>()
  const keys = [...new Set(rows.map((r) => r.senderKey).filter((k): k is string => !!k))]
  if (keys.length) {
    if (senderRows.size) await check(db.from('email_senders').upsert([...senderRows.values()], { onConflict: 'organization_id,sender_key', ignoreDuplicates: true }))
    const { data } = await db.from('email_senders').select('id, sender_key').eq('organization_id', ctx.org).in('sender_key', keys)
    for (const s of data ?? []) senderIds.set(s.sender_key, s.id)
  }

  const threadKeys = [...new Set(msgs.map((p) => p.gmail_thread_id))]
  const threadBox = new Map(rows.map((r) => [r.p.gmail_thread_id, r.boxId]))
  await check(db.from('email_threads').upsert(threadKeys.map((t) => ({ organization_id: ctx.org, gmail_thread_id: t, mailbox_id: threadBox.get(t) ?? null })), { onConflict: 'organization_id,gmail_thread_id', ignoreDuplicates: true }))
  const threadIds = new Map<string, string>()
  for (let i = 0; i < threadKeys.length; i += 200) {
    const { data } = await db.from('email_threads').select('id, gmail_thread_id').eq('organization_id', ctx.org).in('gmail_thread_id', threadKeys.slice(i, i + 200))
    for (const t of data ?? []) threadIds.set(t.gmail_thread_id, t.id)
  }

  const emailRows = rows.map(({ p, direction, senderKey, boxId }) => ({
    organization_id: ctx.org,
    mailbox_id: boxId,
    gmail_box: ctx.mailbox,
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
async function freightBills(db: SupabaseClient, gmail: Gmail, org: string, started: number, box: string) {
  let index: Awaited<ReturnType<typeof freightIndex>> | null = null

  // Bills made by hand from a PDF in an email ("Make a freight bill"): fetch it from Gmail and read it.
  const { data: made } = await db.from('freight_bills')
    .select('id, carriers(name), attachment:email_attachments!freight_bills_source_attachment_id_fkey(id, file_name, gmail_attachment_id, email:emails(gmail_id, gmail_box))')
    .eq('organization_id', org).eq('status', 'reading').not('source_attachment_id', 'is', null).is('storage_path', null).limit(3)
  for (const b of made ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const a = b.attachment as unknown as { id: string; file_name: string; gmail_attachment_id: string | null; email: { gmail_id: string; gmail_box: string | null } | null } | null
    if (a?.email?.gmail_box && a.email.gmail_box !== box) continue // another mailbox's run fetches it
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
    .select('id, gmail_id, subject, body_text, received_at, thread:email_threads!emails_thread_id_fkey!inner(carrier_id, carriers(name)), attachments:email_attachments(id, file_name, mime_type, gmail_attachment_id)')
    .eq('organization_id', org).eq('gmail_box', box).is('copy_of', null).eq('direction', 'in').not('thread.carrier_id', 'is', null).is('freight_checked_at', null)
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
          // PartnerShip lists the invoice in the email body; WWEX puts the number in the subject.
          organization_id: org, carrier_id: sender.carrier_id, email_id: e.id, invoice_number: invoiceNumberFrom(e.subject) ?? invoiceFromBody(e.body_text)?.invoice_number ?? null,
          invoice_date: invoiceFromBody(e.body_text)?.invoice_date ?? e.received_at.slice(0, 10), due_date: invoiceFromBody(e.body_text)?.due_date ?? null, total: invoiceFromBody(e.body_text)?.total ?? null,
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
    .select('id, subject, body_text, received_at, thread:email_threads!emails_thread_id_fkey!inner(carrier_id)')
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
async function saveVendorFiles(db: SupabaseClient, gmail: Gmail, org: string, started: number, box: string) {
  const { data: queue } = await db.from('emails')
    .select('id, gmail_id, vendor_id, view, subject, received_at, has_attachments, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, vendor_link_id)')
    .eq('organization_id', org).eq('gmail_box', box).is('copy_of', null).eq('direction', 'in').not('vendor_id', 'is', null).is('files_scanned_at', null)
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
        if (await linkExistingCopy(db, e.vendor_id, a)) continue
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
 * "No duplicates" (Dana, Oct 14): when the vendor already has this file (same name and size), the attachment is linked to
 * the copy on file and nothing is saved. True when it was linked.
 */
async function linkExistingCopy(db: SupabaseClient, vendorId: string, a: { id: string; file_name: string; size: number | null }): Promise<boolean> {
  if (!a.size) return false
  const { data } = await db.from('vendor_links').select('id, storage_path').eq('vendor_id', vendorId).ilike('file_name', a.file_name.replace(/[%_\\]/g, (c) => `\\${c}`))
    .eq('file_size', a.size).not('storage_path', 'is', null).limit(1)
  const hit = data?.[0]
  if (!hit) return false
  await db.from('email_attachments').update({ vendor_link_id: hit.id, storage_path: hit.storage_path }).eq('id', a.id)
  return true
}

/**
 * Order paperwork (Dana, Oct 10): a vendor's confirmation or invoice attached to their email goes into that
 * vendor's Confirmations or Invoices folder for the year; saving it starts the order check (order-check reads
 * it, finds the order, compares, and puts it in front of whoever placed the order). Credit memos go to Credits (Dana,
 * Oct 14). Mail from billing systems (WFS's NetSuite) counts too, by file name and subject only. A file the vendor already
 * has on file is linked, never saved twice. Last 12 months, a few a run (only the last 6 months get an order check).
 */
async function savePaperwork(db: SupabaseClient, gmail: Gmail, org: string, started: number, box: string) {
  const { data: queue } = await db.from('emails')
    .select('id, gmail_id, vendor_id, subject, body_text, view, is_bulk, received_at, vendor:vendors!emails_vendor_id_fkey(name), attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, vendor_link_id)')
    .eq('organization_id', org).eq('gmail_box', box).is('copy_of', null).eq('direction', 'in').not('vendor_id', 'is', null).is('paper_scanned_at', null).eq('has_attachments', true)
    .gte('received_at', new Date(Date.now() - 365 * 86_400_000).toISOString())
    .order('received_at', { ascending: false }).limit(10)
  let asked = 0
  for (const e of queue ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    // claim it first: two runs at once both filed the same Smith invoices (Oct 15), so the second run skips it
    const { data: mine } = await db.from('emails').update({ paper_scanned_at: new Date().toISOString() }).eq('id', e.id).is('paper_scanned_at', null).select('id')
    if (!mine?.length) continue
    try {
      const atts = (e.attachments ?? []) as { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; vendor_link_id: string | null }[]
      const open = atts.filter((a) => !a.vendor_link_id && a.gmail_attachment_id && (a.size ?? 0) <= 15 * 1024 * 1024 && (maybePaperwork(a) || paperworkKind(a, null) === 'credit'))
      // the email's own words count only when it carries one or two such files (Dom's "S102112.pdf", Dana Oct 13), and
      // never for billing-system mail (its words are the same boilerplate on every email)
      const body = open.length <= 2 && !e.is_bulk ? e.body_text : null
      for (const a of open) {
        let kind = paperworkKind(a, e.subject, body)
        let bytes: Uint8Array | null = null
        // a PDF that says nothing about itself, in mail that needs attention: Claude looks (a few a run)
        if (!kind && !e.is_bulk && /\.pdf$/i.test(a.file_name) && e.view === 'attention' && (a.size ?? 0) >= 10 * 1024 && asked < 4 && aiEnabled()) {
          asked++
          bytes = await attachmentBytes(gmail, e.gmail_id, a.gmail_attachment_id!)
          const said = await classifyPaperwork(db, org, { name: a.file_name, mime: 'application/pdf', bytes }, { vendor: (e.vendor as unknown as { name: string } | null)?.name ?? null, subject: e.subject, text: e.body_text })
          kind = said === 'other' ? null : said
        }
        if (!kind) continue
        // already on file for this vendor (the same file from another email): link it, never a second copy
        if (await linkExistingCopy(db, e.vendor_id, a)) continue
        bytes ??= await attachmentBytes(gmail, e.gmail_id, a.gmail_attachment_id!)
        const path = `${org}/${e.vendor_id}/${crypto.randomUUID()}-${a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: a.mime_type ?? 'application/pdf', upsert: false })
        if (upErr) throw new Error(`Saving ${a.file_name}: ${upErr.message}`)
        const { data: link, error } = await db.from('vendor_links').insert({
          organization_id: org, vendor_id: e.vendor_id, kind, label: a.file_name.replace(/\.[a-z0-9]{2,5}$/i, ''), storage_path: path, file_name: a.file_name,
          file_size: bytes.length, mime_type: a.mime_type, received_at: e.received_at.slice(0, 10), doc_year: Number(e.received_at.slice(0, 4)),
          source: 'email', email_id: e.id, notes: `From an email: ${e.subject ?? '(no subject)'}`.slice(0, 300),
        }).select('id').single()
        if (error) throw new Error(error.message)
        await db.from('email_attachments').update({ vendor_link_id: link.id, storage_path: path }).eq('id', a.id)
      }
    } catch (err) {
      console.error(`paperwork from ${e.id}:`, err instanceof Error ? err.message : err)
    }
  }
}

/**
 * Item pictures (Dana, Oct 10): "If a vendor sends images of items they would go in that folder." Claude looks at the
 * pictures first (Dana, Oct 15): logos and signature graphics are never saved ("total waste"), and a rep group's logos
 * of the companies it reps add those names to its lines; proofs go to Proofs; product photos, advertising and the rest
 * go to Images, except for vendors marked "Ask before saving pictures" (Nationwide), whose pictures wait for Save
 * pictures in the email (proofs still save). The same picture sent again is not saved twice. Files the other steps
 * save (price lists, confirmations, invoices) are theirs. 12 months back, a batch a run.
 */
async function saveItemPictures(db: SupabaseClient, gmail: Gmail, org: string, started: number, box: string) {
  const twoHours = new Date(Date.now() - 2 * 3600_000).toISOString()
  const { data: queue } = await db.from('emails')
    .select('id, gmail_id, vendor_id, sender_id, subject, body_text, received_at, vendor:vendors!emails_vendor_id_fkey(name, ask_before_pictures), attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, vendor_link_id)')
    .eq('organization_id', org).eq('gmail_box', box).is('copy_of', null).eq('direction', 'in').not('vendor_id', 'is', null).eq('has_attachments', true).is('images_scanned_at', null)
    .not('is_bulk', 'is', true).not('files_scanned_at', 'is', null).or(`art_read_at.not.is.null,received_at.lt.${twoHours}`)
    .gte('received_at', new Date(Date.now() - 365 * 86_400_000).toISOString())
    .order('received_at', { ascending: false }).limit(10)
  let lineIndex: Awaited<ReturnType<typeof freightIndex>> | null = null
  for (const e of queue ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    // claim it first, so two runs never save the same pictures twice
    const { data: mine } = await db.from('emails').update({ images_scanned_at: new Date().toISOString() }).eq('id', e.id).is('images_scanned_at', null).select('id')
    if (!mine?.length) continue
    try {
      const vendor = e.vendor as unknown as { name: string; ask_before_pictures: boolean } | null
      const atts = (e.attachments ?? []) as PicAtt[]
      // pictures of damage or a wrong item ("damaged", "broken", "wrong garment", "order issues", a return) go to Damaged Items (Dana, Oct 10)
      const damaged = /damage|broken|defect|crushed|cracked|\breturn|\bRMA\b|\bRA ?#|wrong (item|garment|colou?r|size|product|style)|order issues?|issues? with (the |our )?order|mis-?ship|mis-?print|short ?ship/i.test(`${e.subject ?? ''} ${atts.map((x) => x.file_name).join(' ')}`)
      const todo: PicAtt[] = []
      for (const a of atts) {
        if (a.vendor_link_id || !a.gmail_attachment_id || !itemPicture(a) || paperworkKind(a, null)) continue
        // the same picture again (replies carry it along): point at the one already saved
        const { data: same } = await db.from('vendor_links').select('id, storage_path').eq('vendor_id', e.vendor_id).in('kind', ['image', 'damage_photo', 'proof', 'approved_proof']).eq('file_name', a.file_name).eq('file_size', a.size ?? -1).limit(1)
        if (same?.[0]) {
          await db.from('email_attachments').update({ vendor_link_id: same[0].id, storage_path: same[0].storage_path }).eq('id', a.id)
          continue
        }
        todo.push(a)
      }
      if (!todo.length) continue
      const pics = await sortPictures(db, gmail, org, e.gmail_id, todo, { vendor: vendor?.name ?? null, subject: e.subject, text: e.body_text })
      const companies: string[] = []
      for (const p of pics) {
        await db.from('email_attachments').update({ picture_kind: p.kind, picture_company: p.company }).eq('id', p.a.id)
        if (p.kind === 'logo') { if (p.company) companies.push(p.company); continue }
        if (p.kind !== 'proof' && vendor?.ask_before_pictures) continue
        const kind = p.kind === 'proof' ? 'proof' : damaged ? 'damage_photo' : 'image'
        const path = `${org}/${e.vendor_id}/${crypto.randomUUID()}-${p.a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        const { error: upErr } = await db.storage.from('vendor-files').upload(path, p.bytes, { contentType: p.a.mime_type ?? 'image/jpeg', upsert: false })
        if (upErr) throw new Error(`Saving ${p.a.file_name}: ${upErr.message}`)
        const { data: link, error } = await db.from('vendor_links').insert({
          organization_id: org, vendor_id: e.vendor_id, kind, label: pictureLabel(p.a.file_name, e.subject), storage_path: path, file_name: p.a.file_name,
          file_size: p.a.size ?? p.bytes.length, mime_type: p.a.mime_type, received_at: e.received_at.slice(0, 10), doc_year: Number(e.received_at.slice(0, 4)),
          source: 'email', email_id: e.id, notes: `From an email: ${e.subject ?? '(no subject)'}`.slice(0, 300),
        }).select('id').single()
        if (error) throw new Error(error.message)
        await db.from('email_attachments').update({ vendor_link_id: link.id, storage_path: path }).eq('id', p.a.id)
      }
      if (companies.length && e.sender_id) {
        lineIndex ??= await freightIndex(db, org)
        await repLogoLines(db, e.sender_id, companies, lineIndex)
      }
    } catch (err) {
      console.error(`pictures from ${e.id}:`, err instanceof Error ? err.message : err)
    }
  }
}

interface PicAtt { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; vendor_link_id: string | null; storage_path?: string | null }

/**
 * The pictures' bytes and what Claude sees in each. Claude reads PNG, JPEG, GIF and WEBP up to about 3.5 MB here; a
 * bigger photo or another format (HEIC) is taken as a product photo, since logos are small.
 */
async function sortPictures(db: SupabaseClient, gmail: Gmail | null, org: string, gmailId: string | null, atts: PicAtt[], ctx: { vendor: string | null; subject: string | null; text: string | null }, keepBytes = true) {
  // logos are small; bigger pictures are taken as photos without asking (turning big ones into text for Claude ran past
  // the function's compute limit, Oct 15)
  const BIG = 1.5 * 1024 * 1024
  const isReadable = (a: PicAtt) => /^image\/(png|jpeg|jpg|gif|webp)$/.test((a.mime_type ?? '').toLowerCase()) && (a.size ?? 0) <= BIG
  const out: { a: PicAtt; bytes: Uint8Array; kind: PictureKind; company: string | null }[] = []
  // four at a time, fetched only when needed and let go after (Oct 15: emails full of big pictures ran the function
  // out of memory); twelve an email per run, the rest the next run
  const list = atts.slice(0, 12)
  for (let n = 0; n < list.length; n += 4) {
    const chunk: { a: PicAtt; bytes: Uint8Array; kind: PictureKind; company: string | null }[] = []
    for (const a of list.slice(n, n + 4)) {
      if (!isReadable(a) && !keepBytes) { chunk.push({ a, bytes: new Uint8Array(0), kind: 'product', company: null }); continue }
      let bytes: Uint8Array | null = null
      if (a.storage_path) {
        const { data } = await db.storage.from('vendor-files').download(a.storage_path)
        if (data) bytes = new Uint8Array(await data.arrayBuffer())
      }
      if (!bytes && gmail && gmailId && a.gmail_attachment_id) bytes = await attachmentBytes(gmail, gmailId, a.gmail_attachment_id)
      if (!bytes) continue
      chunk.push({ a, bytes, kind: 'product', company: null })
    }
    // the real type from the file itself: a ".jpg" that is really a PNG was refused by Claude (Oct 15)
    const ask = chunk.filter((p) => p.bytes.length && p.bytes.length <= BIG && imageType(p.bytes))
    if (ask.length && aiEnabled()) {
      const said = await classifyPictures(db, org, ask.map((p) => ({ name: p.a.file_name, mime: imageType(p.bytes)!, bytes: p.bytes })), ctx)
      ask.forEach((p, k) => { p.kind = said[k]!.kind; p.company = said[k]!.company })
    }
    if (!keepBytes) for (const p of chunk) p.bytes = new Uint8Array(0)
    out.push(...chunk)
  }
  return out
}

/** A rep group's logos of the companies it reps (Dana, Oct 15): those names join its lines, the same way as the names in its mail. */
async function repLogoLines(db: SupabaseClient, senderId: string, companies: string[], index: Awaited<ReturnType<typeof freightIndex>>) {
  const { data: s } = await db.from('email_senders').select('kind, rep_group_id, rep_group:rep_groups(name)').eq('id', senderId).maybeSingle()
  if (s?.kind !== 'rep_group' || !s.rep_group_id) return
  const groupName = ((s.rep_group as unknown as { name: string } | null)?.name ?? '').toLowerCase()
  const ids = new Set<string>()
  const unknown: string[] = []
  for (const n of [...new Set(companies)]) {
    const hit = shipperVendors(index, n)
    if (hit.length === 1) ids.add(hit[0]!)
    else if (!hit.length && n.trim().toLowerCase() !== groupName) unknown.push(n)
  }
  await db.rpc('rep_group_apply_lines', { p_sender: senderId, p_vendor_ids: [...ids], p_unknown: unknown })
}

/**
 * Back-check for the picture rule (Dana, Oct 15; the Oct 14 rule): every picture already in an Images folder is looked
 * at again. Logos come out of the folder (the email keeps them), proofs move to Proofs, and for vendors marked "Ask
 * before saving pictures" everything but proofs comes out. Counts come back for Dana.
 */
async function picturesBackcheck(db: SupabaseClient, org: string, started: number) {
  const tally = { emails: 0, looked: 0, logos_removed: 0, ask_vendor_removed: 0, to_proofs: 0, kept: 0, left: 0, errors: [] as string[] }
  const { data: links } = await db.from('vendor_links').select('id, vendor_id, email_id, storage_path, file_name, mime_type, file_size')
    .eq('organization_id', org).eq('kind', 'image').eq('source', 'email').not('email_id', 'is', null).not('storage_path', 'is', null)
  const byEmail = new Map<string, NonNullable<typeof links>>()
  for (const l of links ?? []) byEmail.set(l.email_id!, [...(byEmail.get(l.email_id!) ?? []), l])
  // the pictures already looked at (not an id list: 600 ids made the request too long, and every batch started over)
  const { data: checked } = await db.from('email_attachments').select('vendor_link_id').eq('organization_id', org).not('vendor_link_id', 'is', null).not('picture_kind', 'is', null).limit(20000)
  const done = new Set((checked ?? []).map((x) => x.vendor_link_id))
  let lineIndex: Awaited<ReturnType<typeof freightIndex>> | null = null
  for (const [emailId, group] of byEmail) {
    const open = group.filter((l) => !done.has(l.id))
    if (!open.length) continue
    if (Date.now() - started > 90_000 || tally.emails >= 6) { tally.left++; continue }
    try {
    const { data: e } = await db.from('emails').select('subject, body_text, sender_id, vendor:vendors!emails_vendor_id_fkey(name, ask_before_pictures)').eq('id', emailId).single()
    const vendor = e?.vendor as unknown as { name: string; ask_before_pictures: boolean } | null
    const pics = await sortPictures(db, null, org, null, open.map((l) => ({ id: l.id, file_name: l.file_name ?? 'picture', mime_type: l.mime_type, size: l.file_size, gmail_attachment_id: null, vendor_link_id: l.id, storage_path: l.storage_path })), { vendor: vendor?.name ?? null, subject: e?.subject ?? null, text: e?.body_text ?? null }, false)
    const companies: string[] = []
    for (const p of pics) {
      tally.looked++
      // every copy of this picture in mail (replies carry it along) shares the link
      await db.from('email_attachments').update({ picture_kind: p.kind, picture_company: p.company }).eq('vendor_link_id', p.a.id)
      if (p.kind === 'proof') { await db.from('vendor_links').update({ kind: 'proof' }).eq('id', p.a.id); tally.to_proofs++; continue }
      if (p.kind === 'logo' || vendor?.ask_before_pictures) {
        if (p.kind === 'logo' && p.company) companies.push(p.company)
        await removePictureLink(db, p.a.id, p.a.storage_path ?? null)
        if (p.kind === 'logo') tally.logos_removed++
        else tally.ask_vendor_removed++
        continue
      }
      tally.kept++
    }
    if (companies.length && e?.sender_id) {
      lineIndex ??= await freightIndex(db, org)
      await repLogoLines(db, e.sender_id, companies, lineIndex)
    }
    tally.emails++
    } catch (err) {
      // one email that fails is reported and marked looked at, so the next batch goes on (its pictures stay as they are)
      tally.errors.push(`${emailId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
      for (const l of open) await db.from('email_attachments').update({ picture_kind: 'other' }).eq('vendor_link_id', l.id).is('picture_kind', null)
      tally.emails++
    }
  }
  return tally
}

/** Take a picture out of the vendor's folder: the emails keep it (they open it from Gmail again). */
async function removePictureLink(db: SupabaseClient, linkId: string, path: string | null) {
  await db.from('email_attachments').update({ vendor_link_id: null, storage_path: null }).eq('vendor_link_id', linkId)
  await db.from('vendor_links').delete().eq('id', linkId)
  if (path) {
    const { count } = await db.from('email_attachments').select('id', { count: 'exact', head: true }).eq('storage_path', path)
    const { count: links } = await db.from('vendor_links').select('id', { count: 'exact', head: true }).eq('storage_path', path)
    if (!count && !links) await db.storage.from('vendor-files').remove([path])
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
        // "Hi Jarrett" (Dana, Oct 10): the conversation goes to the person the email greets
        if (r.greets) await check(db.rpc('mail_apply_greeting', { p_email: e.email_id, p_name: r.greets }))
      }
    }

    // Artwork approvals (Dana, Oct 10): vendor mail waiting on us to approve a proof or design goes to the art
    // approver's dashboard card; our own "approved" closes it. Last 60 days, a batch a run.
    const { data: art } = await db.rpc('mail_art_queue', { p_org: org, p_limit: 20 })
    const artList = (art ?? []) as ArtEmail[]
    for (let i = 0; i < artList.length && Date.now() - started < TIME_BUDGET_MS; i += 10) {
      const batch = artList.slice(i, i + 10)
      const readings = await readArtwork(db, org, batch)
      for (const e of batch) {
        const r = readings.get(e.email_id)
        // delivered artwork only (Dana, Oct 10): an email with no picture or file beyond signature logos and no link cannot be a proof
        const real = e.attachments.some((a) => !/^(image0\d\d|outlook-|logo|signature)/i.test(a) && !/\((\d|1\d) KB\)$/.test(a)) || /https?:\/\//i.test(e.body_text ?? '')
        const art = e.direction === 'out' ? (r?.art === 'approved' || r?.art === 'changes' ? r.art : 'none') : (r?.art === 'yes' || r?.art === 'unsure') && real ? r.art : 'no'
        await check(db.rpc('mail_apply_art', { p_email: e.email_id, p_art: art, p_note: r?.note ?? '' }))
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

    // Our own promises (Dana, Oct 12): a reply like "I'll look at it tomorrow" keeps the conversation on us and gives
    // the writer a task due that day (6 pm), instead of "waiting on vendor".
    if (Date.now() - started < TIME_BUDGET_MS) {
      const { data: replies } = await db.rpc('mail_promise_queue', { p_org: org, p_limit: 15 })
      const promiseList = (replies ?? []) as PromiseEmail[]
      if (promiseList.length) {
        const readings = new Map((await readPromises(db, org, promiseList)).map((r) => [r.id, r]))
        for (const e of promiseList) {
          const r = readings.get(e.email_id)
          const due = r?.due && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : null
          await check(db.rpc('mail_apply_promise', { p_email: e.email_id, p_promise: !!r?.promise, p_task: r?.task ?? null, p_due: due, p_quote: r?.quote ?? null, p_writer: r?.writer ?? null }))
        }
      }
    }

    // A rep group's lines (Dana, Oct 12): read from its mail; vendors with no rep group join it, the rest are cards;
    // then its mail is tagged to every line it names.
    if (Date.now() - started < TIME_BUDGET_MS) {
      const { data: repSenders } = await db.rpc('rep_lines_queue', { p_org: org, p_limit: 2 })
      let lineIndex: Awaited<ReturnType<typeof freightIndex>> | null = null
      for (const rs of (repSenders ?? []) as { sender_id: string; rep_group_id: string; rep_group_name: string }[]) {
        const { data: mails } = await db.from('emails').select('subject, body_text, snippet').eq('sender_id', rs.sender_id).eq('direction', 'in').is('mailbox_id', null).order('received_at', { ascending: false }).limit(12)
        const names = await readRepLines(db, org, rs.rep_group_name, (mails ?? []).map((m) => {
          const t = (m.body_text || m.snippet || '').replace(/\s+/g, ' ')
          return { subject: m.subject, text: t.length > 1200 ? `${t.slice(0, 700)} … ${t.slice(-500)}` : t }
        }))
        lineIndex ??= await freightIndex(db, org)
        const ids = new Set<string>()
        const unknown: string[] = []
        for (const n of names) {
          const hit = shipperVendors(lineIndex, n)
          if (hit.length === 1) ids.add(hit[0]!)
          else if (!hit.length && n.trim().toLowerCase() !== rs.rep_group_name.toLowerCase()) unknown.push(n)
        }
        await check(db.rpc('rep_group_apply_lines', { p_sender: rs.sender_id, p_vendor_ids: [...ids], p_unknown: unknown }))
      }
    }

    // "Who is this?" (Dana, Oct 12): Claude sorts each unknown sender once: one of our vendors (filed, undoable from
    // the vendor page), never bought from (Promotions and the Never bought from list), a freight company (Other freight
    // companies on the Freight page, mail to Trevor), or unsure (the card stays).
    // Marketing senders get their company, website and phone read for the list. Only orders@ mail is read.
    const { data: senders } = await db.from('email_senders').select('id, sender_key, is_domain, display_name, message_count, ai_note, proposal_note, proposed_vendor:vendors!email_senders_proposed_vendor_id_fkey(name)')
      .eq('organization_id', org).in('kind', ['unknown', 'marketing']).is('sorted_at', null).gt('message_count', 0)
      .order('message_count', { ascending: false }).limit(6)
    if (!senders?.length || Date.now() - started > TIME_BUDGET_MS) return
    const { data: vendors } = await db.from('vendors').select('id, name').eq('organization_id', org).eq('is_active', true).is('merged_into_id', null).order('name').limit(5000)
    const byName = new Map((vendors ?? []).map((v) => [v.name.toLowerCase().replace(/[^a-z0-9]+/g, ''), v.id as string]))
    const vendorList = (vendors ?? []).map((v) => v.name).join('\n')
    const { data: reps } = await db.from('rep_groups').select('id, name, email, vendors(name), rep_group_contacts(name, email)').eq('organization_id', org).eq('is_active', true).order('name')
    const repList = (reps ?? []).map((g) => `${g.name}${g.email ? ` <${g.email}>` : ''}${((g.rep_group_contacts ?? []) as { name: string | null; email: string | null }[]).length ? ` (reps: ${((g.rep_group_contacts ?? []) as { name: string | null; email: string | null }[]).map((c) => [c.name, c.email].filter(Boolean).join(' ')).join('; ')})` : ''}: ${((g.vendors ?? []) as { name: string }[]).map((v) => v.name).join(', ') || 'no lines on file'}`).join('\n')
    const toSort: SenderToSort[] = []
    for (const s of senders) {
      const { data: mails } = await db.from('emails').select('subject, body_text, snippet').eq('sender_id', s.id).is('mailbox_id', null).order('received_at', { ascending: false }).limit(4)
      if (!mails?.length) {
        // only in someone's own inbox: private, so Claude does not read it here
        await check(db.rpc('mail_apply_sender_sort', { p_sender: s.id, p_decision: 'unsure', p_vendor: null, p_company: null, p_website: null, p_phone: null, p_note: null }))
        continue
      }
      const { data: sent } = await db.rpc('mail_sent_to_count', { p_org: org, p_key: s.sender_key, p_is_domain: s.is_domain })
      const proposed = (s.proposed_vendor as { name: string } | null)?.name
      toSort.push({
        id: s.id, sender: s.is_domain ? `@${s.sender_key}` : s.sender_key, from_name: s.display_name, emails_from_them: s.message_count, emails_we_sent_them: (sent as number | null) ?? 0,
        hint: proposed ? `Looks like ${proposed}: ${s.proposal_note ?? ''}` : null, earlier_note: s.ai_note,
        emails: mails.map((m) => {
          const t = (m.body_text || m.snippet || '').replace(/\s+/g, ' ')
          return { subject: m.subject, text: t.length > 900 ? `${t.slice(0, 500)} … ${t.slice(-400)}` : t }
        }),
      })
    }
    const readings = await sortSenders(db, org, vendorList, repList, toSort)
    const groupByName = new Map((reps ?? []).map((g) => [g.name.toLowerCase().replace(/[^a-z0-9]+/g, ''), g.id as string]))
    for (const r of readings) {
      if (!toSort.some((x) => x.id === r.id)) continue
      // one of our rep groups (Dana, Oct 12: Steve Newman at Premier Sales Solutions)
      const groupId = r.decision === 'rep_group' && r.rep_group_name ? groupByName.get(r.rep_group_name.toLowerCase().replace(/[^a-z0-9]+/g, '')) ?? null : null
      if (groupId) {
        await check(db.rpc('mail_apply_sender_rep', { p_sender: r.id, p_group: groupId, p_company: r.company, p_website: r.website, p_phone: r.phone, p_note: r.note }))
        continue
      }
      const vendorId = r.decision === 'vendor' && r.vendor_name ? byName.get(r.vendor_name.toLowerCase().replace(/[^a-z0-9]+/g, '')) ?? null : null
      await check(db.rpc('mail_apply_sender_sort', {
        p_sender: r.id, p_decision: r.decision === 'vendor' && !vendorId ? 'unsure' : r.decision, p_vendor: vendorId,
        p_company: r.company, p_website: r.website, p_phone: r.phone, p_note: r.note,
      }))
    }
  } catch (e) {
    console.error('Claude step:', e instanceof Error ? e.message : e)
  }
}

/** Fill emails.is_bulk for mail stored before it was read, then let SQL re-sort those emails. */
async function readBulkHeaders(db: SupabaseClient, gmail: Gmail, org: string, box: string) {
  const { data } = await db.from('emails').select('id, gmail_id').eq('organization_id', org).eq('gmail_box', box).is('is_bulk', null).eq('direction', 'in').limit(300)
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
