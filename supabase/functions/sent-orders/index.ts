// sent-orders: orders we email to vendors become orders (Dana, Oct 12). Runs every minute from pg_cron (header
// x-cron-secret). Our sent mail, 12 months back and then as it arrives: orders@ and the personal mailboxes (Jarrett sent
// orders from jarrett@ for a while). Nothing from a private email is copied but the order itself (Claude's own words):
//   1. sort  — Claude (cheapest model) picks the emails that place an order, 30 at a time
//   2. read  — Claude reads each one: the email text and its attachments (PDF, picture, or order writer spreadsheet)
//   3. file  — the order on file with the same PO (or same vendor, date and total) gets the email, its file and its
//              lines; otherwise a Placed order is added (Dana: long buying cycle, so every age; older than 120 days
//              notes "Added from sent mail, check status.").
//              Confirmations and invoices waiting for their order are matched again.
// Order emails from ordering services (Dana, Oct 13): NuORDER, Faire, MarketTime, vendors' web stores telling us an order
// went in. Claude reads the vendor, order and items, and the vendor contact it names (saved to Reps & contacts, Orders
// mail only); the order on file gets the email, or it is added.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { readBook } from '../_shared/sheetFile.ts'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, isReadableFile, readSentOrder, readServiceOrder, sortSentEmails, type PaperFile, type SentOrderReading, type ServiceOrderReading } from '../_shared/ai.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'

const TIME_BUDGET_MS = 100_000
const MAX_FILE = 15 * 1024 * 1024
const BACK_DAYS = 365
const CHECK_STATUS_DAYS = 120

interface Att { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; storage_path: string | null; vendor_link_id: string | null }
interface Mail { id: string; organization_id: string; gmail_id: string; gmail_box: string | null; vendor_id: string | null; subject: string | null; body_text: string | null; to_emails: string[]; received_at: string; attachments: Att[] }
interface InMail extends Mail { from_email: string | null; from_name: string | null; mailbox_id: string | null; thread_id: string | null }
const SERVICE_PER_RUN = 3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    // a run that died while reading: try those again, but only once (Oct 16: a too-big spreadsheet stopped every run for
    // hours, retried every 11 minutes); the second time it is set aside as too big
    const stale = new Date(Date.now() - 10 * 60_000).toISOString()
    const { data: died } = await db.from('emails').select('id, order_scan').eq('direction', 'out').eq('order_scan->>result', 'reading').lt('order_scan->>at', stale)
    for (const d of died ?? []) {
      const tries = Number((d.order_scan as { tries?: number } | null)?.tries ?? 0) + 1
      if (tries >= 2) await db.from('emails').update({ order_scan: { result: 'too_big', tries, note: 'Reading this email stopped the run twice (a file too big to open)' }, order_scanned_at: new Date().toISOString() }).eq('id', d.id)
      else await db.from('emails').update({ order_scan: { result: 'pending', tries } }).eq('id', d.id)
    }
    await db.from('emails').update({ order_scan: null }).eq('direction', 'in').eq('order_scan->>result', 'reading').lt('order_scan->>at', new Date(Date.now() - 10 * 60_000).toISOString())
    // back-check (Dana, Oct 15; the Oct 14 rule): files already in "Our orders" that only show products go to Images
    const body = await req.json().catch(() => ({})) as { refile_order_files?: boolean }
    if (body.refile_order_files) return json(await refileOrderFiles(db, started))
    const sorted = await sortStep(db)
    const services: unknown[] = []
    for (const m of await serviceQueue(db)) {
      if (Date.now() - started > TIME_BUDGET_MS * 0.5) break
      services.push(await serviceStep(db, m))
    }
    const read: unknown[] = []
    while (Date.now() - started < TIME_BUDGET_MS * 0.7) {
      const m = await nextPending(db)
      if (!m) break
      read.push(await readStep(db, m))
    }
    return json({ sorted, services, read })
  } catch (e) {
    return errorResponse(e)
  }
})

const SELECT = 'id, organization_id, gmail_id, gmail_box, vendor_id, subject, body_text, to_emails, received_at, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, storage_path, vendor_link_id)'
const since = () => new Date(Date.now() - BACK_DAYS * 86_400_000).toISOString()
const looksLikeJunk = (a: Att) => /^(image\d*|outlook|logo|signature|att\d+)\b/i.test(a.file_name) || /\.(ics|vcf|htm|html)$/i.test(a.file_name)

/** Sort a batch of our sent mail: which emails place an order. */
async function sortStep(db: SupabaseClient) {
  const { data } = await db.from('emails').select(SELECT).eq('direction', 'out').is('copy_of', null).is('order_scanned_at', null).is('order_scan', null)
    .gte('received_at', since()).order('received_at', { ascending: false }).limit(30)
  const mails = (data ?? []) as unknown as Mail[]
  if (!mails.length) return 0
  const now = new Date().toISOString()
  const noVendor = mails.filter((m) => !m.vendor_id)
  if (noVendor.length) await db.from('emails').update({ order_scan: { result: 'no_vendor' }, order_scanned_at: now }).in('id', noVendor.map((m) => m.id))
  const byOrg = new Map<string, Mail[]>()
  for (const m of mails.filter((x) => x.vendor_id)) byOrg.set(m.organization_id, [...(byOrg.get(m.organization_id) ?? []), m])
  for (const [org, list] of byOrg) {
    const orders = await sortSentEmails(db, org, list.map((m) => ({
      id: m.id, to: (m.to_emails ?? []).join(', '), subject: m.subject, text: m.body_text ?? '', attachments: (m.attachments ?? []).filter((a) => !looksLikeJunk(a)).map((a) => a.file_name),
    })))
    const no = list.filter((m) => !orders.has(m.id)).map((m) => m.id)
    const yes = list.filter((m) => orders.has(m.id)).map((m) => m.id)
    if (no.length) await db.from('emails').update({ order_scan: { result: 'not_order' }, order_scanned_at: now }).in('id', no)
    if (yes.length) await db.from('emails').update({ order_scan: { result: 'pending' } }).in('id', yes)
  }
  return mails.length
}

async function nextPending(db: SupabaseClient): Promise<Mail | null> {
  // oldest first, so an order is on file before the "add to order" emails that follow it
  const { data } = await db.from('emails').select(`${SELECT}, order_scan`).eq('order_scan->>result', 'pending').is('order_scanned_at', null).order('received_at', { ascending: true }).limit(1)
  const m = (data?.[0] ?? null) as unknown as Mail | null
  if (!m) return null
  // claim it: a run that dies leaves it 'reading' for 10 minutes, then it is tried again
  const tries = (m as Mail & { order_scan?: { tries?: number } | null }).order_scan?.tries ?? 0
  const { data: claimed } = await db.from('emails').update({ order_scan: { result: 'reading', at: new Date().toISOString(), tries } }).eq('id', m.id).eq('order_scan->>result', 'pending').select('id')
  return claimed?.length ? m : null
}

const gmails = new Map<string, Gmail>()
async function gmailFor(db: SupabaseClient, org: string, box: string | null): Promise<Gmail> {
  const b = box ?? (await db.from('mail_accounts').select('mailbox').eq('organization_id', org).maybeSingle()).data?.mailbox
  if (!b) throw new Error('No mailbox')
  if (!gmails.has(b)) gmails.set(b, new Gmail(await googleAccessToken(b)))
  return gmails.get(b)!
}

async function bytesOf(db: SupabaseClient, m: Mail, a: Att): Promise<Uint8Array | null> {
  if (a.storage_path) {
    const { data } = await db.storage.from('vendor-files').download(a.storage_path)
    return data ? new Uint8Array(await data.arrayBuffer()) : null
  }
  if (!a.gmail_attachment_id) return null
  const gmail = await gmailFor(db, m.organization_id, m.gmail_box)
  const part = await gmail.call<{ data: string }>(`messages/${m.gmail_id}/attachments/${a.gmail_attachment_id}`)
  const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const isSheet = (a: Att) => /\.(xlsx|xlsm|xls|csv)$/i.test(a.file_name) || /spreadsheet|excel|text\/csv/i.test(a.mime_type ?? '')

/** An order writer as text: the header rows and the rows with a quantity ordered. */
async function sheetText(bytes: Uint8Array): Promise<string> {
  const book = await readBook(bytes)
  const parts: string[] = []
  for (const name of book.names) {
    const rows = book.rows(name, true)
    const cell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
    const head = rows.findIndex((r) => r.some((c) => /^(qty|quantity|order qty|ord(er)?|qty ordered|units?)$/i.test(cell(c))))
    let keep: unknown[][]
    if (head >= 0) {
      const qcol = rows[head]!.findIndex((c) => /^(qty|quantity|order qty|ord(er)?|qty ordered|units?)$/i.test(cell(c)))
      keep = [...rows.slice(0, head + 1), ...rows.slice(head + 1).filter((r) => Number(String(r[qcol] ?? '').replace(/[^0-9.-]/g, '')) > 0)]
    } else {
      keep = rows
    }
    const text = keep.map((r) => r.map(cell).filter(Boolean).join(' | ')).filter(Boolean).join('\n')
    if (text) parts.push(`# ${name}\n${text}`)
  }
  return parts.join('\n\n').slice(0, 80_000)
}

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const day = (iso: string) => iso.slice(0, 10)
const plusDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

async function readStep(db: SupabaseClient, m: Mail) {
  try {
    const { data: vendor } = await db.from('vendors').select('id, name').eq('id', m.vendor_id!).maybeSingle()
    const files: PaperFile[] = []
    const sheets: { name: string; text: string }[] = []
    const used: { a: Att; bytes: Uint8Array }[] = []
    for (const a of (m.attachments ?? []).filter((x) => !looksLikeJunk(x) && (x.size ?? 0) <= MAX_FILE)) {
      if (files.length + sheets.length >= 3) break
      const readable = isReadableFile({ name: a.file_name, mime: a.mime_type })
      if (!readable && !isSheet(a)) continue
      const bytes = await bytesOf(db, m, a)
      if (!bytes) continue
      if (readable) files.push({ name: a.file_name, mime: a.mime_type ?? 'application/pdf', bytes })
      else sheets.push({ name: a.file_name, text: await sheetText(bytes) })
      used.push({ a, bytes })
    }
    const r = await readSentOrder(db, m.organization_id, { vendor: vendor?.name ?? 'Unknown vendor', subject: m.subject, sent_on: day(m.received_at), text: m.body_text ?? '', files, sheets })
    if (!r.is_order) return await finish(db, m, { result: 'not_order' })
    let orderId = await matchOrder(db, m, r)
    let adding = false
    if (!orderId && r.adds_to_earlier) { orderId = await earlierOrder(db, m); adding = !!orderId }
    if (orderId) {
      await fileOn(db, m, orderId, r, used, adding)
      await db.rpc('order_checks_refind', { p_org: m.organization_id, p_vendor: m.vendor_id })
      return await finish(db, m, { result: adding ? 'added_to' : 'linked', order_id: orderId, po: r.po_number })
    }
    const created = await createOrder(db, m, r)
    await fileOn(db, m, created, r, used, true)
    await db.rpc('order_checks_refind', { p_org: m.organization_id, p_vendor: m.vendor_id })
    return await finish(db, m, { result: 'created', order_id: created, po: r.po_number })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await finish(db, m, { result: 'failed', error: message.slice(0, 300) })
    return { id: m.id, error: message }
  }
}

/**
 * Back-check for the "which files show the order" rule: every sent order email with files in "Our orders" is read again
 * for that one answer; a file that only shows what the products or design look like moves to Images (a picture) or out
 * of Our orders (anything else). Item lines and orders are not touched. Counts come back for Dana.
 */
async function refileOrderFiles(db: SupabaseClient, started: number) {
  const { data: links } = await db.from('vendor_links').select('email_id').eq('kind', 'order').not('email_id', 'is', null)
  const ids = [...new Set((links ?? []).map((l) => l.email_id as string))]
  const { data: mails } = ids.length
    ? await db.from('emails').select(SELECT).in('id', ids).eq('direction', 'out').is('order_scan->files_checked', null)
    : { data: [] }
  const tally = { emails: 0, kept: 0, to_images: 0, to_other: 0, left: 0, service_logos: 0 }
  // an ordering service's own email (NuORDER, EJD): its PDF is the order, a picture on it is its logo
  const { data: inbound } = ids.length ? await db.from('emails').select('id').in('id', ids).eq('direction', 'in') : { data: [] }
  if (inbound?.length) {
    const { data: moved } = await db.from('vendor_links').update({ kind: 'image', notes: 'A picture from the order email' }).eq('kind', 'order').like('mime_type', 'image/%').in('email_id', inbound.map((x) => x.id)).select('id')
    tally.service_logos = moved?.length ?? 0
  }
  for (const m of (mails ?? []) as unknown as Mail[]) {
    if (Date.now() - started > TIME_BUDGET_MS * 0.8) { tally.left++; continue }
    const { data: vendor } = await db.from('vendors').select('name').eq('id', m.vendor_id!).maybeSingle()
    const { data: filed } = await db.from('vendor_links').select('id, kind').in('id', m.attachments.map((a) => a.vendor_link_id).filter((x): x is string => !!x))
    const kindOf = new Map((filed ?? []).map((l) => [l.id, l.kind as string]))
    const files: PaperFile[] = []
    const sheets: { name: string; text: string }[] = []
    for (const a of m.attachments.filter((x) => (x.size ?? 0) <= MAX_FILE && (kindOf.get(x.vendor_link_id ?? '') === 'order' || !looksLikeJunk(x)))) {
      if (files.length + sheets.length >= 4) break
      const readable = isReadableFile({ name: a.file_name, mime: a.mime_type })
      if (!readable && !isSheet(a)) continue
      const bytes = await bytesOf(db, m, a)
      if (!bytes) continue
      if (readable) files.push({ name: a.file_name, mime: a.mime_type ?? 'application/pdf', bytes })
      else sheets.push({ name: a.file_name, text: await sheetText(bytes) })
    }
    const r = await readSentOrder(db, m.organization_id, { vendor: vendor?.name ?? 'Unknown vendor', subject: m.subject, sent_on: day(m.received_at), text: m.body_text ?? '', files, sheets })
    for (const a of m.attachments) {
      if (!a.vendor_link_id || kindOf.get(a.vendor_link_id) !== 'order') continue
      const kind = orderFileKind(a, r.order_files)
      if (kind === 'order') { tally.kept++; continue }
      await db.from('vendor_links').update(kind === 'image' ? { kind: 'image', notes: 'A picture sent with our order' } : { kind: 'other', notes: 'Sent with our order; not the order itself' }).eq('id', a.vendor_link_id)
      if (kind === 'image') tally.to_images++
      else tally.to_other++
    }
    const { data: e } = await db.from('emails').select('order_scan').eq('id', m.id).single()
    await db.from('emails').update({ order_scan: { ...((e?.order_scan as Record<string, unknown> | null) ?? {}), files_checked: true } }).eq('id', m.id)
    tally.emails++
  }
  return tally
}

async function finish(db: SupabaseClient, m: Mail, scan: Record<string, unknown>) {
  await db.from('emails').update({ order_scan: scan, order_scanned_at: new Date().toISOString(), ...(scan.order_id ? { order_id: scan.order_id } : {}) }).eq('id', m.id)
  return { id: m.id, ...scan }
}

/** The order on file: same PO for the vendor, else the vendor's one order within 5 days with the same total. */
async function matchOrder(db: SupabaseClient, m: Mail, r: SentOrderReading): Promise<string | null> {
  const { data } = await db.from('orders').select('id, po_number, order_date, est_cost, final_cost, created_at').eq('vendor_id', m.vendor_id!).neq('status', 'cancelled')
  const orders = data ?? []
  const po = norm(r.po_number)
  if (po.length >= 3) {
    const same = orders.filter((o) => norm(o.po_number) === po)
    if (same.length === 1) return same[0]!.id
  }
  // the vendor's order within 5 days of the email (the sheet's date and total often differ a little from the email's):
  // the closest date, then the closest total
  const sent = day(m.received_at)
  const dist = (d: string) => Math.abs(new Date(`${d}T12:00:00Z`).getTime() - new Date(`${sent}T12:00:00Z`).getTime()) / 86_400_000
  const near = orders.filter((o) => o.order_date && dist(o.order_date) <= 5)
    .sort((a, b) => dist(a.order_date!) - dist(b.order_date!) || Math.abs(Number(a.est_cost ?? a.final_cost ?? 1e9) - (r.total ?? 0)) - Math.abs(Number(b.est_cost ?? b.final_cost ?? 1e9) - (r.total ?? 0)))
  if (near.length) return near[0]!.id
  // an order typed on Dana's sheet without a date ("PAJAMAS - WAITING ON CONFIRM"): the vendor's one open undated order
  const { data: open } = await db.from('orders').select('id').eq('vendor_id', m.vendor_id!).in('status', ['open', 'awaiting_confirmation']).is('order_date', null)
  return open?.length === 1 ? open[0]!.id : null
}

/** "Add to order": the vendor's latest order from the 45 days before this email. */
async function earlierOrder(db: SupabaseClient, m: Mail): Promise<string | null> {
  const sent = day(m.received_at)
  const { data } = await db.from('orders').select('id, order_date').eq('vendor_id', m.vendor_id!).neq('status', 'cancelled')
    .gte('order_date', plusDays(sent, -45)).lte('order_date', sent).order('order_date', { ascending: false }).limit(1)
  return data?.[0]?.id ?? null
}

async function createOrder(db: SupabaseClient, m: Mail, r: SentOrderReading, from = 'sent mail', extra: Record<string, unknown> = {}): Promise<string> {
  const { data: people } = await db.from('profiles').select('id, full_name').eq('organization_id', m.organization_id).eq('is_active', true)
  const who = r.placed_by ? (people ?? []).find((p) => p.full_name.split(' ')[0]!.toLowerCase() === r.placed_by!.split(' ')[0]!.toLowerCase()) : undefined
  const { data: stores } = await db.from('stores').select('code').eq('organization_id', m.organization_id)
  const store = r.store && (stores ?? []).some((s) => s.code === r.store) ? [r.store] : []
  const lineTotal = r.items.reduce((s, l) => s + (l.unit_cost ?? 0) * l.quantity, 0)
  const { data, error } = await db.from('orders').insert({
    organization_id: m.organization_id, vendor_id: m.vendor_id, status: 'open', source: 'email', order_date: day(m.received_at),
    po_number: r.po_number, description: r.description, est_cost: r.total ?? (lineTotal > 0 ? Math.round(lineTotal * 100) / 100 : null),
    est_ship_date: /^\d{4}-\d{2}-\d{2}$/.test(r.ship_date ?? '') ? r.ship_date : null,
    placed_by: who?.full_name ?? r.placed_by, placed_by_id: who?.id ?? null, store_codes: store,
    notes: [day(m.received_at) < plusDays(day(new Date().toISOString()), -CHECK_STATUS_DAYS) ? `Added from ${from}, check status.` : `Added from ${from}.`, r.note].filter(Boolean).join(' '),
    ...extra,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

const isPicture = (a: { file_name: string; mime_type: string | null }) => /^image\//i.test(a.mime_type ?? '') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.file_name)

/** Where a file sent with an order goes: "Our orders" when it shows what is ordered, Images for a picture, else not saved. */
export function orderFileKind(a: { file_name: string; mime_type: string | null }, orderFiles: string[]): 'order' | 'image' | 'other' {
  if (orderFiles.some((n) => n.trim().toLowerCase() === a.file_name.trim().toLowerCase())) return 'order'
  return isPicture(a) ? 'image' : 'other'
}

/**
 * Link the email, save the order file to the order ("Our orders"), and add the item lines when the order has none. Only
 * the files that show what is ordered are "Our orders"; pictures of the products or the design sent along with an order
 * typed in the email go to Images (Dana, Oct 15: Planet Cotton's design pictures were taken for her typed order).
 */
async function fileOn(db: SupabaseClient, m: Mail, orderId: string, r: SentOrderReading, used: { a: Att; bytes: Uint8Array }[], fresh: boolean, fileNote = 'The order we emailed the vendor') {
  const { data: o } = await db.from('orders').select('po_number').eq('id', orderId).single()
  if (!o?.po_number && r.po_number) await db.from('orders').update({ po_number: r.po_number }).eq('id', orderId)
  for (const { a, bytes } of used) {
    if (a.vendor_link_id) { await db.from('vendor_links').update({ order_id: orderId }).eq('id', a.vendor_link_id).is('order_id', null); continue }
    const kind = orderFileKind(a, r.order_files)
    if (kind === 'other') continue
    const path = a.storage_path ?? `${m.organization_id}/${m.vendor_id}/${crypto.randomUUID()}-${a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    if (!a.storage_path) {
      const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: a.mime_type ?? 'application/octet-stream', upsert: false })
      if (upErr) throw new Error(`Saving ${a.file_name}: ${upErr.message}`)
    }
    const { data: link, error } = await db.from('vendor_links').insert({
      organization_id: m.organization_id, vendor_id: m.vendor_id, order_id: orderId, kind, label: a.file_name.replace(/\.[a-z0-9]{2,5}$/i, ''),
      storage_path: path, file_name: a.file_name, file_size: bytes.length, mime_type: a.mime_type, received_at: day(m.received_at), doc_year: Number(m.received_at.slice(0, 4)),
      source: 'email', email_id: m.id, notes: kind === 'order' ? fileNote : 'A picture sent with our order',
    }).select('id').single()
    if (error) throw new Error(error.message)
    await db.from('email_attachments').update({ vendor_link_id: link.id, storage_path: path }).eq('id', a.id)
  }
  const { count } = await db.from('order_lines').select('id', { count: 'exact', head: true }).eq('order_id', orderId)
  if ((fresh || !count) && r.items.length) {
    await db.from('order_lines').insert(r.items.filter((l) => l.quantity > 0).map((l, i) => ({
      organization_id: m.organization_id, order_id: orderId, sort_order: i, vendor_item_id: l.vendor_item_id, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost ?? 0,
    })))
  }
}

// ---- order emails from ordering services ---------------------------------------------------------------------------
const IN_SELECT = `${SELECT}, from_email, from_name, mailbox_id, thread_id`

async function serviceQueue(db: SupabaseClient): Promise<InMail[]> {
  const { data: orgs } = await db.from('mail_accounts').select('organization_id')
  const out: InMail[] = []
  for (const o of orgs ?? []) {
    const { data: ids } = await db.rpc('service_order_queue', { p_org: o.organization_id, p_limit: SERVICE_PER_RUN })
    const list = ((ids ?? []) as { email_id: string }[]).map((x) => x.email_id)
    if (!list.length) continue
    // claim them: a run that dies leaves them 'reading' for 10 minutes, then they are tried again
    const { data: claimed } = await db.from('emails').update({ order_scan: { result: 'reading', kind: 'service', at: new Date().toISOString() } }).in('id', list).is('order_scan', null).select('id')
    if (!claimed?.length) continue
    const { data } = await db.from('emails').select(IN_SELECT).in('id', claimed.map((c) => c.id)).order('received_at')
    out.push(...((data ?? []) as unknown as InMail[]))
  }
  return out
}

async function serviceStep(db: SupabaseClient, m: InMail) {
  const done = (scan: Record<string, unknown>) => finish(db, m, { kind: 'service', ...scan })
  try {
    const files: PaperFile[] = []
    const used: { a: Att; bytes: Uint8Array }[] = []
    for (const a of (m.attachments ?? []).filter((x) => !looksLikeJunk(x) && (x.size ?? 0) <= MAX_FILE && isReadableFile({ name: x.file_name, mime: x.mime_type }))) {
      if (files.length >= 2) break
      const bytes = await bytesOf(db, m, a)
      if (!bytes) continue
      files.push({ name: a.file_name, mime: a.mime_type ?? 'application/pdf', bytes })
      used.push({ a, bytes })
    }
    const r = await readServiceOrder(db, m.organization_id, { from: [m.from_name, m.from_email].filter(Boolean).join(' '), subject: m.subject, received_on: day(m.received_at), text: m.body_text ?? '', files })
    if (!r.is_order) return await done({ result: 'not_order' })
    // the vendor: the one Claude names when VMS knows it, else the one the email is filed to
    const named = r.vendor_name ? (await db.rpc('vendor_by_name', { p_org: m.organization_id, p_name: r.vendor_name })).data as string | null : null
    const vendorId = named ?? m.vendor_id
    if (!vendorId) return await done({ result: 'no_vendor', vendor_name: r.vendor_name })
    if (!m.vendor_id || m.vendor_id !== vendorId) {
      await db.from('email_vendor_tags').upsert({ email_id: m.id, vendor_id: vendorId, organization_id: m.organization_id, how: 'ai' }, { onConflict: 'email_id,vendor_id', ignoreDuplicates: true })
    }
    const mail: Mail = { ...m, vendor_id: vendorId }
    const isPrivate = !!m.mailbox_id && !(await sharedThread(db, m.thread_id))
    const contactId = isPrivate ? null : await saveContact(db, mail, r)
    const takenBy = r.contact?.name?.trim() || null
    const via = r.service ? `${r.service} order email` : 'the vendor\'s order email'
    const fileNote = r.service ? `The ${r.service} order email` : 'The order email from the vendor'
    // one email can hold several orders (NuORDER sent Gold Medal's $636 and $798 orders together)
    const orderIds: string[] = []
    for (const [i, one] of r.orders.entries()) {
      const reading: SentOrderReading = {
        is_order: true, adds_to_earlier: false, po_number: one.po_number ?? one.order_number, ship_date: one.ship_date, total: one.total,
        description: one.description, placed_by: r.placed_by, store: r.store, items: one.items, note: r.note,
        // an ordering service's own email: its PDF is the order; pictures are its logo
        order_files: used.filter(({ a }) => !isPicture(a)).map(({ a }) => a.file_name),
      }
      const keep = i === 0 ? used : []
      let orderId = await matchServiceOrder(db, mail, one, orderIds)
      if (orderId) {
        await fileOn(db, mail, orderId, reading, keep, false, fileNote)
        const { data: o } = await db.from('orders').select('est_cost, final_cost, taken_by, notes, order_date').eq('id', orderId).single()
        const num = one.order_number && one.order_number !== one.po_number ? `${r.service ?? 'Vendor'} order #${one.order_number}.` : null
        await db.from('orders').update({
          ...(o?.est_cost == null && o?.final_cost == null && one.total != null ? { est_cost: one.total } : {}),
          ...(!o?.taken_by && takenBy ? { taken_by: takenBy } : {}),
          ...(!o?.order_date ? { order_date: day(m.received_at) } : {}),
          ...(num && !(o?.notes ?? '').includes(one.order_number!) ? { notes: [o?.notes, num].filter(Boolean).join(' ') } : {}),
        }).eq('id', orderId)
      } else {
        orderId = await createOrder(db, mail, reading, via, takenBy ? { taken_by: takenBy } : {})
        await fileOn(db, mail, orderId, reading, keep, true, fileNote)
      }
      orderIds.push(orderId)
    }
    if (!orderIds.length) return await done({ result: 'not_order' })
    // web-order vendors (Kelli's, Dana Oct 13): the order email is the confirmation
    for (const id of orderIds) await db.rpc('web_order_confirm', { p_order: id })
    const orderId = orderIds[0]!
    await db.rpc('order_checks_refind', { p_org: m.organization_id, p_vendor: vendorId })
    return await done({ result: 'linked', order_id: orderId, order_ids: orderIds, contact_id: contactId })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await done({ result: 'failed', error: message.slice(0, 300) })
    return { id: m.id, error: message }
  }
}

async function sharedThread(db: SupabaseClient, threadId: string | null): Promise<boolean> {
  if (!threadId) return false
  const { data } = await db.from('email_threads').select('shared_at').eq('id', threadId).maybeSingle()
  return !!data?.shared_at
}

const NO_REPLY = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|info|support|hello|updates|orders?|sales|marketplace|confirmer)@/i
const SERVICE_DOMAINS = /(nuorder|faire|markettime|elasticsuite|shopify|netsuite|joor|repspark|brandboom|pepperi|editmysite|square)\./i

/** The vendor contact the email names, added to Reps & contacts (Rep) when VMS does not have that address yet. */
async function saveContact(db: SupabaseClient, m: Mail, r: ServiceOrderReading): Promise<string | null> {
  const c = r.contact
  const email = c?.email?.trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || NO_REPLY.test(email) || SERVICE_DOMAINS.test(email) || /shaverlakesports\.com$/i.test(email)) return null
  const { data: have } = await db.from('vendor_emails').select('id, contact_name, phone').eq('vendor_id', m.vendor_id!).ilike('email', email).maybeSingle()
  if (have) {
    const fill = { ...(!have.contact_name && c?.name ? { contact_name: c.name.trim() } : {}), ...(!have.phone && c?.phone ? { phone: c.phone.trim() } : {}) }
    if (Object.keys(fill).length) await db.from('vendor_emails').update(fill).eq('id', have.id)
    return have.id
  }
  const { data, error } = await db.from('vendor_emails').insert({
    organization_id: m.organization_id, vendor_id: m.vendor_id, email, contact_name: c?.name?.trim() || null, phone: c?.phone?.trim() || null, title: c?.title?.trim() || null,
    contact_type: 'rep', roles: ['rep'], source: 'email_enrichment', confidence: 0.8,
    notes: `Named in the ${r.service ?? 'vendor'} order email of ${day(m.received_at)}`,
  }).select('id').single()
  if (error) throw new Error(`Saving the contact: ${error.message}`)
  return data.id
}

/**
 * The order on file: same PO or order number (the closest amount when the PO is split over several rows); else the
 * vendor's order within 5 days with the same total (within 3%); else one there with no amount and no PO yet (an order
 * typed on Dana's sheet). Never another PO's order.
 */
async function matchServiceOrder(db: SupabaseClient, m: Mail, r: ServiceOrderReading['orders'][number], taken: string[]): Promise<string | null> {
  const { data } = await db.from('orders').select('id, po_number, order_date, est_cost, final_cost, notes').eq('vendor_id', m.vendor_id!).neq('status', 'cancelled')
  const orders = (data ?? []).filter((o) => !taken.includes(o.id))
  const amount = (o: { est_cost: unknown; final_cost: unknown }) => (o.est_cost ?? o.final_cost) == null ? null : Number(o.est_cost ?? o.final_cost)
  const gap = (o: { est_cost: unknown; final_cost: unknown }) => (amount(o) == null || r.total == null ? 1e9 : Math.abs(amount(o)! - r.total))
  // Dana's sheet often splits one PO into several rows: any order with the PO is ours, the closest amount first
  for (const n of [r.po_number, r.order_number].map(norm).filter((x) => x.length >= 3)) {
    const same = orders.filter((o) => norm(o.po_number) === n || (n.length >= 6 && norm(o.notes).includes(n))).sort((a, b) => gap(a) - gap(b))
    if (same.length) return same[0]!.id
  }
  const sent = day(m.received_at)
  const dist = (d: string) => Math.abs(new Date(`${d}T12:00:00Z`).getTime() - new Date(`${sent}T12:00:00Z`).getTime()) / 86_400_000
  const near = orders.filter((o) => o.order_date && dist(o.order_date) <= 5).sort((a, b) => dist(a.order_date!) - dist(b.order_date!))
  if (r.total != null) {
    const same = near.find((o) => amount(o) != null && Math.abs(amount(o)! - r.total!) <= Math.max(5, r.total! * 0.03))
    if (same) return same.id
  }
  const blank = near.filter((o) => amount(o) == null && !o.po_number)
  return blank[0]?.id ?? null
}
