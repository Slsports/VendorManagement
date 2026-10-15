// order-check: order paperwork (Dana, Oct 10). Runs every minute from pg_cron (header x-cron-secret) and when
// a signed-in editor saves a confirmation or invoice ("Check now"). Each run takes the oldest waiting check:
//   reading   → Claude reads the document (confirmation / invoice / other, PO, numbers, lines); the order is found by our
//               PO, the vendor's own number, the conversation or the total (SQL), else Claude compares it with the
//               vendor's open orders (never "only one open order" alone)
//   comparing → Claude compares it with what we ordered (confirmation) or with the final confirmation (invoice); with no
//               order, or an order with no item list, a confirmation is compared with the sales report we ordered from
//               (Dana, Oct 13). It writes the summary and, with issues, the draft email; then it waits on a person.
// Nothing is ever sent from here.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, comparePaperwork, compareWithSalesReport, isReadableFile, nameNewItems, pickPaperOrder, readPaperwork, type PaperFile, type PaperReading } from '../_shared/ai.ts'
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
    const body = await req.json().catch(() => ({})) as { check_id?: string }
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
    return json({ done, drafted })
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

async function work(db: SupabaseClient, c: Check) {
  try {
    const doc = await loadLink(db, c.document_id)
    if (!doc) throw new Error('The document file is missing')
    if (c.status === 'reading') {
      const email = c.email_id ? (await db.from('emails').select('subject, body_text').eq('id', c.email_id).maybeSingle()).data : null
      const vendor = c.vendor_id ? (await db.from('vendors').select('name').eq('id', c.vendor_id).maybeSingle()).data?.name ?? null : null
      const reading = await readPaperwork(db, c.organization_id, doc, { vendor, subject: email?.subject ?? null, email_text: email?.body_text ?? null })
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
    kind: c.kind, vendor: vendor?.name ?? null, order: { ...o, vendor: undefined }, order_lines: lines ?? [], doc, doc_reading: c.reading,
    against, against_readings: readings, contact, others, conversation, web_order: !!vendor?.web_orders, po_handled: c.kind === 'confirmation' && !realPo(c.reading?.po_number),
    usual_charges: vendor?.usual_charges ?? [], show_order: !!vendor?.order_set_at_show,
  })
  const issues = r.issues.filter((x) => x.trim())
  const { error } = await db.rpc('order_check_apply_compare', { p_check: c.id, p_result: {
    against: label, against_ids: againstIds, summary: r.summary, rows: r.rows, issues,
    draft_to: issues.length && contact ? [contact] : [], draft_subject: issues.length ? r.draft_subject : null, draft_body: issues.length ? r.draft_body : null,
  } })
  if (error) throw new Error(error.message)
  await db.from('order_checks').update({ new_items: r.new_items ?? [] }).eq('id', c.id)
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
    order: order ? { ...order, vendor: undefined } : null, conversation, contact, po_handled: !realPo(c.reading?.po_number), usual_charges: vendor?.usual_charges ?? [], show_order: !!vendor?.order_set_at_show,
  })
  const issues = r.issues.filter((x) => x.trim())
  const { error: e2 } = await db.rpc('order_check_apply_compare', { p_check: c.id, p_result: {
    against: `Sales report: ${name} (${sheet.column === 'order' ? 'Order column' : 'Need column, Order was blank'})${ticked ? '' : ' – not ticked, please confirm'}`,
    against_ids: [reportId], summary: r.summary, rows: r.rows, issues, report_id: reportId, report_ticked: ticked,
    draft_to: issues.length && contact ? [contact] : [], draft_subject: issues.length ? r.draft_subject : null, draft_body: issues.length ? r.draft_body : null,
  } })
  if (e2) throw new Error(e2.message)
  await db.from('order_checks').update({ new_items: r.new_items ?? [] }).eq('id', c.id)
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
interface PoLine { vid: string | null; upc: string | null; desc: string; qty: number; cost: number | null; system_id: string | null; name: string; category: string; is_new: boolean; note: string | null }
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
    // what the vendor already has in LS, from its latest sales report
    const { data: report } = p.vendor_id ? await db.from('sales_reports').select('items').eq('vendor_id', p.vendor_id).order('created_at', { ascending: false }).limit(1).maybeSingle() : { data: null }
    const items = ((report?.items ?? []) as ReportItem[])
    const byVid = new Map<string, ReportItem>()
    const byUpc = new Map<string, ReportItem>()
    for (const x of items) {
      if (x.vid) { byVid.set(itemKey(x.vid), x); byVid.set(itemKeyNoZeros(x.vid), x) }
      if (x.upc) byUpc.set(itemKey(x.upc), x)
    }
    const lines: PoLine[] = raw.map((l) => {
      const hit = (l.vid ? byVid.get(itemKey(l.vid)) ?? byVid.get(itemKeyNoZeros(l.vid)) : undefined) ?? (l.upc ? byUpc.get(itemKey(l.upc)) : undefined)
      return hit
        ? { ...l, system_id: hit.sid, name: hit.desc, category: hit.cat, is_new: false, note: hit.archived ? 'Archived in LS: unarchive it' : null }
        : { ...l, system_id: null, name: l.desc, category: '', is_new: true, note: null }
    })
    const fresh = lines.map((l, i) => ({ l, i })).filter((x) => x.l.is_new)
    if (fresh.length) {
      const { data: vendor } = p.vendor_id ? await db.from('vendors').select('name').eq('id', p.vendor_id).maybeSingle() : { data: null }
      const named = await nameNewItems(db, p.organization_id, {
        standard: LS_STANDARD, vendor: vendor?.name ?? 'Unknown vendor',
        existing: items.filter((x) => !x.archived).map((x) => ({ name: x.desc, category: x.cat })),
        items: fresh.map((x) => ({ i: x.i, vendor_id: x.l.vid, description: x.l.desc, cost: x.l.cost })),
      })
      for (const n of named.items) {
        const l = lines[n.i]
        if (l?.is_new) { l.name = n.name; l.category = n.category; l.note = n.note }
      }
    }
    const newCount = lines.filter((l) => l.is_new).length
    await db.from('ls_pos').update({
      status: 'to_approve', lines, working_at: null, draft_error: null,
      draft_note: `From ${source}: ${lines.length} item${lines.length === 1 ? '' : 's'}, ${newCount} new to LS${items.length ? '' : ' (no sales report for this vendor, so every item is treated as new)'}.`,
    }).eq('id', p.id)
    return { id: p.id, lines: lines.length, new: newCount }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from('ls_pos').update({ draft_error: message.slice(0, 500), working_at: new Date(Date.now() + 25 * 60_000).toISOString() }).eq('id', p.id)
    return { id: p.id, error: message }
  }
}
