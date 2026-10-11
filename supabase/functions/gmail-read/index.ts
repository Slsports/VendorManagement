// gmail-read: what VMS does not keep itself, fetched from Gmail (orders@, or a personal mailbox) when someone asks for it.
//   { action: 'html', email_id }                       → { html } the formatted message
//   { action: 'attachment', attachment_id }            → the file itself (download / open)
//   { action: 'trash' | 'untrash', thread_ids }        → Delete / Restore conversations (Gmail Trash)
//   { action: 'file', attachment_id, vendor_id, kind, doc_year } → copy it into the vendor's documents (folder by kind, year)
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { decodeBase64Url, type GmailMessage, type GmailPart } from '../_shared/mailParse.ts'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'

const KINDS = ['catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  try {
    const body = await req.json() as { action: string; email_id?: string; attachment_id?: string; vendor_id?: string; kind?: string; label?: string; doc_year?: number; thread_ids?: string[] }
    const me = await caller(req, db, ['file', 'trash', 'untrash'].includes(body.action))
    const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', me.organization_id).single()
    if (!acct) throw new HttpError(400, 'No mailbox connected')
    // Each email's ids live in the Gmail mailbox it came from (orders@, or someone's own: Dana, Oct 11).
    const clients = new Map<string, Gmail>()
    const gmailFor = async (box: string | null | undefined) => {
      const key = (box || acct.mailbox).toLowerCase()
      if (!clients.has(key)) clients.set(key, new Gmail(await googleAccessToken(key)))
      return clients.get(key)!
    }
    // Personal mail is for its owner and the admin, or everyone once shared to Orders.
    const boxes = new Map<string, { owner_id: string; gmail_box: string }>()
    const { data: mbx } = await db.from('mailboxes').select('id, owner_id, gmail_box').eq('organization_id', me.organization_id)
    for (const m of mbx ?? []) boxes.set(m.id, m)
    const mayOpen = async (mailboxId: string | null, threadId: string | null) => {
      if (!mailboxId || me.role === 'admin' || boxes.get(mailboxId)?.owner_id === me.id) return true
      if (!threadId) return false
      const { data: t } = await db.from('email_threads').select('shared_at').eq('id', threadId).maybeSingle()
      return !!t?.shared_at
    }

    // Delete / Restore (Dana, Oct 9): Gmail's Trash for orders@, and out of (or back into) VMS's lists.
    if (body.action === 'trash' || body.action === 'untrash') {
      const ids = (body.thread_ids ?? []).slice(0, 200)
      const { data: threads } = await db.from('email_threads').select('id, gmail_thread_id, mailbox_id').eq('organization_id', me.organization_id).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      const done: string[] = []
      for (const t of threads ?? []) {
        if (!(await mayOpen(t.mailbox_id, t.id))) continue
        const gmail = await gmailFor(t.mailbox_id ? boxes.get(t.mailbox_id)?.gmail_box : null)
        await gmail.call(`threads/${t.gmail_thread_id}/${body.action}`, { method: 'POST' })
        done.push(t.id)
      }
      const { error } = await db.rpc('mark_threads_deleted', { p_threads: done, p_by: me.id, p_deleted: body.action === 'trash' })
      if (error) throw new Error(error.message)
      return json({ count: done.length })
    }

    if (body.action === 'html') {
      const { data: e } = await db.from('emails').select('gmail_id, organization_id, gmail_box, mailbox_id, thread_id').eq('id', body.email_id ?? '').single()
      if (!e || e.organization_id !== me.organization_id || !(await mayOpen(e.mailbox_id, e.thread_id))) throw new HttpError(404, 'Email not found')
      const gmail = await gmailFor(e.gmail_box)
      const m = await gmail.message(e.gmail_id, 'full') as unknown as GmailMessage
      let html = ''
      const walk = (p?: GmailPart) => {
        if (!p || html) return
        if ((p.mimeType ?? '').toLowerCase() === 'text/html' && p.body?.data && !p.filename) html = decodeBase64Url(p.body.data, 3_000_000)
        for (const c of p.parts ?? []) walk(c)
      }
      walk(m.payload)
      // Pictures pasted into the message (Dana, Oct 9: "no idea what image goes to what price") are cid:
      // references to inline parts; put each picture back where it sits in the message.
      const inline = new Map<string, GmailPart>()
      const collect = (p?: GmailPart) => {
        if (!p) return
        const cid = p.headers?.find((h) => h.name.toLowerCase() === 'content-id')?.value?.replace(/^<|>$/g, '').trim()
        if (cid && /^image\//i.test(p.mimeType ?? '')) inline.set(cid.toLowerCase(), p)
        for (const c of p.parts ?? []) collect(c)
      }
      collect(m.payload)
      let budget = 20_000_000
      for (const ref of new Set([...html.matchAll(/cid:([^"'\s)>]+)/gi)].map((x) => x[1]!))) {
        const part = inline.get(decodeURIComponent(ref).toLowerCase())
        if (!part) continue
        let data = part.body?.data
        if (!data && part.body?.attachmentId) data = (await gmail.call<{ data: string }>(`messages/${e.gmail_id}/attachments/${part.body.attachmentId}`)).data
        if (!data || data.length > budget) continue
        budget -= data.length
        const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
        html = html.split(`cid:${ref}`).join(`data:${part.mimeType};base64,${b64}`)
      }
      return json({ html })
    }

    const { data: a } = await db.from('email_attachments').select('id, organization_id, file_name, mime_type, gmail_attachment_id, storage_path, email_id, email:emails(gmail_id, gmail_box, mailbox_id, thread_id)').eq('id', body.attachment_id ?? '').single()
    if (!a || a.organization_id !== me.organization_id) throw new HttpError(404, 'Attachment not found')
    const em = a.email as unknown as { gmail_id: string; gmail_box: string | null; mailbox_id: string | null; thread_id: string } | null
    if (em && !(await mayOpen(em.mailbox_id, em.thread_id))) throw new HttpError(404, 'Attachment not found')
    const gmailId = em?.gmail_id
    if (!a.gmail_attachment_id || !gmailId) throw new HttpError(404, 'This attachment is not available from Gmail')
    const gmail = await gmailFor(em?.gmail_box)
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
