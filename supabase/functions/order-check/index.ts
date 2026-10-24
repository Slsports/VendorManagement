// order-check: order paperwork (Dana, Oct 10). Runs every minute from pg_cron (header x-cron-secret) and when
// a signed-in editor saves a confirmation or invoice ("Check now"). Each run takes the oldest waiting check:
//   reading   → Claude reads the document (confirmation / invoice / other, PO, numbers, lines); the order is found by our
//               PO, the vendor's own number, the conversation or the total (SQL), else Claude compares it with the
//               vendor's open orders (never "only one open order" alone)
//   comparing → Claude compares it with what we ordered (confirmation) or with the final confirmation (invoice); with no
//               order, or an order with no item list, a confirmation is compared with the sales report we ordered from
//               (Dana, Oct 13). It writes the summary and, with issues, the draft email; then it waits on a person.
// Nothing is ever sent from here. { preview_document_id } (cron secret only) reads a document and returns the reading,
// saving nothing.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { checkName, fixName, fixVendorId, lsContext, splitMarker } from '../_shared/itemNameSop.ts'
import { ITEM_NAME_SOP } from '../_shared/itemNameSopText.ts'
import { aiEnabled, comparePaperwork, compareWithSalesReport, isReadableFile, nameNewItems, pickPaperOrder, readAvailabilityReply, readPaperwork, type CompareReading, type PaperFile, type PaperReading } from '../_shared/ai.ts'
import { readSalesSheet, sheetForClaude } from '../_shared/salesSheet.ts'
import { sheetFileText } from '../_shared/sheetFile.ts'
import * as XLSX from 'npm:xlsx@0.18.5'
import { LS_STANDARD } from '../_shared/lsStandard.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'

const TIME_BUDGET_MS = 100_000
const MAX_FILE = 15 * 1024 * 1024

interface Check {
  id: string; organization_id: string; vendor_id: string | null; order_id: string | null; kind: 'confirmation' | 'invoice'; document_id: string
  email_id: string | null; status: string; reading: PaperReading | null; report_id: string | null; report_ticked: boolean | null; created_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    let org: string | null = null
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) org = (await caller(req, db, true)).organization_id
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const body = await req.json().catch(() => ({})) as { check_id?: string; preview_document_id?: string }
    // read only (pg_cron secret): how Claude reads a document now, saving nothing (Dana, Oct 24: show the Vendor IDs
    // before anything goes to LS)
    if (body.preview_document_id) {
      if (org) return json({ error: 'Not allowed' }, 403)
      return json(await previewRead(db, body.preview_document_id))
    }
    const started = Date.now()
    const done: unknown[] = []
    while (Date.now() - started < TIME_BUDGET_MS / 2) {
      const c = await nextCheck(db, org, body.check_id && !done.length ? body.check_id : null)
      if (!c) break
      done.push(await work(db, c))
      if (body.check_id && c.status === 'comparing') break
    }
    // LS PO drafts for confirmed orders (Dana, Oct 12), with the time left
    const drafted: unknown[] = []
    while (!body.check_id && Date.now() - started < TIME_BUDGET_MS * 0.8) {
      const p = await nextDraft(db, org)
      if (!p) break
      drafted.push(await draftLsPo(db, p))
    }
    // the reps' answers to "can we still order these?" (Dana, Oct 21), with the time left
    const answered: unknown[] = []
    while (!body.check_id && Date.now() - started < TIME_BUDGET_MS * 0.9) {
      const r = await readNextAsk(db)
      if (!r) break
      answered.push(r)
    }
    return json({ done, drafted, answered })
  } catch (e) {
    return errorResponse(e)
  }
})

/** The oldest check waiting to be read or compared that no other run is working on; claimed for 5 minutes. */
async function nextCheck(db: SupabaseClient, org: string | null, id: string | null): Promise<Check | null> {
  let q = db.from('order_checks').select('id, organization_id, vendor_id, order_id, kind, document_id, email_id, status, reading, report_id, report_ticked, created_at')
    .in('status', ['reading', 'comparing']).or(`working_at.is.null,working_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
  if (org) q = q.eq('organization_id', org)
  if (id) q = q.eq('id', id)
  const { data } = await q.order('created_at').limit(1)
  const c = data?.[0] as Check | undefined
  if (!c) return null
  const { data: claimed } = await db.from('order_checks').update({ working_at: new Date().toISOString() }).eq('id', c.id).eq('status', c.status).select('id')
  return claimed?.length ? c : null
}

async function previewRead(db: SupabaseClient, documentId: string) {
  const { data: l } = await db.from('vendor_links').select('id, organization_id, vendor_id, email_id').eq('id', documentId).maybeSingle()
  if (!l) return { error: 'Document not found' }
  const doc = await loadLink(db, l.id)
  if (!doc) return { error: 'The document file is missing' }
  const email = l.email_id ? (await db.from('emails').select('subject, body_text').eq('id', l.email_id).maybeSingle()).data : null
  const v = l.vendor_id ? (await db.from('vendors').select('name, vendor_id_rule').eq('id', l.vendor_id).maybeSingle()).data : null
  const reading = await readPaperwork(db, l.organization_id, doc, { vendor: v?.name ?? null, subject: email?.subject ?? null, email_text: email?.body_text ?? null, vendor_id_rule: v?.vendor_id_rule ?? null })
  return { document_id: l.id, reading }
}

async function work(db: SupabaseClient, c: Check) {
  try {
    const doc = await loadLink(db, c.document_id)
    if (!doc) throw new Error('The document file is missing')
    if (c.status === 'reading') {
      const email = c.email_id ? (await db.from('emails').select('subject, body_text').eq('id', c.email_id).maybeSingle()).data : null
      const v = c.vendor_id ? (await db.from('vendors').select('name, vendor_id_rule').eq('id', c.vendor_id).maybeSingle()).data : null
      // the vendor's own Vendor ID convention (Dana, Oct 24: Planet Cotton's <garment #>/<design #>)
      const reading = await readPaperwork(db, c.organization_id, doc, { vendor: v?.name ?? null, subject: email?.subject ?? null, email_text: email?.body_text ?? null, vendor_id_rule: v?.vendor_id_rule ?? null })
      const found = c.order_id ? { id: null, how: null } : await findOrder(db, c, reading)
      const { data: next, error } = await db.rpc('order_check_apply_read', { p_check: c.id, p_reading: reading, p_order: found.id, p_how: found.how })
      // not sure enough to match: Claude's best guess is picked in advance on the check page (Dana, Oct 14)
      if (!error && !found.id && found.likely) await db.from('order_checks').update({ suggested_order_id: found.likely }).eq('id', c.id)
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

/** The order a document is for: our PO, their number, the conversation or the total (SQL), else Claude's pick among open orders. */
async function findOrder(db: SupabaseClient, c: Check, reading: PaperReading): Promise<{ id: string | null; how: string | null; likely?: string | null }> {
  if (reading.doc_type !== 'confirmation' && reading.doc_type !== 'invoice') return { id: null, how: null }
  const { data: m } = await db.rpc('order_check_match', { p_check: c.id, p_reading: reading })
  const hit = (m ?? [])[0] as { order_id: string; how: string } | undefined
  if (hit) return { id: hit.order_id, how: hit.how }
  if (!c.vendor_id) return { id: null, how: null }
  const open = reading.doc_type === 'invoice' ? ['open', 'awaiting_confirmation', 'confirmed', 'shipped', 'received'] : ['open', 'awaiting_confirmation', 'confirmed']
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
  const { data: orders } = await db.from('orders').select('id, po_number, order_date, show_code, est_cost, est_ship_date, description, placed_by')
    .eq('vendor_id', c.vendor_id).in('status', open).or(`order_date.is.null,order_date.gte.${since}`).order('order_date', { ascending: false }).limit(15)
  const pick = await pickPaperOrder(db, c.organization_id, reading, (orders ?? []).map((o) => ({
    id: o.id, po: o.po_number, placed: o.order_date, show: o.show_code, amount: o.est_cost === null ? null : Number(o.est_cost), ship: o.est_ship_date, description: o.description, placed_by: o.placed_by,
  })))
  return pick.id ? { id: pick.id, how: 'claude' } : { id: null, how: null, likely: pick.likely }
}

async function loadLink(db: SupabaseClient, id: string): Promise<PaperFile | null> {
  const { data: l } = await db.from('vendor_links').select('storage_path, file_name, mime_type, label, kind, doc_number').eq('id', id).maybeSingle()
  if (!l?.storage_path) return null
  const { data, error } = await db.storage.from('vendor-files').download(l.storage_path)
  if (error || !data) throw new Error(`Opening ${l.file_name ?? l.label}: ${error?.message ?? 'not found'}`)
  if (data.size > MAX_FILE) throw new Error(`${l.file_name ?? l.label} is over 15 MB`)
  const name = l.file_name ?? l.label ?? 'document'
  const bytes = new Uint8Array(await data.arrayBuffer())
  // a spreadsheet (a rep's Excel copy of our order, Oct 15) is read as its text
  const text = /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? (await sheetFileText(bytes)) ?? undefined : undefined
  return { name, mime: l.mime_type ?? data.type ?? (/\.pdf$/i.test(name) ? 'application/pdf' : ''), bytes, text, label: `${l.kind === 'ls_po' ? 'LS PO' : l.kind === 'order' ? 'Our order' : l.kind}${l.doc_number ? ` ${l.doc_number}` : ''}: ${name}` }
}

/** What to compare against: for a confirmation, our order documents (else the PO we emailed); for an invoice, the newest confirmation. */
async function compare(db: SupabaseClient, c: Check, doc: PaperFile) {
  if (!c.order_id) return compareReport(db, c, doc, null)
  const { data: o } = await db.from('orders')
    .select('id, po_number, order_date, status, description, store_codes, est_cost, est_ship_date, freight_cost, freight_notes, free_shipping, free_shipping_basis, free_shipping_note, freight_allowance, freight_allowance_pay_by, ar_due, notes, vendor:vendors(name, email, free_shipping_policy, free_shipping_threshold, web_orders, usual_charges, order_set_at_show)')
    .eq('id', c.order_id!).single()
  if (!o) throw new Error('The order is gone')
  const { data: lines } = await db.from('order_lines').select('vendor_item_id, description, quantity, unit_cost, extended').eq('order_id', o.id).order('sort_order')
  // the freight quote we accepted (Dana, Oct 24: the invoice freight is checked against it)
  const { data: fq } = c.kind === 'invoice'
    ? await db.from('freight_quotes').select('vendor_cost, approved_choice, approved_cost, approved_at').eq('order_id', o.id).eq('status', 'approved').order('approved_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }
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
      if (f && (f.text || isReadableFile(f))) { against.push(f); againstIds.push(l.id) }
    }
    if (against.length) label = c.kind === 'invoice' ? 'What we ordered (no confirmation on file)' : 'Our order / LS PO'
  }
  if (!against.length) {
    const sent = await sentOrderFiles(db, c.organization_id, o.id, o.po_number, c.vendor_id)
    for (const s of sent) { against.push(s.file); againstIds.push(s.link_id) }
    if (sent.length) label = 'The order we emailed the vendor'
  }
  // no order document and no item list: a confirmation is compared with the sales report we ordered from (Dana, Oct 13)
  if (!label && !(lines ?? []).length && c.kind === 'confirmation' && c.vendor_id) {
    if (await compareReport(db, c, doc, o as unknown as Record<string, unknown>)) return
  }
  if (!label) label = (lines ?? []).length ? 'Our order lines in VMS' : 'The order record only (total, dates, freight); no order document on file'

  // an order often ships (and bills) in several parts: the other invoices on this order count too
  const { data: siblings } = await db.from('order_checks').select('doc_number, doc_date, doc_total, reading').eq('order_id', o.id).eq('kind', c.kind).neq('id', c.id).not('reading', 'is', null).limit(8)
  const others = (siblings ?? []).map((x) => ({ number: x.doc_number, date: x.doc_date, total: x.doc_total, lines: (x.reading as { lines?: unknown[] } | null)?.lines ?? [] }))

  // who to write to: whoever sent the document, else the vendor's email
  let contact: string | null = null
  if (c.email_id) contact = (await db.from('emails').select('from_email').eq('id', c.email_id).maybeSingle()).data?.from_email ?? null
  const vendor = o.vendor as unknown as { name: string; email: string | null; web_orders: boolean; usual_charges: { what: string; price: number | null; per: string | null }[]; order_set_at_show: boolean } | null
  contact ??= vendor?.email ?? null

  const conversation = await conversationFor(db, c, o.id)
  const r = await comparePaperwork(db, c.organization_id, {
    kind: c.kind, vendor: vendor?.name ?? null, order: { ...o, vendor: undefined, ...(fq ? { accepted_freight_quote: fq } : {}) }, order_lines: lines ?? [], doc, doc_reading: c.reading,
    against, against_readings: readings, contact, others, conversation, web_order: !!vendor?.web_orders, po_handled: c.kind === 'confirmation' && await poHandled(db, c.id, c.reading?.po_number),
    usual_charges: vendor?.usual_charges ?? [], show_order: !!vendor?.order_set_at_show, freight_quote: !!fq,
  })
  const issues = r.issues.filter((x) => x.trim())
  const { error } = await db.rpc('order_check_apply_compare', { p_check: c.id, p_result: {
    against: label, against_ids: againstIds, summary: r.summary, rows: r.rows, issues,
    draft_to: issues.length && contact ? [contact] : [], draft_subject: issues.length ? r.draft_subject : null, draft_body: issues.length ? r.draft_body : null,
  } })
  if (error) throw new Error(error.message)
  await db.from('order_checks').update({ new_items: r.new_items ?? [] }).eq('id', c.id)
  if (c.kind === 'confirmation') await recordUnavailable(db, c.id, r.unavailable)
}

/**
 * Items the vendor says are discontinued, replaced or out of stock (Dana, Oct 18): each becomes an item change with a
 * Review card for whoever placed the order. Nothing goes to Lightspeed until a person decides on the card.
 */
async function recordUnavailable(db: SupabaseClient, checkId: string, items: CompareReading['unavailable'] | undefined) {
  if (!items?.length) return
  const { error } = await db.rpc('item_changes_from_check', { p_check: checkId, p_items: items })
  if (error) throw new Error(`Unavailable items: ${error.message}`)
}

/** Their PO is missing, someone else's, or off our naming (Dana, Oct 20): the PO email handles it, so Claude doesn't ask too. */
async function poHandled(db: SupabaseClient, checkId: string, po: string | null | undefined): Promise<boolean> {
  const { data, error } = await db.rpc('po_check_state', { p_check: checkId })
  if (error) return !realPo(po)
  return data !== 'ours' && data !== 'fits'
}

const realPo = (po: string | null | undefined) => !!po && po.replace(/[^A-Za-z0-9]/g, '').length >= 3 && !/^\s*(n\/?a|none|tbd|pending|na|no po)\s*$/i.test(po)

/**
 * A confirmation compared with the sales report we ordered from: the order's "Report used", a ticked report, else the
 * closest before the confirmation's date. False when there is no report (the caller carries on without one).
 */
async function compareReport(db: SupabaseClient, c: Check, doc: PaperFile, order: Record<string, unknown> | null): Promise<boolean> {
  const date = c.reading?.doc_date ?? c.created_at.slice(0, 10)
  let reportId = c.report_id
  let ticked = !!c.report_ticked
  if (!reportId || order) {
    const { data } = await db.rpc('sales_report_for', { p_vendor: c.vendor_id, p_order: (order?.id as string | undefined) ?? null, p_date: date })
    const r = (data ?? [])[0] as { link_id: string; ticked: boolean } | undefined
    if (r) { reportId = r.link_id; ticked = r.ticked }
  }
  if (!reportId) {
    if (order) return false
    await db.from('order_checks').update({ status: 'needs_order', working_at: null }).eq('id', c.id)
    return true
  }
  const { data: l } = await db.from('vendor_links').select('storage_path, file_name, label').eq('id', reportId).single()
  const { data: file, error } = await db.storage.from('vendor-files').download(l!.storage_path!)
  if (error || !file) throw new Error(`Opening the sales report: ${error?.message ?? 'not found'}`)
  const book = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
  const sheet = readSalesSheet(book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw: true, defval: null, blankrows: false }) })))
  if (!sheet) throw new Error(`${l!.file_name ?? 'The sales report'}: no NEED or ORDER column found`)
  const name = l!.file_name ?? l!.label ?? 'Sales report'
  let contact: string | null = null
  if (c.email_id) contact = (await db.from('emails').select('from_email').eq('id', c.email_id).maybeSingle()).data?.from_email ?? null
  const { data: vendor } = await db.from('vendors').select('name, email, usual_charges, order_set_at_show').eq('id', c.vendor_id!).maybeSingle()
  contact ??= vendor?.email ?? null
  const conversation = await conversationFor(db, c, (order?.id as string | undefined) ?? null)
  const r = await compareWithSalesReport(db, c.organization_id, {
    vendor: vendor?.name ?? null, doc, doc_reading: c.reading, report_name: name, column: sheet.column, report: sheetForClaude(sheet),
    order: order ? { ...order, vendor: undefined } : null, conversation, contact, po_handled: await poHandled(db, c.id, c.reading?.po_number), usual_charges: vendor?.usual_charges ?? [], show_order: !!vendor?.order_set_at_show,
  })
  const issues = r.issues.filter((x) => x.trim())
  const { error: e2 } = await db.rpc('order_check_apply_compare', { p_check: c.id, p_result: {
    against: `Sales report: ${name} (${sheet.column === 'order' ? 'Order column' : 'Need column, Order was blank'})${ticked ? '' : ' – not ticked, please confirm'}`,
    against_ids: [reportId], summary: r.summary, rows: r.rows, issues, report_id: reportId, report_ticked: ticked,
    draft_to: issues.length && contact ? [contact] : [], draft_subject: issues.length ? r.draft_subject : null, draft_body: issues.length ? r.draft_body : null,
  } })
  if (e2) throw new Error(e2.message)
  await db.from('order_checks').update({ new_items: r.new_items ?? [] }).eq('id', c.id)
  await recordUnavailable(db, c.id, r.unavailable)
  return true
}

/**
 * The email conversation about the order (Dana, Oct 13: "I have to be able to see the emails threads for this so I can
 * properly review the email Claude puts together"): the conversation the document came in, and any other conversation
 * filed to the order, oldest first, each email without the mail quoted under it. Orders mail and shared conversations
 * only; the same list shows on the check's page.
 */
async function conversationFor(db: SupabaseClient, c: Check, orderId: string | null) {
  const threads = new Set<string>()
  if (c.email_id) {
    const { data } = await db.from('emails').select('thread_id').eq('id', c.email_id).maybeSingle()
    if (data?.thread_id) threads.add(data.thread_id)
  }
  if (orderId) {
    const { data: linked } = await db.from('emails').select('thread_id').eq('order_id', orderId).limit(20)
    for (const e of linked ?? []) if (e.thread_id) threads.add(e.thread_id)
  }
  if (!threads.size) return []
  const { data: shared } = await db.from('email_threads').select('id, mailbox_id, shared_at').in('id', [...threads])
  const ok = (shared ?? []).filter((t) => !t.mailbox_id || t.shared_at).map((t) => t.id)
  if (!ok.length) return []
  const { data: mails } = await db.from('emails').select('received_at, direction, from_name, from_email, subject, body_text, snippet, attachments:email_attachments(file_name)')
    .in('thread_id', ok).is('copy_of', null).neq('direction', 'internal').order('received_at').limit(40)
  return (mails ?? []).map((m) => ({
    date: String(m.received_at).slice(0, 10), from: [m.from_name, m.from_email].filter(Boolean).join(' '), direction: m.direction === 'out' ? 'from the store' : 'to the store',
    subject: m.subject, text: ownPart(m.body_text ?? m.snippet ?? '').slice(0, 1500),
    attachments: ((m.attachments ?? []) as { file_name: string }[]).map((a) => a.file_name).filter((n) => !/^(image\d*|outlook|logo|signature)/i.test(n)),
  }))
}

/** The email without the earlier mail quoted under it. */
function ownPart(text: string): string {
  const m = /\n(?:On .{4,200}wrote:|-{3,} ?Original Message|_{10,}|From: .+\n(?:Sent|Date): )/i.exec(text)
  return (m ? text.slice(0, m.index) : text).trim()
}

/**
 * The order we emailed the vendor (Dana's PO as a PDF from orders@): our sent mail on this order, or naming its PO
 * number, with a PDF attached. The file is saved to the order as "Our order" so the next check finds it.
 */
async function sentOrderFiles(db: SupabaseClient, org: string, orderId: string, po: string | null, vendorId: string | null): Promise<{ file: PaperFile; link_id: string }[]> {
  let q = db.from('emails').select('id, gmail_id, gmail_box, subject, received_at, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, storage_path, vendor_link_id)')
    .eq('organization_id', org).eq('direction', 'out').eq('has_attachments', true)
  const poClean = (po ?? '').trim()
  if (poClean.length >= 3) q = q.or(`order_id.eq.${orderId},subject.ilike.%${poClean.replace(/[%,()]/g, '')}%`)
  else q = q.eq('order_id', orderId)
  const { data: mails } = await q.order('received_at', { ascending: false }).limit(3)
  const out: { file: PaperFile; link_id: string }[] = []
  let gmail: Gmail | null = null
  let gmailBox: string | null = null
  for (const m of mails ?? []) {
    for (const a of (m.attachments ?? []) as { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; storage_path: string | null; vendor_link_id: string | null }[]) {
      if (out.length >= 2 || !isReadableFile({ name: a.file_name, mime: a.mime_type }) || /^(image\d+|outlook|logo|signature)/i.test(a.file_name) || (a.size ?? 0) > MAX_FILE) continue
      // a picture sent with a typed order is not the order (Dana, Oct 15: Planet Cotton's design pictures); sent-orders
      // files the pictures that are the order as "Our orders", and only those count
      if (a.vendor_link_id) {
        const { data: filed } = await db.from('vendor_links').select('kind').eq('id', a.vendor_link_id).maybeSingle()
        if (filed?.kind !== 'order' && filed?.kind !== 'ls_po') continue
      } else if (/^image\//i.test(a.mime_type ?? '')) continue
      let bytes: Uint8Array
      if (a.storage_path) {
        const { data } = await db.storage.from('vendor-files').download(a.storage_path)
        if (!data) continue
        bytes = new Uint8Array(await data.arrayBuffer())
      } else {
        if (!a.gmail_attachment_id) continue
        // the PO may have gone from orders@ or from someone's own mailbox (Dana, Oct 11)
        let box = (m as { gmail_box?: string | null }).gmail_box ?? null
        if (!box) box = (await db.from('mail_accounts').select('mailbox').eq('organization_id', org).maybeSingle()).data?.mailbox ?? null
        if (!box) return out
        if (!gmail || gmailBox !== box) { gmail = new Gmail(await googleAccessToken(box)); gmailBox = box }
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

// ---- LS PO drafts ----------------------------------------------------------------------------------------------
interface Draft { id: string; organization_id: string; order_id: string; vendor_id: string | null }
interface PoLine {
  vid: string | null; upc: string | null; desc: string; qty: number; cost: number | null; system_id: string | null; name: string; category: string; is_new: boolean; note: string | null
  /** the LS item when it is already in LS */
  ls_item_id?: string | null
  /** an item in LS whose name breaks the naming SOP: the SOP name, sent with the PO when ticked (rename on reorder) */
  rename?: string | null
  rename_ok?: boolean
  /** * or ** at the start of its LS name */
  marker?: '' | '*' | '**'
  /** what the person checking it in should look at (SOP problems, brackets, the Vendor ID to check on the invoice) */
  flags?: string[]
}
interface ReportItem { sid: string; upc: string; vid: string; desc: string; cat: string; cost: number | null; archived: boolean }

async function nextDraft(db: SupabaseClient, org: string | null): Promise<Draft | null> {
  let q = db.from('ls_pos').select('id, organization_id, order_id, vendor_id').eq('status', 'drafting')
    .or(`working_at.is.null,working_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
  if (org) q = q.eq('organization_id', org)
  const { data } = await q.order('created_at').limit(1)
  const p = data?.[0] as Draft | undefined
  if (!p) return null
  const { data: claimed } = await db.from('ls_pos').update({ working_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'drafting').select('id')
  return claimed?.length ? p : null
}

const itemKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const itemKeyNoZeros = (s: string | null | undefined) => itemKey(s).replace(/^0+(?=\d)/, '')

/** Build the PO from the confirmation (else our order's lines), match LS items, have Claude name the new ones. */
async function draftLsPo(db: SupabaseClient, p: Draft) {
  try {
    const { data: checks } = await db.from('order_checks').select('reading, created_at').eq('order_id', p.order_id).eq('kind', 'confirmation').not('reading', 'is', null).order('created_at', { ascending: false }).limit(1)
    const reading = checks?.[0]?.reading as { lines?: { vendor_item_id?: string | null; description?: string | null; quantity?: number | null; unit_cost?: number | null; upc?: string | null }[] } | undefined
    let source = 'the vendor\'s confirmation'
    let raw = (reading?.lines ?? []).map((l) => ({ vid: l.vendor_item_id ?? null, upc: l.upc ?? null, desc: l.description ?? '', qty: Number(l.quantity ?? 0), cost: l.unit_cost ?? null }))
    if (!raw.length) {
      const { data: ours } = await db.from('order_lines').select('vendor_item_id, description, quantity, unit_cost').eq('order_id', p.order_id).order('sort_order')
      raw = (ours ?? []).map((l) => ({ vid: l.vendor_item_id, upc: null, desc: l.description ?? '', qty: Number(l.quantity), cost: Number(l.unit_cost) }))
      source = 'our order'
    }
    raw = raw.filter((l) => l.qty > 0 && (l.desc || l.vid))
    if (!raw.length) {
      await db.from('ls_pos').update({ status: 'to_approve', lines: [], draft_note: 'No item list yet: the confirmation could not be read and the order has no items. Add the items, or click Redraft once the confirmation is in.', working_at: null }).eq('id', p.id)
      return { id: p.id, lines: 0 }
    }
    const { data: vendor } = p.vendor_id ? await db.from('vendors').select('name, lightspeed_vendor_id, vid_in_description, item_name_vendor, vendor_id_rule').eq('id', p.vendor_id).maybeSingle() : { data: null }
    // what the vendor has in LS: VMS's copy of LS (ls_items; the Vendor ID is the vendor's item number there), else its
    // latest sales report
    type LsHit = { item_id: string; system_sku: string; description: string; vendor_item_id: string; upc: string; category_path: string; archived: boolean }
    const lsItems: LsHit[] = []
    if (vendor?.lightspeed_vendor_id) {
      for (let from = 0; from < 20000; from += 1000) {
        const { data } = await db.from('ls_items').select('item_id, system_sku, description, vendor_item_id, upc, category_path, archived').eq('organization_id', p.organization_id).eq('default_vendor_id', vendor.lightspeed_vendor_id).order('archived').range(from, from + 999)
        lsItems.push(...((data ?? []) as LsHit[]))
        if (!data || data.length < 1000) break
      }
    }
    const upcs = raw.map((l) => l.upc).filter((u): u is string => !!u)
    if (upcs.length) {
      const { data } = await db.from('ls_items').select('item_id, system_sku, description, vendor_item_id, upc, category_path, archived').eq('organization_id', p.organization_id).in('upc', upcs)
      for (const x of (data ?? []) as LsHit[]) if (!lsItems.some((y) => y.item_id === x.item_id)) lsItems.push(x)
    }
    const { data: report } = p.vendor_id ? await db.from('sales_reports').select('items').eq('vendor_id', p.vendor_id).order('created_at', { ascending: false }).limit(1).maybeSingle() : { data: null }
    const items = ((report?.items ?? []) as ReportItem[])
    for (const h of lsItems) items.push({ sid: h.system_sku, upc: h.upc, vid: h.vendor_item_id, desc: h.description, cat: h.category_path, cost: null, archived: h.archived, item_id: h.item_id } as ReportItem & { item_id: string })
    const byVid = new Map<string, ReportItem & { item_id?: string }>()
    const byUpc = new Map<string, ReportItem & { item_id?: string }>()
    // LS's own copy wins over the report: it is added last, active items after archived ones
    for (const x of items as (ReportItem & { item_id?: string })[]) {
      if (x.vid && (!x.archived || !byVid.has(itemKey(x.vid)))) { byVid.set(itemKey(x.vid), x); byVid.set(itemKeyNoZeros(x.vid), x) }
      if (x.upc && (!x.archived || !byUpc.has(itemKey(x.upc)))) byUpc.set(itemKey(x.upc), x)
    }
    const sopCtx = (vid: string | null, category: string) => lsContext({ category_path: category, vendor_item_id: vid }, vendor)
    const lines: PoLine[] = raw.map((l) => {
      const hit = (l.vid ? byVid.get(itemKey(l.vid)) ?? byVid.get(itemKeyNoZeros(l.vid)) : undefined) ?? (l.upc ? byUpc.get(itemKey(l.upc)) : undefined)
      if (!hit) return { ...l, system_id: null, name: l.desc, category: '', is_new: true, note: null }
      // rename on reorder (Trevor's Proposal 3): the SOP name for an item whose LS name breaks it; the marker stays
      const ctx = sopCtx(l.vid ?? hit.vid, hit.cat)
      const fixed = fixName(hit.desc, ctx)
      const sop = fixVendorId(fixed, ctx) ?? fixed
      const marker = splitMarker(hit.desc).marker
      const flags = checkName(sop, ctx).filter((x) => !x.fixable).map((x) => x.text)
      if (marker === '*') flags.unshift('* in LS: discontinued or no longer orderable. Take it off the order or keep it.')
      if (marker === '**') flags.unshift('** in LS: we chose not to reorder it. Take it off the order or keep it.')
      return {
        ...l, system_id: hit.sid, ls_item_id: hit.item_id ?? null, name: hit.desc, category: hit.cat, is_new: false,
        note: hit.archived ? 'Archived in LS: unarchive it' : null, marker, flags,
        ...(sop !== hit.desc ? { rename: sop, rename_ok: true } : {}),
      }
    })
    const fresh = lines.map((l, i) => ({ l, i })).filter((x) => x.l.is_new)
    if (fresh.length) {
      const named = await nameNewItems(db, p.organization_id, {
        standard: LS_STANDARD, sop: ITEM_NAME_SOP, vendor: vendor?.name ?? 'Unknown vendor', vendor_in_names: vendor?.item_name_vendor ?? null,
        vendor_id_in_names: !!vendor?.vid_in_description,
        existing: items.filter((x) => !x.archived).map((x) => ({ name: x.desc, category: x.cat })),
        items: fresh.map((x) => ({ i: x.i, vendor_id: x.l.vid, description: x.l.desc, cost: x.l.cost })),
      })
      for (const n of named.items) {
        const l = lines[n.i]
        if (!l?.is_new) continue
        const ctx = sopCtx(l.vid, n.category)
        const fixed = fixName(n.name, ctx)
        l.name = fixVendorId(fixed, ctx) ?? fixed
        l.category = n.category
        l.note = n.note
        const flags = checkName(l.name, ctx).filter((x) => !x.fixable).map((x) => x.text)
        if (n.needs_description) flags.unshift('Needs manual description')
        if (/\[[^\]]*\]/.test(l.name)) flags.unshift('Part of the name is in [brackets]: check it on the tag')
        if (ctx.fishing || ctx.vidVendor) flags.push(l.vid ? 'Vendor ID from the paperwork: check it against the invoice (the invoice wins)' : 'Waiting on Vendor ID (from the invoice)')
        l.flags = flags
      }
      // no two LS items may have the same name
      const names = fresh.map((x) => x.l.name).filter(Boolean)
      if (names.length) {
        const { data: taken } = await db.from('ls_items').select('description').eq('organization_id', p.organization_id).in('description', names)
        const used = new Set((taken ?? []).map((t) => t.description))
        for (const x of fresh) if (used.has(x.l.name)) (x.l.flags ??= []).unshift('Another LS item already has this name: add what tells them apart')
      }
    }
    // a Vendor ID in the vendor's own convention (garment/design, Oct 24) that LS has only under the old one (the garment
    // alone): a person picks the LS item or keeps it new; existing LS items keep their Vendor IDs
    if (vendor?.vendor_id_rule) {
      for (const l of lines) {
        const garment = l.is_new && l.vid?.includes('/') ? l.vid.split('/')[0]!.trim() : ''
        if (garment && byVid.has(itemKey(garment))) (l.flags ??= []).unshift(`LS has ${garment} under the old Vendor ID (garment only): pick that item if it's the same design, or keep it as a new item`)
      }
    }
    const newCount = lines.filter((l) => l.is_new).length
    await db.from('ls_pos').update({
      status: 'to_approve', lines, working_at: null, draft_error: null,
      draft_note: `From ${source}: ${lines.length} item${lines.length === 1 ? '' : 's'}, ${newCount} new to LS${lines.some((l) => l.rename) ? `, ${lines.filter((l) => l.rename).length} LS name${lines.filter((l) => l.rename).length === 1 ? '' : 's'} to bring up to the naming SOP` : ''}${items.length ? '' : ' (this vendor has no items in LS yet, so every item is treated as new)'}.`,
    }).eq('id', p.id)
    return { id: p.id, lines: lines.length, new: newCount }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from('ls_pos').update({ draft_error: message.slice(0, 500), working_at: new Date(Date.now() + 25 * 60_000).toISOString() }).eq('id', p.id)
    return { id: p.id, error: message }
  }
}

// ---- the rep's answer to "can we still order these?" (Dana, Oct 21) ----------------------------------------------------
type Ask = { ask_id: string; organization_id: string; vendor_id: string; vendor_name: string; items: { vid: string | null; name: string | null; qty?: number }[]; thread_id: string; sent_at: string; created_by: string | null }

/**
 * The next ask the rep has replied to: Claude reads the reply (its new text and any list the rep sent back) and the items
 * not available become Review cards for the person who asked. Nothing changes until a person decides.
 */
async function readNextAsk(db: SupabaseClient): Promise<unknown> {
  const { data } = await db.rpc('availability_ask_next')
  const a = ((data ?? []) as Ask[])[0]
  if (!a) return null
  try {
    const { data: mails } = await db.from('emails').select('id, gmail_id, gmail_box, organization_id, from_email, from_name, subject, body_text, snippet, received_at, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, storage_path)')
      .eq('thread_id', a.thread_id).eq('direction', 'in').gt('received_at', a.sent_at).order('received_at').limit(5)
    const replies = mails ?? []
    if (!replies.length) return { ask: a.ask_id, skipped: 'no reply' }
    const files: PaperFile[] = []
    for (const m of replies) {
      for (const att of (m.attachments ?? []) as { file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; storage_path: string | null }[]) {
        if (files.length >= 3 || (att.size ?? 0) > MAX_FILE || /^(image\d+|outlook|logo|signature)/i.test(att.file_name)) continue
        const sheet = /\.(xlsx|xlsm|xls|csv)$/i.test(att.file_name)
        if (!sheet && !isReadableFile({ name: att.file_name, mime: att.mime_type })) continue
        const bytes = await attachmentBytes(db, m as unknown as MailRef, att)
        if (!bytes) continue
        if (sheet) files.push({ name: att.file_name, mime: att.mime_type ?? 'text/plain', bytes, text: (await sheetFileText(bytes)) ?? undefined })
        else files.push({ name: att.file_name, mime: att.mime_type ?? 'application/pdf', bytes })
      }
    }
    const reading = await readAvailabilityReply(db, a.organization_id, {
      vendor: a.vendor_name, items: a.items.map((i) => ({ vid: i.vid, name: i.name })),
      emails: replies.map((m) => ({ from: [m.from_name, m.from_email].filter(Boolean).join(' '), subject: m.subject, text: m.body_text || m.snippet || '' })), files,
    })
    const reply = replies[replies.length - 1]!.id
    const { data: n, error } = await db.rpc('availability_ask_read', { p_ask: a.ask_id, p_reply: reply, p_answers: reading.items, p_note: reading.note })
    if (error) throw error
    return { ask: a.ask_id, cards: n, note: reading.note }
  } catch (e) {
    await db.from('availability_asks').update({ working_at: null, read_note: `Could not read the reply yet: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }).eq('id', a.ask_id)
    return { ask: a.ask_id, error: e instanceof Error ? e.message : String(e) }
  }
}

type MailRef = { gmail_id: string; gmail_box: string | null; organization_id: string }
async function attachmentBytes(db: SupabaseClient, m: MailRef, a: { gmail_attachment_id: string | null; storage_path: string | null }): Promise<Uint8Array | null> {
  if (a.storage_path) {
    const { data } = await db.storage.from('vendor-files').download(a.storage_path)
    return data ? new Uint8Array(await data.arrayBuffer()) : null
  }
  if (!a.gmail_attachment_id) return null
  const box = m.gmail_box ?? (await db.from('mail_accounts').select('mailbox').eq('organization_id', m.organization_id).maybeSingle()).data?.mailbox
  if (!box) return null
  const gmail = new Gmail(await googleAccessToken(box))
  const part = await gmail.call<{ data: string }>(`messages/${m.gmail_id}/attachments/${a.gmail_attachment_id}`)
  const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
