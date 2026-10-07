// gmail-send: send from orders@ as the signed-in person (docs/gmail-connection.md). New email, reply,
// reply all, forward and follow-up all come through here. The message carries the sender's name and
// signature, threads with the conversation, is saved to VMS at once (filed to the vendor), and makes the
// sender the thread's owner; the thread then waits on the vendor until they answer.
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress, withSignature, type MimeAttachment } from '../_shared/mime.ts'
import { parseMessage, type GmailMessage } from '../_shared/mailParse.ts'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'

interface SendRequest {
  thread_id?: string | null          // VMS thread to reply in
  reply_to_email_id?: string | null  // the message being answered (threading headers)
  forward_email_id?: string | null   // forward: carry this message's attachments
  vendor_id?: string | null          // file a new conversation to this vendor
  to: string[]
  cc?: string[]
  subject: string
  body: string
  attachments?: MimeAttachment[]     // from the computer, base64
  vendor_link_ids?: string[]         // files from the vendor's Links & files
}

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  try {
    const me = await caller(req, db, true)
    const r = (await req.json()) as SendRequest
    const to = (r.to ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean)
    const cc = (r.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean)
    if (!to.length) throw new HttpError(400, 'Who is it to?')
    const bad = [...to, ...cc].find((a) => !EMAIL.test(a))
    if (bad) throw new HttpError(400, `"${bad}" does not look like an email address`)
    if (!r.subject?.trim()) throw new HttpError(400, 'Add a subject')

    const { data: acct } = await db.from('mail_accounts').select('mailbox').eq('organization_id', me.organization_id).single()
    if (!acct) throw new HttpError(400, 'No mailbox connected')
    const { data: org } = await db.from('organizations').select('name, app_name').eq('id', me.organization_id).single()
    const mailbox = acct.mailbox as string

    // The conversation and the message being answered.
    let thread: { id: string; gmail_thread_id: string; vendor_id: string | null } | null = null
    if (r.thread_id) {
      const { data } = await db.from('email_threads').select('id, gmail_thread_id, vendor_id, organization_id').eq('id', r.thread_id).single()
      if (!data || data.organization_id !== me.organization_id) throw new HttpError(404, 'Conversation not found')
      thread = data
    }
    let inReplyTo: string | null = null
    let references: string | null = null
    if (r.reply_to_email_id) {
      const { data } = await db.from('emails').select('message_id_header, in_reply_to, organization_id').eq('id', r.reply_to_email_id).single()
      if (data?.organization_id === me.organization_id) { inReplyTo = data.message_id_header; references = data.in_reply_to }
    }

    const gmail = new Gmail(await googleAccessToken(mailbox))
    const attachments: MimeAttachment[] = [...(r.attachments ?? [])]
    if (r.vendor_link_ids?.length) {
      const { data: links } = await db.from('vendor_links').select('id, storage_path, file_name, mime_type, organization_id').in('id', r.vendor_link_ids)
      for (const l of links ?? []) {
        if (l.organization_id !== me.organization_id || !l.storage_path) continue
        const { data: blob, error } = await db.storage.from('vendor-files').download(l.storage_path)
        if (error || !blob) throw new Error(`Could not read ${l.file_name}: ${error?.message ?? 'missing'}`)
        attachments.push({ name: l.file_name ?? 'file', mime: l.mime_type ?? blob.type ?? 'application/octet-stream', base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) })
      }
    }
    if (r.forward_email_id) {
      const { data: e } = await db.from('emails').select('gmail_id, organization_id, attachments:email_attachments(file_name, mime_type, gmail_attachment_id)').eq('id', r.forward_email_id).single()
      if (e?.organization_id === me.organization_id) {
        for (const a of (e.attachments ?? []) as { file_name: string; mime_type: string | null; gmail_attachment_id: string | null }[]) {
          if (!a.gmail_attachment_id) continue
          const part = await gmail.call<{ data: string }>(`messages/${e.gmail_id}/attachments/${a.gmail_attachment_id}`)
          attachments.push({ name: a.file_name, mime: a.mime_type ?? 'application/octet-stream', base64: part.data.replace(/-/g, '+').replace(/_/g, '/') })
        }
      }
    }

    const brand = (org?.app_name || org?.name || '').trim()
    const fromName = [me.full_name, brand].filter(Boolean).join(' | ')
    const text = withSignature(r.body ?? '', me.email_signature)
    const raw = buildMime({ from: formatAddress(fromName, mailbox), to, cc, replyTo: mailbox, subject: r.subject.trim(), text, inReplyTo, references, attachments })

    const sent = await gmail.send(raw, thread?.gmail_thread_id)

    // Save it in VMS now, the same way the sync would.
    const full = parseMessage(await gmail.message(sent.id, 'full') as unknown as GmailMessage)
    const { data: th } = await db.from('email_threads').upsert({ organization_id: me.organization_id, gmail_thread_id: sent.threadId }, { onConflict: 'organization_id,gmail_thread_id', ignoreDuplicates: false }).select('id, vendor_id').single()
    if (!th) throw new Error('Could not save the conversation')
    const vendorId = r.vendor_id ?? thread?.vendor_id ?? th.vendor_id ?? null
    const domain = to[0]!.split('@')[1]!
    const free = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'live.com', 'msn.com', 'me.com'].includes(domain)
    await db.from('email_senders').upsert({ organization_id: me.organization_id, sender_key: free ? to[0] : domain, is_domain: !free }, { onConflict: 'organization_id,sender_key', ignoreDuplicates: true })
    const { data: sender } = await db.from('email_senders').select('id').eq('organization_id', me.organization_id).eq('sender_key', free ? to[0] : domain).single()
    const { data: email, error: insErr } = await db.from('emails').insert({
      organization_id: me.organization_id, gmail_id: sent.id, thread_id: th.id, message_id_header: full.message_id_header, in_reply_to: inReplyTo,
      direction: 'out', from_email: mailbox, from_name: fromName, to_emails: to, cc_emails: cc, subject: r.subject.trim(),
      snippet: text.replace(/\s+/g, ' ').slice(0, 200), body_text: text.slice(0, 20_000), received_at: full.received_at,
      labels: ['SENT'], has_attachments: attachments.length > 0, sender_id: sender?.id ?? null, vendor_id: vendorId, match_how: vendorId ? 'manual' : null, sent_by: me.id,
    }).select('id').single()
    if (insErr || !email) throw new Error(`Sent, but saving it in VMS failed: ${insErr?.message}`)
    if (full.attachments.length) await db.from('email_attachments').insert(full.attachments.map((a) => ({ ...a, organization_id: me.organization_id, email_id: email.id })))
    await db.from('email_threads').update({ vendor_id: vendorId ?? undefined, owner_id: me.id, owner_set_at: new Date().toISOString() }).eq('id', th.id)
    await db.rpc('mail_process', { p_org: me.organization_id, p_email_ids: [email.id], p_backfill: false })
    return json({ thread_id: th.id, email_id: email.id })
  } catch (e) {
    return errorResponse(e)
  }
})

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
