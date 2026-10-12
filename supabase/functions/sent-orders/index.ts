// sent-orders: orders we email to vendors become orders (Dana, Oct 12). Runs every minute from pg_cron (header
// x-cron-secret). Our sent mail, 12 months back and then as it arrives: orders@ and the personal mailboxes (Jarrett sent
// orders from jarrett@ for a while). Nothing from a private email is copied but the order itself (Claude's own words):
//   1. sort  — Claude (cheapest model) picks the emails that place an order, 30 at a time
//   2. read  — Claude reads each one: the email text and its attachments (PDF, picture, or order writer spreadsheet)
//   3. file  — the order on file with the same PO (or same vendor, date and total) gets the email, its file and its
//              lines; otherwise a Placed order is added (Dana: long buying cycle, so every age; older than 120 days
//              notes "Added from sent mail, check status.").
//              Confirmations and invoices waiting for their order are matched again.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import * as XLSX from 'npm:xlsx@0.18.5'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, isReadableFile, readSentOrder, sortSentEmails, type PaperFile, type SentOrderReading } from '../_shared/ai.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'

const TIME_BUDGET_MS = 100_000
const MAX_FILE = 15 * 1024 * 1024
const BACK_DAYS = 365
const CHECK_STATUS_DAYS = 120

interface Att { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; storage_path: string | null; vendor_link_id: string | null }
interface Mail { id: string; organization_id: string; gmail_id: string; gmail_box: string | null; vendor_id: string | null; subject: string | null; body_text: string | null; to_emails: string[]; received_at: string; attachments: Att[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    // a run that died while reading: try those again
    await db.from('emails').update({ order_scan: { result: 'pending' } }).eq('order_scan->>result', 'reading').lt('order_scan->>at', new Date(Date.now() - 10 * 60_000).toISOString())
    const sorted = await sortStep(db)
    const read: unknown[] = []
    while (Date.now() - started < TIME_BUDGET_MS * 0.7) {
      const m = await nextPending(db)
      if (!m) break
      read.push(await readStep(db, m))
    }
    return json({ sorted, read })
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
  const { data } = await db.from('emails').select(SELECT).eq('order_scan->>result', 'pending').is('order_scanned_at', null).order('received_at', { ascending: true }).limit(1)
  const m = (data?.[0] ?? null) as unknown as Mail | null
  if (!m) return null
  // claim it: a run that dies leaves it 'reading' for 10 minutes, then it is tried again
  const { data: claimed } = await db.from('emails').update({ order_scan: { result: 'reading', at: new Date().toISOString() } }).eq('id', m.id).eq('order_scan->>result', 'pending').select('id')
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
function sheetText(bytes: Uint8Array): string {
  const book = XLSX.read(bytes, { type: 'array' })
  const parts: string[] = []
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw: true, blankrows: false, defval: '' })
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
      else sheets.push({ name: a.file_name, text: sheetText(bytes) })
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
  const sent = day(m.received_at)
  const near = orders.filter((o) => {
    const d = o.order_date ?? o.created_at.slice(0, 10)
    if (d < plusDays(sent, -5) || d > plusDays(sent, 5)) return false
    const cost = Number(o.est_cost ?? o.final_cost ?? NaN)
    return r.total === null || !Number.isFinite(cost) || Math.abs(cost - r.total) <= Math.max(5, r.total * 0.03)
  })
  if (near.length === 1) return near[0]!.id
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

async function createOrder(db: SupabaseClient, m: Mail, r: SentOrderReading): Promise<string> {
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
    notes: [day(m.received_at) < plusDays(day(new Date().toISOString()), -CHECK_STATUS_DAYS) ? 'Added from sent mail, check status.' : 'Added from sent mail.', r.note].filter(Boolean).join(' '),
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

/** Link the email, save the order file to the order ("Our orders"), and add the item lines when the order has none. */
async function fileOn(db: SupabaseClient, m: Mail, orderId: string, r: SentOrderReading, used: { a: Att; bytes: Uint8Array }[], fresh: boolean) {
  const { data: o } = await db.from('orders').select('po_number').eq('id', orderId).single()
  if (!o?.po_number && r.po_number) await db.from('orders').update({ po_number: r.po_number }).eq('id', orderId)
  for (const { a, bytes } of used) {
    if (a.vendor_link_id) { await db.from('vendor_links').update({ order_id: orderId }).eq('id', a.vendor_link_id).is('order_id', null); continue }
    const path = a.storage_path ?? `${m.organization_id}/${m.vendor_id}/${crypto.randomUUID()}-${a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    if (!a.storage_path) {
      const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: a.mime_type ?? 'application/octet-stream', upsert: false })
      if (upErr) throw new Error(`Saving ${a.file_name}: ${upErr.message}`)
    }
    const { data: link, error } = await db.from('vendor_links').insert({
      organization_id: m.organization_id, vendor_id: m.vendor_id, order_id: orderId, kind: 'order', label: a.file_name.replace(/\.[a-z0-9]{2,5}$/i, ''),
      storage_path: path, file_name: a.file_name, file_size: bytes.length, mime_type: a.mime_type, received_at: day(m.received_at), doc_year: Number(m.received_at.slice(0, 4)),
      source: 'email', email_id: m.id, notes: 'The order we emailed the vendor',
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
