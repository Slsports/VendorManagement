// order-form: edit an order we emailed and send the changes without downloading anything (Dana, Nov 13: "Paricon is out of
// cm130 (hardwood snowboard) so im putting it back on slippery racers order. I need to be able to edit these orders and
// resend. Where can I do it without downloading to my computer?").
//   { action: 'read', order_id }                 → the vendor's own order form (the Excel file we sent) read as rows: every
//                                                  item with its color cells, price, case pack, units and total
//   { action: 'send', order_id, edits, note? }   → the new numbers written into that same form (its layout and formulas
//                                                  kept), filed on the order as "<name> REVISED M-D-YY.xlsx" with the earlier
//                                                  copy marked old, the order's lines and total brought up to date, and the
//                                                  reply drafted in the conversation we sent the order in, revised form
//                                                  attached, for the person to read and press Send (nothing goes on its own).
// Signed-in editors only (admin, manager, buyer); the person's own organization.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'npm:fflate@0.8.2'
import { CORS, HttpError, type Caller, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { applyEdits, describeChanges, forceRecalcOnOpen, formLines, parseSharedStrings, parseSheet, readForm, revisedFileName, type Edit, type FormModel } from '../_shared/orderForm.ts'

const BUCKET = 'vendor-files'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const today = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const longDate = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const me = await caller(req, db, true)
    const body = await req.json() as { action?: string; order_id?: string; edits?: Edit[]; note?: string }
    if (!body.order_id) throw new HttpError(400, 'Which order?')
    switch (body.action) {
      case 'read': return json(await readOrderForm(db, me, body.order_id))
      case 'send': return json(await sendChanges(db, me, body.order_id, body.edits ?? [], body.note ?? ''))
      default: throw new HttpError(400, 'Unknown action')
    }
  } catch (e) {
    return errorResponse(e)
  }
})

interface OrderRow { id: string; organization_id: string; vendor_id: string | null; po_number: string | null; order_date: string | null; status: string }
interface LinkRow { id: string; file_name: string; storage_path: string | null; mime_type: string | null; email_id: string | null; created_at: string; superseded_at: string | null }
interface Loaded {
  order: OrderRow
  link: LinkRow
  files: Record<string, Uint8Array>
  sheetPath: string
  sheetXml: string
  shared: string[]
  model: FormModel
  vids: string[]
  /** the email we last sent this order with: the conversation and the people to answer in */
  email: { id: string; thread_id: string | null; subject: string | null; to_emails: string[]; cc_emails: string[]; mailbox_id: string | null; received_at: string } | null
}

/** The order, its current order file (the Excel we emailed) opened and read, and the email it went out in. */
async function load(db: SupabaseClient, me: Caller, orderId: string): Promise<Loaded> {
  const { data: order } = await db.from('orders').select('id, organization_id, vendor_id, po_number, order_date, status').eq('id', orderId).maybeSingle()
  if (!order || order.organization_id !== me.organization_id) throw new HttpError(404, 'Order not found')
  const { data: links } = await db.from('vendor_links').select('id, file_name, storage_path, mime_type, email_id, created_at, superseded_at').eq('order_id', orderId).eq('kind', 'order').is('superseded_at', null).not('storage_path', 'is', null).order('created_at', { ascending: false })
  const link = (links ?? []).find((l) => /\.xlsx$/i.test(l.file_name) || l.mime_type === XLSX_MIME) as LinkRow | undefined
  if (!link) throw new HttpError(404, 'This order has no Excel order form on file, so there is nothing for VMS to edit. Change the lines in Check-in pricing and write the vendor yourself.')
  const { data: blob, error } = await db.storage.from(BUCKET).download(link.storage_path!)
  if (error || !blob) throw new HttpError(500, `VMS could not open ${link.file_name}: ${error?.message ?? 'missing'}`)
  let files: Record<string, Uint8Array>
  try { files = unzipSync(new Uint8Array(await blob.arrayBuffer())) } catch { throw new HttpError(400, `${link.file_name} is not an Excel file VMS can open`) }
  // the first sheet the workbook lists
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : ''
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : ''
  const firstRid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const target = firstRid ? rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${firstRid}"[^>]*\\bTarget="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstRid}"`))?.[1] : undefined
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  if (!files[sheetPath]) throw new HttpError(400, `${link.file_name} has no sheet VMS can read`)
  const sheetXml = strFromU8(files[sheetPath]!)
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '')
  const { data: lines } = await db.from('order_lines').select('vendor_item_id, quantity, unit_cost').eq('order_id', orderId)
  const vids = (lines ?? []).map((l) => (l.vendor_item_id ?? '').trim()).filter(Boolean)
  const model = readForm(parseSheet(sheetXml, shared), vids, (lines ?? []).filter((l) => l.vendor_item_id).map((l) => ({ vid: l.vendor_item_id!, quantity: Number(l.quantity), unit_cost: l.unit_cost === null ? null : Number(l.unit_cost) })))
  // the email the order went out in (the latest one with an order file), so the reply lands in that conversation
  const emailIds = (links ?? []).map((l) => l.email_id).filter((x): x is string => !!x)
  let email: Loaded['email'] = null
  if (emailIds.length) {
    const { data: e } = await db.from('emails').select('id, thread_id, subject, to_emails, cc_emails, mailbox_id, received_at, direction').in('id', emailIds).eq('direction', 'out').order('received_at', { ascending: false }).limit(1).maybeSingle()
    if (e) email = { id: e.id, thread_id: e.thread_id, subject: e.subject, to_emails: e.to_emails ?? [], cc_emails: e.cc_emails ?? [], mailbox_id: e.mailbox_id, received_at: e.received_at }
  }
  return { order: order as OrderRow, link, files, sheetPath, sheetXml, shared, model, vids, email }
}

async function readOrderForm(db: SupabaseClient, me: Caller, orderId: string) {
  const l = await load(db, me, orderId)
  return { ok: true, file_name: l.link.file_name, link_id: l.link.id, form: l.model, lines: formLines(l.model), sent: l.email ? { email_id: l.email.id, thread_id: l.email.thread_id, on: l.email.received_at, to: l.email.to_emails, cc: l.email.cc_emails } : null }
}

async function sendChanges(db: SupabaseClient, me: Caller, orderId: string, edits: Edit[], note: string) {
  const l = await load(db, me, orderId)
  if (!l.model.editable) throw new HttpError(400, l.model.why ?? 'VMS cannot edit this form')
  if (!l.email) throw new HttpError(400, 'VMS has no record of the email this order went out in, so it cannot write the reply. Send the revised form from Mail yourself.')
  const allowed = new Set(l.model.rows.flatMap((r) => r.inputs.map((i) => i.ref)))
  const clean = edits.filter((e) => allowed.has(String(e.ref).toUpperCase())).map((e) => ({ ref: String(e.ref).toUpperCase(), value: e.value === null || e.value === undefined || e.value === ('' as unknown) ? null : Number(e.value) }))
    .filter((e) => e.value === null || (Number.isFinite(e.value) && e.value >= 0))
  if (!clean.length) throw new HttpError(400, 'Nothing changed on the form')
  const cells = parseSheet(l.sheetXml, l.shared)
  const formulaCols = [l.model.columns.cases, l.model.columns.units, l.model.columns.total].filter((c): c is string => !!c)
  const { xml, changed } = applyEdits(l.sheetXml, cells, clean, l.model.formulaRow && formulaCols.length ? { fromRow: l.model.formulaRow, cols: formulaCols } : undefined)
  if (!changed.length) throw new HttpError(400, 'Nothing changed on the form')
  const after = readForm(parseSheet(xml, l.shared), l.vids.length ? [...new Set([...l.vids, ...l.model.rows.map((r) => r.model)])] : l.model.rows.map((r) => r.model))
  const changes = describeChanges(l.model, after)
  const newLines = formLines(after)
  if (!newLines.length) throw new HttpError(400, 'The form would have nothing on it. Put at least one item back, or cancel the order instead.')

  // the revised file, same workbook, only the numbers changed
  const files = { ...l.files, [l.sheetPath]: strToU8(xml) }
  if (files['xl/workbook.xml']) files['xl/workbook.xml'] = strToU8(forceRecalcOnOpen(strFromU8(files['xl/workbook.xml'])))
  delete files['xl/calcChain.xml']   // Excel rebuilds it; a stale one with a formula we put back would make it complain
  if (files['[Content_Types].xml']) files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml']).replace(/<Override\b[^>]*calcChain[^>]*\/>/, ''))
  if (files['xl/_rels/workbook.xml.rels']) files['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ''))
  const bytes = zipSync(files, { level: 6 })
  const on = today()
  const name = revisedFileName(l.link.file_name, on)
  const path = `${me.organization_id}/${l.order.vendor_id ?? 'orders'}/${crypto.randomUUID()}-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: XLSX_MIME, upsert: false })
  if (upErr) throw new Error(`Saving ${name}: ${upErr.message}`)
  const fileNote = `Our revised order, changed in VMS by ${me.full_name ?? me.email} on ${on.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}: ${changes.join('; ')}`
  const { data: newLink, error: linkErr } = await db.from('vendor_links').insert({
    organization_id: me.organization_id, vendor_id: l.order.vendor_id, order_id: orderId, kind: 'order', label: name.replace(/\.[a-z0-9]{2,5}$/i, ''),
    storage_path: path, file_name: name, file_size: bytes.byteLength, mime_type: XLSX_MIME, received_at: iso(on), doc_year: on.getFullYear(), doc_date: iso(on),
    source: 'manual', created_by: me.id, notes: fileNote,
  }).select('id').single()
  if (linkErr) throw new Error(linkErr.message)
  await db.from('vendor_links').update({ superseded_at: new Date().toISOString(), is_current: false }).eq('id', l.link.id)

  // the order's lines and total follow the form (lines from WWD invoices are never touched)
  await setLines(db, me.organization_id, orderId, newLines)
  await db.from('orders').update({ est_cost: after.total }).eq('id', orderId)

  // the reply, in the conversation the order went out in, for the person to send
  const { data: contact } = l.order.vendor_id && l.email.to_emails[0]
    ? await db.from('vendor_emails').select('contact_name').eq('vendor_id', l.order.vendor_id).ilike('email', l.email.to_emails[0]).maybeSingle()
    : { data: null }
  const first = contact?.contact_name?.trim().split(/\s+/)[0]
  const greeting = l.email.to_emails.length === 1 && first ? `Hi ${first},` : 'Hi,'
  const sentOn = longDate(l.email.received_at)
  const bodyLines = [
    greeting, '',
    `Here is our revised order (attached). The changes from the order we sent ${sentOn}:`,
    ...changes.map((c) => `• ${c}`),
    ...(note.trim() ? ['', note.trim()] : []),
    '',
    'Please confirm when you have it, and let us know if anything is out of stock.',
    '',
    'Thanks!',
  ]
  const subject = l.email.subject ? (/^re:/i.test(l.email.subject) ? l.email.subject : `Re: ${l.email.subject}`) : `Revised order${l.order.po_number ? ` - PO ${l.order.po_number}` : ''} - Shaver Lake Sports`
  const { data: draft, error: dErr } = await db.from('email_drafts').insert({
    organization_id: me.organization_id, owner_id: me.id, created_by: me.id, to_emails: l.email.to_emails, cc_emails: l.email.cc_emails, subject, body: bodyLines.join('\n'),
    thread_id: l.email.thread_id, reply_to_email_id: l.email.id, vendor_id: l.order.vendor_id, mailbox_id: l.email.mailbox_id, order_id: orderId, vendor_link_ids: [newLink.id],
    note: `Written by VMS from your changes to the order form (${name} is attached, the earlier copy is marked old on the order). Read it over and press Send.`,
  }).select('id').single()
  if (dErr) throw new Error(dErr.message)
  return { ok: true, draft_id: draft.id as string, link_id: newLink.id as string, file_name: name, changes, total: after.total }
}

/** The order's lines become the form's rows: a line per row with something on it, retail prices and notes kept where the item stays. */
async function setLines(db: SupabaseClient, org: string, orderId: string, wanted: ReturnType<typeof formLines>) {
  const { data: have } = await db.from('order_lines').select('id, vendor_item_id, description, sort_order, wwd_invoice_id').eq('order_id', orderId).order('sort_order')
  const mine = (have ?? []).filter((l) => !l.wwd_invoice_id)
  const free = new Set(mine.map((l) => l.id))
  const key = (vid: string | null, desc: string | null) => (vid ?? '').trim().toUpperCase() + '|' + (desc ?? '').trim().toUpperCase().slice(0, 30)
  const byKey = new Map<string, string[]>()
  const byVid = new Map<string, string[]>()
  for (const l of mine) {
    byKey.set(key(l.vendor_item_id, l.description), [...(byKey.get(key(l.vendor_item_id, l.description)) ?? []), l.id])
    const v = (l.vendor_item_id ?? '').trim().toUpperCase()
    if (v) byVid.set(v, [...(byVid.get(v) ?? []), l.id])
  }
  const take = (ids: string[] | undefined) => { const id = ids?.find((x) => free.has(x)); if (id) free.delete(id); return id ?? null }
  let i = 0
  for (const w of wanted) {
    const desc = w.colors ? `${w.description} (${w.colors})` : w.description
    const id = take(byKey.get(key(w.vendor_item_id, desc))) ?? take(byKey.get(key(w.vendor_item_id, w.description))) ?? take(byVid.get(w.vendor_item_id.toUpperCase()))
    const row = { vendor_item_id: w.vendor_item_id, description: desc, quantity: w.quantity, unit_cost: w.unit_cost ?? 0, extended: Math.round(w.quantity * (w.unit_cost ?? 0) * 100) / 100, sort_order: i++ }
    if (id) await db.from('order_lines').update(row).eq('id', id)
    else await db.from('order_lines').insert({ organization_id: org, order_id: orderId, ...row })
  }
  if (free.size) await db.from('order_lines').delete().in('id', [...free])
}
