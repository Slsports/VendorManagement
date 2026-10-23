// gmail-send: send from orders@ (or the person's own mailbox, Dana Oct 11) as the signed-in person (docs/gmail-connection.md). New email, reply,
// reply all, forward and follow-up all come through here. The message carries the sender's name and
// signature, threads with the conversation, is saved to VMS at once (filed to the vendor), and makes the
// sender the thread's owner; the thread then waits on the vendor until they answer.
// The signature (the template with the logo, Oct 13) goes above any quoted mail. Vendor business going out of a personal
// inbox stops once with a choice: send it from orders@ instead, or from my inbox anyway (Dana, Oct 13).
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { buildMime, formatAddress, type MimeAttachment } from '../_shared/mime.ts'
import { fillSignature, htmlEmail, textEmail } from '../_shared/signature.ts'
import { aiEnabled, readVendorBusiness } from '../_shared/ai.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
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
  mailbox_id?: string | null         // a new email from my own mailbox instead of orders@
  draft_id?: string | null           // sent from Mail › Drafts: the draft (and its Gmail copy) goes away
  signature?: string | null          // as shown (and maybe changed) in the compose window; left out = the person's usual one
  vendor_check?: 'ask' | 'skip' | 'orders' // from a personal inbox: ask first (default), send anyway, or send from orders@ instead
  routing_send_id?: string | null    // a routing letter email (Dana, Oct 13): the letter is attached and the send is stamped
  attach_routing_letter?: boolean    // attach the current routing letter to any email
  confirmation_id?: string | null    // a "please confirm your contact info" email (Oct 13): stamped as sent
  availability_ask_id?: string | null // "can we still order these?" to a rep (Oct 21): the reply is read by Claude
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
    const { data: org } = await db.from('organizations').select('name, app_name, signature_template').eq('id', me.organization_id).single()
    // The conversation and the message being answered.
    let thread: { id: string; gmail_thread_id: string; vendor_id: string | null; mailbox_id: string | null } | null = null
    if (r.thread_id) {
      const { data } = await db.from('email_threads').select('id, gmail_thread_id, vendor_id, organization_id, mailbox_id').eq('id', r.thread_id).single()
      if (!data || data.organization_id !== me.organization_id) throw new HttpError(404, 'Conversation not found')
      thread = data
    }
    // Which mailbox it goes from: the conversation's, or the one picked for a new email. A personal mailbox sends
    // as its owner only; the old Gmail answers from orders@ (its mail arrives there).
    const boxId = thread ? thread.mailbox_id : r.mailbox_id ?? null
    let box: { id: string; kind: string; address: string; owner_id: string; gmail_box: string } | null = null
    if (boxId) {
      const { data } = await db.from('mailboxes').select('id, kind, address, owner_id, gmail_box, organization_id').eq('id', boxId).single()
      if (!data || data.organization_id !== me.organization_id) throw new HttpError(404, 'Mailbox not found')
      if (data.kind === 'personal' && data.owner_id !== me.id) throw new HttpError(403, 'Only the owner of this mailbox can send from it. Share the conversation to Orders to answer from orders@.')
      if (data.kind === 'accounting') {
        const { data: p } = await db.from('profiles').select('sees_accounting').eq('id', me.id).maybeSingle()
        if (!p?.sees_accounting) throw new HttpError(403, 'Only people with the Accounting tick send from this mailbox')
      }
      if (data.kind === 'legacy' && me.role !== 'admin' && data.owner_id !== me.id) throw new HttpError(403, 'Only Dana answers the old Gmail')
      box = data
    }
    // Vendor business from a personal inbox: ask once; "Send from orders@ instead" starts a new conversation in orders@.
    let boxIdSaved = boxId
    let gmailThread = thread?.gmail_thread_id
    if (box?.kind === 'personal' || box?.kind === 'accounting') {
      const check = r.vendor_check ?? 'ask'
      if (check === 'ask') {
        const reason = await vendorBusiness(db, me.organization_id, acct.mailbox as string, to, cc, r.subject.trim(), r.body ?? '')
        if (reason) return json({ needs_choice: true, reason })
      } else if (check === 'orders') {
        box = null
        boxIdSaved = null
        gmailThread = undefined
      }
    }
    const mailbox = (box && box.kind !== 'legacy' ? box.address : acct.mailbox) as string
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
    // The freight routing letter (Dana, Oct 13): the version this send is for, or the current one.
    let routingSend: { id: string; letter_id: string } | null = null
    if (r.routing_send_id || r.attach_routing_letter) {
      let letter: { storage_path: string; file_name: string; organization_id: string } | null = null
      if (r.routing_send_id) {
        const { data: rs } = await db.from('routing_letter_sends').select('id, letter_id, organization_id, letter:routing_letters!routing_letter_sends_letter_id_fkey(storage_path, file_name, organization_id)').eq('id', r.routing_send_id).maybeSingle()
        if (!rs || rs.organization_id !== me.organization_id) throw new HttpError(404, 'Routing letter send not found')
        routingSend = { id: rs.id, letter_id: rs.letter_id }
        letter = rs.letter as unknown as typeof letter
      } else {
        const { data } = await db.from('routing_letters').select('storage_path, file_name, organization_id').eq('organization_id', me.organization_id).order('version', { ascending: false }).limit(1).maybeSingle()
        letter = data
      }
      if (!letter) throw new HttpError(400, 'No routing letter uploaded yet (Freight › Routing letter)')
      const { data: blob, error } = await db.storage.from('vendor-files').download(letter.storage_path)
      if (error || !blob) throw new Error(`Could not read the routing letter: ${error?.message ?? 'missing'}`)
      attachments.push({ name: letter.file_name, mime: 'application/pdf', base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) })
    }
    if (r.forward_email_id) {
      const { data: e } = await db.from('emails').select('gmail_id, gmail_box, organization_id, attachments:email_attachments(file_name, mime_type, gmail_attachment_id)').eq('id', r.forward_email_id).single()
      if (e?.organization_id === me.organization_id) {
        const from = e.gmail_box && e.gmail_box !== mailbox ? new Gmail(await googleAccessToken(e.gmail_box)) : gmail
        for (const a of (e.attachments ?? []) as { file_name: string; mime_type: string | null; gmail_attachment_id: string | null }[]) {
          if (!a.gmail_attachment_id) continue
          const part = await from.call<{ data: string }>(`messages/${e.gmail_id}/attachments/${a.gmail_attachment_id}`)
          attachments.push({ name: a.file_name, mime: a.mime_type ?? 'application/octet-stream', base64: part.data.replace(/-/g, '+').replace(/_/g, '/') })
        }
      }
    }

    const brand = (org?.app_name || org?.name || '').trim()
    const fromName = [me.full_name, brand].filter(Boolean).join(' | ')
    const signature = r.signature !== undefined ? r.signature
      : fillSignature(org?.signature_template ?? null, { name: me.signature_name || me.full_name, title: me.job_title, direct: me.direct_phone, own: me.email_signature })
    const text = textEmail(r.body ?? '', signature)
    const html = signature?.trim() ? htmlEmail(r.body ?? '', signature) : null
    const raw = buildMime({ from: formatAddress(fromName, mailbox), to, cc, replyTo: mailbox, subject: r.subject.trim(), text, html, inReplyTo, references, attachments })

    const sent = await gmail.send(raw, gmailThread)

    // Save it in VMS now, the same way the sync would.
    const full = parseMessage(await gmail.message(sent.id, 'full') as unknown as GmailMessage)
    const { data: th } = await db.from('email_threads').upsert({ organization_id: me.organization_id, gmail_thread_id: sent.threadId, mailbox_id: boxIdSaved }, { onConflict: 'organization_id,gmail_thread_id', ignoreDuplicates: false }).select('id, vendor_id').single()
    if (!th) throw new Error('Could not save the conversation')
    const vendorId = r.vendor_id ?? thread?.vendor_id ?? th.vendor_id ?? null
    const domain = to[0]!.split('@')[1]!
    const free = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'live.com', 'msn.com', 'me.com'].includes(domain)
    // private mail uses the senders VMS knows and adds none (no "who is this?" cards from it)
    if (!boxIdSaved) await db.from('email_senders').upsert({ organization_id: me.organization_id, sender_key: free ? to[0] : domain, is_domain: !free }, { onConflict: 'organization_id,sender_key', ignoreDuplicates: true })
    const { data: sender } = await db.from('email_senders').select('id').eq('organization_id', me.organization_id).eq('sender_key', free ? to[0] : domain).maybeSingle()
    const { data: email, error: insErr } = await db.from('emails').insert({
      organization_id: me.organization_id, mailbox_id: boxIdSaved, gmail_box: mailbox.toLowerCase(), gmail_id: sent.id, thread_id: th.id, message_id_header: full.message_id_header, in_reply_to: inReplyTo,
      direction: 'out', from_email: mailbox, from_name: fromName, to_emails: to, cc_emails: cc, subject: r.subject.trim(),
      snippet: text.replace(/\s+/g, ' ').slice(0, 200), body_text: text.slice(0, 20_000), received_at: full.received_at,
      labels: ['SENT'], has_attachments: attachments.length > 0, sender_id: sender?.id ?? null, vendor_id: vendorId, match_how: vendorId ? 'manual' : null, sent_by: me.id,
    }).select('id').single()
    if (insErr || !email) throw new Error(`Sent, but saving it in VMS failed: ${insErr?.message}`)
    if (full.attachments.length) await db.from('email_attachments').insert(full.attachments.map((a) => ({ ...a, organization_id: me.organization_id, email_id: email.id })))
    await db.from('email_threads').update({ vendor_id: vendorId ?? undefined, owner_id: me.id, owner_set_at: new Date().toISOString() }).eq('id', th.id)
    await db.rpc('mail_process', { p_org: me.organization_id, p_email_ids: [email.id], p_backfill: false })
    if (routingSend) await db.rpc('routing_letter_mark_sent', { p_send: routingSend.id, p_email: email.id, p_by: me.id })
    if (r.confirmation_id) {
      const { data: vc } = await db.from('vendor_confirmations').select('id, organization_id').eq('id', r.confirmation_id).maybeSingle()
      if (vc?.organization_id === me.organization_id) await db.rpc('vendor_confirm_mark_sent', { p_id: vc.id, p_email: email.id, p_by: me.id })
    }
    if (r.availability_ask_id) {
      const { data: ask } = await db.from('availability_asks').select('id, organization_id').eq('id', r.availability_ask_id).maybeSingle()
      if (ask?.organization_id === me.organization_id) await db.rpc('availability_ask_sent', { p_ask: ask.id, p_email: email.id })
    }
    if (r.draft_id) {
      const { data: d } = await db.from('email_drafts').select('id, owner_id, organization_id, gmail_draft_id, order_id').eq('id', r.draft_id).maybeSingle()
      // the shipping email (Dana, Oct 20): stamped on its order
      if (d?.order_id && d.organization_id === me.organization_id) await db.rpc('order_ship_email_sent', { p_order: d.order_id, p_email: email.id })
      // a task's email (VMS: notes, Dana Oct 23): sending it ticks the task done and VMS watches for the vendor's answer
      if (d && d.organization_id === me.organization_id) await db.rpc('mail_command_sent', { p_draft: d.id, p_email: email.id, p_by: me.id })
      if (d && d.organization_id === me.organization_id && (d.owner_id === me.id || me.role === 'admin')) {
        // Claude's Gmail copies sit in orders@ Drafts
        const drafts = mailbox === acct.mailbox ? gmail : new Gmail(await googleAccessToken(acct.mailbox as string))
        if (d.gmail_draft_id) await drafts.call(`drafts/${d.gmail_draft_id}`, { method: 'DELETE' }).catch(() => undefined)
        await db.from('email_drafts').delete().eq('id', d.id)
      }
    }
    return json({ thread_id: th.id, email_id: email.id })
  } catch (e) {
    return errorResponse(e)
  }
})

const KIND_WORDS: Record<string, string> = { order: 'an order', return: 'a vendor return', issue: 'a problem with an order', vendor: 'vendor business' }

/**
 * Why this email should go from orders@, or null. Anyone it goes to that VMS knows as a vendor, rep, ordering service or
 * carrier makes it vendor business; otherwise Claude reads it (order, return, issue). Mail only to our own people never asks.
 */
async function vendorBusiness(db: SupabaseClient, org: string, orders: string, to: string[], cc: string[], subject: string, body: string): Promise<string | null> {
  const ours = orders.split('@')[1]!.toLowerCase()
  const outside = [...to, ...cc].filter((a) => a.split('@')[1] !== ours)
  if (!outside.length) return null
  const domains = [...new Set(outside.map((a) => a.split('@')[1]!))]
  const [{ data: senders }, { data: contacts }, { data: repContacts }] = await Promise.all([
    db.from('email_senders').select('sender_key, is_domain, kind, vendor_id, rep_group_id').eq('organization_id', org)
      .in('sender_key', [...outside, ...domains]).in('kind', ['vendor', 'rep_group', 'platform', 'carrier']),
    db.from('vendor_emails').select('vendor_id').in('email', outside),
    db.from('rep_group_contacts').select('rep_group_id').in('email', outside),
  ])
  const hits = (senders ?? []).filter((s) => (s.is_domain ? domains : outside).includes(s.sender_key))
  const vendorIds = [...new Set([...hits.map((s) => s.vendor_id), ...(contacts ?? []).map((c) => c.vendor_id)].filter(Boolean))] as string[]
  const repIds = [...new Set([...hits.map((s) => s.rep_group_id), ...(repContacts ?? []).map((c) => c.rep_group_id)].filter(Boolean))] as string[]
  if (vendorIds.length) {
    const { data: v } = await db.from('vendors').select('name').eq('organization_id', org).in('id', vendorIds).limit(1)
    if (v?.[0]) return `This is going to ${v[0].name}. Vendor business should go from orders@ so everyone can follow it.`
  }
  if (repIds.length) {
    const { data: g } = await db.from('rep_groups').select('name').eq('organization_id', org).in('id', repIds).limit(1)
    if (g?.[0]) return `This is going to ${g[0].name}, a rep group. Vendor business should go from orders@ so everyone can follow it.`
  }
  if (hits.length) return 'This is going to a company we do business with. Vendor business should go from orders@ so everyone can follow it.'
  if (!aiEnabled()) return null
  const kind = await readVendorBusiness(db, org, { to: outside, subject, text: body.split(/\n(?=On .{4,200}wrote:\s*$)/m)[0]! }).catch(() => 'other' as const)
  return kind === 'other' ? null : `This looks like ${KIND_WORDS[kind]}. It should go from orders@ so everyone can follow it.`
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
