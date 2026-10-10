// order-check: order paperwork (Dana, Oct 10). Runs every minute from pg_cron (header x-cron-secret) and when
// a signed-in editor saves a confirmation or invoice ("Check now"). Each run takes the oldest waiting check:
//   reading   → Claude reads the document (confirmation / invoice / other, PO, numbers, lines); SQL finds the order
//   comparing → Claude compares it with what we ordered (confirmation) or with the final confirmation (invoice),
//               writes the summary and, with issues, the draft email; it then waits on the person who placed the order.
// Nothing is ever sent from here.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, comparePaperwork, isReadableFile, readPaperwork, type PaperFile, type PaperReading } from '../_shared/ai.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'

const TIME_BUDGET_MS = 100_000
const MAX_FILE = 15 * 1024 * 1024

interface Check {
  id: string; organization_id: string; vendor_id: string | null; order_id: string | null; kind: 'confirmation' | 'invoice'; document_id: string
  email_id: string | null; status: string; reading: PaperReading | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    let org: string | null = null
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) org = (await caller(req, db, true)).organization_id
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const body = await req.json().catch(() => ({})) as { check_id?: string }
    const started = Date.now()
    const done: unknown[] = []
    while (Date.now() - started < TIME_BUDGET_MS / 2) {
      const c = await nextCheck(db, org, body.check_id && !done.length ? body.check_id : null)
      if (!c) break
      done.push(await work(db, c))
      if (body.check_id && c.status === 'comparing') break
    }
    return json({ done })
  } catch (e) {
    return errorResponse(e)
  }
})

/** The oldest check waiting to be read or compared that no other run is working on; claimed for 5 minutes. */
async function nextCheck(db: SupabaseClient, org: string | null, id: string | null): Promise<Check | null> {
  let q = db.from('order_checks').select('id, organization_id, vendor_id, order_id, kind, document_id, email_id, status, reading')
    .in('status', ['reading', 'comparing']).or(`working_at.is.null,working_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
  if (org) q = q.eq('organization_id', org)
  if (id) q = q.eq('id', id)
  const { data } = await q.order('created_at').limit(1)
  const c = data?.[0] as Check | undefined
  if (!c) return null
  const { data: claimed } = await db.from('order_checks').update({ working_at: new Date().toISOString() }).eq('id', c.id).eq('status', c.status).select('id')
  return claimed?.length ? c : null
}

async function work(db: SupabaseClient, c: Check) {
  try {
    const doc = await loadLink(db, c.document_id)
    if (!doc) throw new Error('The document file is missing')
    if (c.status === 'reading') {
      const email = c.email_id ? (await db.from('emails').select('subject, body_text').eq('id', c.email_id).maybeSingle()).data : null
      const vendor = c.vendor_id ? (await db.from('vendors').select('name').eq('id', c.vendor_id).maybeSingle()).data?.name ?? null : null
      const reading = await readPaperwork(db, c.organization_id, doc, { vendor, subject: email?.subject ?? null, email_text: email?.body_text ?? null })
      const { data: next, error } = await db.rpc('order_check_apply_read', { p_check: c.id, p_reading: reading })
      if (error) throw new Error(error.message)
      return { id: c.id, read: next }
    }
    await compare(db, c, doc)
    return { id: c.id, compared: true }
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    await db.from('order_checks').update({ status: 'failed', working_at: null, read_note: msg }).eq('id', c.id)
    return { id: c.id, error: msg }
  }
}

async function loadLink(db: SupabaseClient, id: string): Promise<PaperFile | null> {
  const { data: l } = await db.from('vendor_links').select('storage_path, file_name, mime_type, label, kind, doc_number').eq('id', id).maybeSingle()
  if (!l?.storage_path) return null
  const { data, error } = await db.storage.from('vendor-files').download(l.storage_path)
  if (error || !data) throw new Error(`Opening ${l.file_name ?? l.label}: ${error?.message ?? 'not found'}`)
  if (data.size > MAX_FILE) throw new Error(`${l.file_name ?? l.label} is over 15 MB`)
  const name = l.file_name ?? l.label ?? 'document'
  return { name, mime: l.mime_type ?? data.type ?? (/\.pdf$/i.test(name) ? 'application/pdf' : ''), bytes: new Uint8Array(await data.arrayBuffer()), label: `${l.kind === 'ls_po' ? 'LS PO' : l.kind === 'order' ? 'Our order' : l.kind}${l.doc_number ? ` ${l.doc_number}` : ''}: ${name}` }
}

/** What to compare against: for a confirmation, our order documents (else the PO we emailed); for an invoice, the newest confirmation. */
async function compare(db: SupabaseClient, c: Check, doc: PaperFile) {
  const { data: o } = await db.from('orders')
    .select('id, po_number, order_date, status, description, store_codes, est_cost, est_ship_date, freight_cost, freight_notes, free_shipping, free_shipping_basis, free_shipping_note, freight_allowance, freight_allowance_pay_by, ar_due, notes, vendor:vendors(name, email, free_shipping_policy, free_shipping_threshold)')
    .eq('id', c.order_id!).single()
  if (!o) throw new Error('The order is gone')
  const { data: lines } = await db.from('order_lines').select('vendor_item_id, description, quantity, unit_cost, extended').eq('order_id', o.id).order('sort_order')
  const against: PaperFile[] = []
  const againstIds: string[] = []
  const readings: Record<string, unknown>[] = []
  let label = ''

  if (c.kind === 'invoice') {
    const { data: conf } = await db.from('order_checks').select('document_id, reading').eq('order_id', o.id).eq('kind', 'confirmation')
      .in('status', ['to_review', 'done']).order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1)
    if (conf?.[0]) {
      const f = await loadLink(db, conf[0].document_id)
      if (f) { against.push(f); againstIds.push(conf[0].document_id); readings.push(conf[0].reading as Record<string, unknown>); label = 'The final confirmation' }
    }
  }
  if (!against.length) {
    const { data: ours } = await db.from('vendor_links').select('id').eq('order_id', o.id).in('kind', ['order', 'ls_po']).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(2)
    for (const l of ours ?? []) {
      const f = await loadLink(db, l.id)
      if (f && isReadableFile(f)) { against.push(f); againstIds.push(l.id) }
    }
    if (against.length) label = c.kind === 'invoice' ? 'What we ordered (no confirmation on file)' : 'Our order / LS PO'
  }
  if (!against.length) {
    const sent = await sentOrderFiles(db, c.organization_id, o.id, o.po_number, c.vendor_id)
    for (const s of sent) { against.push(s.file); againstIds.push(s.link_id) }
    if (sent.length) label = 'The order we emailed the vendor'
  }
  if (!label) label = (lines ?? []).length ? 'The order lines in VMS' : 'The order record only (total, dates, freight); no order document on file'

  // an order often ships (and bills) in several parts: the other invoices on this order count too
  const { data: siblings } = await db.from('order_checks').select('doc_number, doc_date, doc_total, reading').eq('order_id', o.id).eq('kind', c.kind).neq('id', c.id).not('reading', 'is', null).limit(8)
  const others = (siblings ?? []).map((x) => ({ number: x.doc_number, date: x.doc_date, total: x.doc_total, lines: (x.reading as { lines?: unknown[] } | null)?.lines ?? [] }))

  // who to write to: whoever sent the document, else the vendor's email
  let contact: string | null = null
  if (c.email_id) contact = (await db.from('emails').select('from_email').eq('id', c.email_id).maybeSingle()).data?.from_email ?? null
  const vendor = o.vendor as unknown as { name: string; email: string | null } | null
  contact ??= vendor?.email ?? null

  const r = await comparePaperwork(db, c.organization_id, {
    kind: c.kind, vendor: vendor?.name ?? null, order: { ...o, vendor: undefined }, order_lines: lines ?? [], doc, doc_reading: c.reading,
    against, against_readings: readings, contact, others,
  })
  const issues = r.issues.filter((x) => x.trim())
  const { error } = await db.rpc('order_check_apply_compare', { p_check: c.id, p_result: {
    against: label, against_ids: againstIds, summary: r.summary, rows: r.rows, issues,
    draft_to: issues.length && contact ? [contact] : [], draft_subject: issues.length ? r.draft_subject : null, draft_body: issues.length ? r.draft_body : null,
  } })
  if (error) throw new Error(error.message)
}

/**
 * The order we emailed the vendor (Dana's PO as a PDF from orders@): our sent mail on this order, or naming its PO
 * number, with a PDF attached. The file is saved to the order as "Our order" so the next check finds it.
 */
async function sentOrderFiles(db: SupabaseClient, org: string, orderId: string, po: string | null, vendorId: string | null): Promise<{ file: PaperFile; link_id: string }[]> {
  let q = db.from('emails').select('id, gmail_id, subject, received_at, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, storage_path, vendor_link_id)')
    .eq('organization_id', org).eq('direction', 'out').eq('has_attachments', true)
  const poClean = (po ?? '').trim()
  if (poClean.length >= 3) q = q.or(`order_id.eq.${orderId},subject.ilike.%${poClean.replace(/[%,()]/g, '')}%`)
  else q = q.eq('order_id', orderId)
  const { data: mails } = await q.order('received_at', { ascending: false }).limit(3)
  const out: { file: PaperFile; link_id: string }[] = []
  let gmail: Gmail | null = null
  for (const m of mails ?? []) {
    for (const a of (m.attachments ?? []) as { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; storage_path: string | null; vendor_link_id: string | null }[]) {
      if (out.length >= 2 || !isReadableFile({ name: a.file_name, mime: a.mime_type }) || /^(image\d+|outlook|logo|signature)/i.test(a.file_name) || (a.size ?? 0) > MAX_FILE) continue
      let bytes: Uint8Array
      if (a.storage_path) {
        const { data } = await db.storage.from('vendor-files').download(a.storage_path)
        if (!data) continue
        bytes = new Uint8Array(await data.arrayBuffer())
      } else {
        if (!a.gmail_attachment_id) continue
        if (!gmail) {
          const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', org).maybeSingle()
          if (!acct) return out
          gmail = new Gmail(await googleAccessToken(acct.mailbox))
        }
        const part = await gmail.call<{ data: string }>(`messages/${m.gmail_id}/attachments/${a.gmail_attachment_id}`)
        const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
        const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      }
      const mime = a.mime_type ?? 'application/pdf'
      let linkId = a.vendor_link_id
      if (!linkId && vendorId) {
        const path = a.storage_path ?? `${org}/${vendorId}/${crypto.randomUUID()}-${a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        if (!a.storage_path) {
          const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: mime, upsert: false })
          if (upErr) throw new Error(`Saving ${a.file_name}: ${upErr.message}`)
        }
        const { data: link } = await db.from('vendor_links').insert({
          organization_id: org, vendor_id: vendorId, order_id: orderId, kind: 'order', label: a.file_name.replace(/\.[a-z0-9]{2,5}$/i, ''), storage_path: path,
          file_name: a.file_name, file_size: bytes.length, mime_type: mime, received_at: m.received_at.slice(0, 10), doc_year: Number(m.received_at.slice(0, 4)),
          source: 'email', email_id: m.id, notes: `Sent from orders@: ${m.subject ?? ''}`.slice(0, 300),
        }).select('id').single()
        if (link) { linkId = link.id; await db.from('email_attachments').update({ vendor_link_id: link.id, storage_path: path }).eq('id', a.id) }
      }
      out.push({ file: { name: a.file_name, mime, bytes, label: `Our order (emailed ${m.received_at.slice(0, 10)}): ${a.file_name}` }, link_id: linkId ?? a.id })
    }
    if (out.length) break
  }
  return out
}
