// billcom-forward: send one vendor invoice email, with its attachments, to Bill.com's inbox (Dana, Oct 19). Queued by the
// database the moment Claude files an invoice from an email for a vendor whose "Send invoices to Bill.com" switch is on;
// sent from the mailbox the email came to (orders@ or billing@). One forward per email. VMS never enters or pays anything.
//   { forward_id }  with the scheduler's secret (the database), or from an admin ("Send again")
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress, type MimeAttachment } from '../_shared/mime.ts'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  try {
    const body = await req.json().catch(() => ({})) as { forward_id?: string }
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    let org: string | null = null
    if (!trusted) {
      const me = await caller(req, db)
      if (me.role !== 'admin') throw new HttpError(403, 'Only the admin sends again')
      org = me.organization_id
    }
    const id = String(body.forward_id ?? '')
    if (!id) throw new HttpError(400, 'Which forward?')
    const { data: f } = await db.from('billcom_forwards').select('*').eq('id', id).maybeSingle()
    if (!f || (org && f.organization_id !== org)) throw new HttpError(404, 'Forward not found')
    if (f.status === 'sent') return json({ status: 'sent', already: true })
    return json(await send(db, f))
  } catch (e) {
    return errorResponse(e)
  }
})

async function send(db: SupabaseClient, f: { id: string; organization_id: string; email_id: string | null; vendor_link_id: string | null; vendor_id: string | null }) {
  const fail = async (status: 'failed' | 'skipped', error: string) => {
    await db.from('billcom_forwards').update({ status, error: error.slice(0, 500) }).eq('id', f.id)
    return { status, error }
  }
  try {
    // the switch may have been turned off since
    if (f.vendor_id) {
      const { data: v } = await db.from('vendors').select('billcom_send, name').eq('id', f.vendor_id).maybeSingle()
      if (!v?.billcom_send) return fail('skipped', `${v?.name ?? 'The vendor'} no longer sends invoices to Bill.com`)
    }
    if (!f.email_id) return await sendUpload(db, f, fail)
    const { data: e } = await db.from('emails').select('id, organization_id, gmail_id, gmail_box, subject, body_text, from_name, from_email, received_at, billcom_sent_at, attachments:email_attachments(file_name, mime_type, gmail_attachment_id)').eq('id', f.email_id).maybeSingle()
    if (!e) return fail('failed', 'The email is gone')
    if (e.billcom_sent_at) { await db.from('billcom_forwards').update({ status: 'sent', sent_at: e.billcom_sent_at }).eq('id', f.id); return { status: 'sent', already: true } }
    const { data: c } = await db.from('billcom_connections').select('inbox_address').eq('organization_id', e.organization_id).maybeSingle()
    const inbox = (c?.inbox_address ?? 'shaverlakesports1@bill.com').toLowerCase()
    const box = String(e.gmail_box ?? '').toLowerCase()
    if (!box) return fail('failed', 'VMS does not know which mailbox the email came to')
    const gmail = new Gmail(await googleAccessToken(box))
    const attachments: MimeAttachment[] = []
    for (const a of (e.attachments ?? []) as { file_name: string; mime_type: string | null; gmail_attachment_id: string | null }[]) {
      if (!a.gmail_attachment_id) continue
      const part = await gmail.call<{ data: string }>(`messages/${e.gmail_id}/attachments/${a.gmail_attachment_id}`)
      attachments.push({ name: a.file_name, mime: a.mime_type ?? 'application/octet-stream', base64: part.data.replace(/-/g, '+').replace(/_/g, '/') })
    }
    if (!attachments.length) return fail('failed', 'The email has no attachment to send')
    const { data: org } = await db.from('organizations').select('name, app_name').eq('id', e.organization_id).maybeSingle()
    const subject = /^\s*fwd?:/i.test(e.subject ?? '') ? (e.subject ?? '').trim() : `Fwd: ${(e.subject ?? '').trim() || 'Invoice'}`
    const when = e.received_at ? new Date(e.received_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : ''
    const text = [
      'Vendor invoice forwarded to Bill.com by VMS.', '',
      '---------- Forwarded message ----------',
      `From: ${[e.from_name, e.from_email ? `<${e.from_email}>` : ''].filter(Boolean).join(' ')}`,
      `Date: ${when}`, `Subject: ${e.subject ?? ''}`, '', (e.body_text ?? '').slice(0, 20000),
    ].join('\n')
    const raw = buildMime({ from: formatAddress(org?.app_name || org?.name || 'Shaver Lake Sports', box), to: [inbox], subject, text, attachments, headers: { 'X-VMS-Notice': 'billcom-forward' } })
    const sent = await gmail.send(raw)
    const now = new Date().toISOString()
    await db.from('billcom_forwards').update({ status: 'sent', sent_to: inbox, gmail_id: sent.id, sent_at: now, error: null }).eq('id', f.id)
    await db.from('emails').update({ billcom_sent_at: now }).eq('id', e.id)
    return { status: 'sent', to: inbox, attachments: attachments.length }
  } catch (err) {
    return fail('failed', err instanceof Error ? err.message : String(err))
  }
}

/**
 * An invoice scanned into Invoice Uploads (Dana, Oct 20): no email to forward, so the file itself goes from orders@ to
 * Bill.com's inbox, once. The upload shows "Sent to Bill.com".
 */
async function sendUpload(db: SupabaseClient, f: { id: string; organization_id: string; vendor_link_id: string | null }, fail: (s: 'failed' | 'skipped', e: string) => Promise<{ status: string; error: string }>) {
  if (!f.vendor_link_id) return fail('failed', 'The file is gone')
  const { data: l } = await db.from('vendor_links').select('id, storage_path, file_name, doc_number, doc_date, doc_total, store_code, notes, vendor:vendors!vendor_links_vendor_id_fkey(name)').eq('id', f.vendor_link_id).maybeSingle()
  if (!l?.storage_path) return fail('failed', 'The file is gone')
  const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', f.organization_id).maybeSingle()
  const box = String(acct?.mailbox ?? '').toLowerCase()
  if (!box) return fail('failed', 'No mailbox connected')
  const { data: c } = await db.from('billcom_connections').select('inbox_address').eq('organization_id', f.organization_id).maybeSingle()
  const inbox = (c?.inbox_address ?? 'shaverlakesports1@bill.com').toLowerCase()
  const { data: blob, error } = await db.storage.from('vendor-files').download(l.storage_path)
  if (error || !blob) return fail('failed', `Could not open the file: ${error?.message ?? 'missing'}`)
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  const vendor = (l.vendor as unknown as { name: string } | null)?.name ?? 'Vendor'
  const { data: org } = await db.from('organizations').select('name, app_name').eq('id', f.organization_id).maybeSingle()
  const subject = `Invoice${l.doc_number ? ` ${l.doc_number}` : ''} – ${vendor}${l.store_code ? ` (${l.store_code})` : ''}`
  const text = [
    'Vendor invoice scanned into VMS, forwarded to Bill.com by VMS.', '',
    `Vendor: ${vendor}`, l.doc_number ? `Invoice: ${l.doc_number}` : null, l.doc_date ? `Date: ${l.doc_date}` : null,
    l.doc_total != null ? `Total: $${Number(l.doc_total).toFixed(2)}` : null, l.store_code ? `Store: ${l.store_code}` : null, l.notes ?? null,
  ].filter((x) => x !== null).join('\n')
  const gmail = new Gmail(await googleAccessToken(box))
  const raw = buildMime({ from: formatAddress(org?.app_name || org?.name || 'Shaver Lake Sports', box), to: [inbox], subject, text,
    attachments: [{ name: l.file_name ?? 'invoice.pdf', mime: 'application/pdf', base64: btoa(bin) }], headers: { 'X-VMS-Notice': 'billcom-forward' } })
  const sent = await gmail.send(raw)
  const now = new Date().toISOString()
  await db.from('billcom_forwards').update({ status: 'sent', sent_to: inbox, gmail_id: sent.id, sent_at: now, error: null }).eq('id', f.id)
  await db.from('invoice_upload_docs').update({ billcom_sent_at: now }).eq('vendor_link_id', l.id)
  return { status: 'sent', to: inbox, attachments: 1 }
}
