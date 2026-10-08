// gmail-read: what VMS does not keep itself, fetched from orders@ when someone asks for it.
//   { action: 'html', email_id }                       → { html } the formatted message
//   { action: 'attachment', attachment_id }            → the file itself (download / open)
//   { action: 'file', attachment_id, vendor_id, kind, doc_year } → copy it into the vendor's documents (folder by kind, year)
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { decodeBase64Url, type GmailMessage, type GmailPart } from '../_shared/mailParse.ts'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'

const KINDS = ['catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  try {
    const body = await req.json() as { action: string; email_id?: string; attachment_id?: string; vendor_id?: string; kind?: string; label?: string; doc_year?: number }
    const me = await caller(req, db, body.action === 'file')
    const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', me.organization_id).single()
    if (!acct) throw new HttpError(400, 'No mailbox connected')
    const gmail = new Gmail(await googleAccessToken(acct.mailbox))

    if (body.action === 'html') {
      const { data: e } = await db.from('emails').select('gmail_id, organization_id').eq('id', body.email_id ?? '').single()
      if (!e || e.organization_id !== me.organization_id) throw new HttpError(404, 'Email not found')
      const m = await gmail.message(e.gmail_id, 'full') as unknown as GmailMessage
      let html = ''
      const walk = (p?: GmailPart) => {
        if (!p || html) return
        if ((p.mimeType ?? '').toLowerCase() === 'text/html' && p.body?.data && !p.filename) html = decodeBase64Url(p.body.data, 3_000_000)
        for (const c of p.parts ?? []) walk(c)
      }
      walk(m.payload)
      return json({ html })
    }

    const { data: a } = await db.from('email_attachments').select('id, organization_id, file_name, mime_type, gmail_attachment_id, storage_path, email_id, email:emails(gmail_id)').eq('id', body.attachment_id ?? '').single()
    if (!a || a.organization_id !== me.organization_id) throw new HttpError(404, 'Attachment not found')
    const gmailId = (a.email as unknown as { gmail_id: string } | null)?.gmail_id
    if (!a.gmail_attachment_id || !gmailId) throw new HttpError(404, 'This attachment is not available from Gmail')
    const part = await gmail.call<{ data: string }>(`messages/${gmailId}/attachments/${a.gmail_attachment_id}`)
    const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    if (body.action === 'attachment') {
      return new Response(bytes, { headers: { ...CORS, 'Content-Type': a.mime_type || 'application/octet-stream', 'Content-Disposition': `inline; filename="${a.file_name.replace(/["\r\n]/g, '_')}"` } })
    }

    if (body.action === 'file') {
      const { data: v } = await db.from('vendors').select('id, organization_id').eq('id', body.vendor_id ?? '').single()
      if (!v || v.organization_id !== me.organization_id) throw new HttpError(404, 'Vendor not found')
      const kind = KINDS.includes(body.kind ?? '') ? body.kind! : 'other'
      const safe = a.file_name.replace(/[^A-Za-z0-9._-]+/g, '_')
      const path = `${me.organization_id}/${v.id}/${crypto.randomUUID()}-${safe}`
      const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: a.mime_type ?? 'application/octet-stream', upsert: false })
      if (upErr) throw new Error(`Saving the file failed: ${upErr.message}`)
      const { data: link, error: linkErr } = await db.from('vendor_links').insert({
        organization_id: me.organization_id, vendor_id: v.id, kind, label: (body.label ?? '').trim() || a.file_name, storage_path: path, file_name: a.file_name,
        file_size: bytes.length, mime_type: a.mime_type, received_at: new Date().toISOString().slice(0, 10), source: 'email', email_id: a.email_id, created_by: me.id,
        doc_year: Number.isInteger(body.doc_year) && body.doc_year! >= 1990 && body.doc_year! <= 2100 ? body.doc_year : null,
      }).select('id').single()
      if (linkErr || !link) throw new Error(`Saving the file failed: ${linkErr?.message}`)
      await db.from('email_attachments').update({ storage_path: path, vendor_link_id: link.id }).eq('id', a.id)
      return json({ vendor_link_id: link.id })
    }
    throw new HttpError(400, 'Unknown action')
  } catch (e) {
    return errorResponse(e)
  }
})
