// Turn a Gmail API message (format=full) into what VMS stores, and pick out the text that carries
// vendor clues. Pure functions, shared by gmail-sync (Deno) and the unit tests (vitest).

export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}
export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}
export interface Address { email: string; name: string | null }
export interface ParsedAttachment { file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; part_id: string | null }
export interface ParsedMessage {
  gmail_id: string
  gmail_thread_id: string
  message_id_header: string | null
  in_reply_to: string | null
  from: Address | null
  to: Address[]
  cc: Address[]
  subject: string | null
  snippet: string | null
  body_text: string
  received_at: string
  label_ids: string[]
  attachments: ParsedAttachment[]
  /** Newsletter or bulk mail: a List-Unsubscribe header or Precedence: bulk/list. */
  is_bulk: boolean
  /** Where it was delivered or forwarded to (Delivered-To, X-Forwarded-To / -For, X-Original-To), lowercased. */
  delivered_to: string[]
}

export const BODY_LIMIT = 20_000

/** The HTML part of a message, decoded (empty when there is none). */
export function htmlBody(m: GmailMessage, limit = 1_000_000): string {
  let html = ''
  walk(m.payload, (p) => {
    if (!html && (p.mimeType ?? '').toLowerCase() === 'text/html' && p.body?.data && !p.filename) html = decodeBase64Url(p.body.data, limit)
  })
  return html
}

/** Encoded bodies larger than this are cut before decoding: newsletters can be megabytes of HTML. */
export const RAW_LIMIT = 300_000

export function decodeBase64Url(data: string, limit = RAW_LIMIT): string {
  let b64 = data.length > limit ? data.slice(0, limit - (limit % 4)) : data
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/** "Amy Lee" <amy@wfsports.com>, bob@x.com → addresses. Commas inside quotes are kept. */
export function parseAddressList(value: string | undefined | null): Address[] {
  if (!value) return []
  const out: Address[] = []
  const parts = value.match(/("[^"]*"|[^,])+/g) ?? []
  for (const raw of parts) {
    const part = raw.trim()
    const angle = part.match(/^(.*)<([^>]+)>\s*$/)
    const email = (angle ? angle[2]! : part).trim().toLowerCase()
    if (!email.includes('@')) continue
    const name = angle ? angle[1]!.trim().replace(/^"|"$/g, '').trim() || null : null
    out.push({ email, name })
  }
  return out
}

function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h ? h.value : null
}

function walk(part: GmailPart | undefined, visit: (p: GmailPart) => void) {
  if (!part) return
  visit(part)
  for (const p of part.parts ?? []) walk(p, visit)
}

/** List-Unsubscribe or Precedence: bulk / list / junk marks mail sent to many people at once. */
export function isBulk(part: GmailPart | undefined): boolean {
  return !!header(part, 'List-Unsubscribe') || /^(bulk|list|junk)$/i.test(header(part, 'Precedence') ?? '')
}

export function parseMessage(m: GmailMessage): ParsedMessage {
  let plain = ''
  let html = ''
  const attachments: ParsedAttachment[] = []
  walk(m.payload, (p) => {
    const type = (p.mimeType ?? '').toLowerCase()
    if (p.filename) {
      attachments.push({ file_name: p.filename, mime_type: p.mimeType ?? null, size: p.body?.size ?? null, gmail_attachment_id: p.body?.attachmentId ?? null, part_id: p.partId ?? null })
      return
    }
    if (!p.body?.data) return
    if (type === 'text/plain' && !plain) plain = p.body.data
    else if (type === 'text/html' && !html) html = p.body.data
  })
  // Decode only what is needed: the plain part, or the HTML when there is no plain part.
  const body = (plain ? decodeBase64Url(plain) : html ? htmlToText(decodeBase64Url(html)) : '').replace(/\r\n/g, '\n')
  return {
    gmail_id: m.id,
    gmail_thread_id: m.threadId,
    message_id_header: header(m.payload, 'Message-ID') ?? header(m.payload, 'Message-Id'),
    in_reply_to: header(m.payload, 'In-Reply-To'),
    from: parseAddressList(header(m.payload, 'From'))[0] ?? null,
    to: parseAddressList(header(m.payload, 'To')),
    cc: parseAddressList(header(m.payload, 'Cc')),
    subject: header(m.payload, 'Subject'),
    snippet: m.snippet ? htmlToText(m.snippet) : null,
    body_text: body.length > BODY_LIMIT ? body.slice(0, BODY_LIMIT) : body,
    received_at: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    label_ids: m.labelIds ?? [],
    attachments,
    is_bulk: isBulk(m.payload),
    delivered_to: (m.payload?.headers ?? []).filter((h) => /^(delivered-to|x-forwarded-to|x-forwarded-for|x-original-to)$/i.test(h.name))
      .flatMap((h) => h.value.toLowerCase().match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []),
  }
}

/** Mail from the old shaverlakesports@gmail.com (Dana, Oct 10): it forwards to oldslsgmail@ on orders@. */
export function isOldGmail(p: Pick<ParsedMessage, 'to' | 'cc' | 'delivered_to'>, legacyAddress: string): boolean {
  const legacy = legacyAddress.toLowerCase()
  const all = [...p.to.map((a) => a.email), ...p.cc.map((a) => a.email), ...p.delivered_to].map((x) => x.toLowerCase())
  return all.some((a) => a === legacy || a === 'shaverlakesports@gmail.com')
}

const CUT = [
  /^--\s*$/,
  /^_{5,}/,
  /^-{3,}\s*original message/i,
  /^on .{3,200} wrote:\s*$/i,
  /^from:\s/i,
  /^sent from my /i,
  /^(thanks|thank you|thx|best|best regards|kind regards|regards|warm regards|sincerely|cheers|respectfully)[,!.]?\s*$/i,
]

/**
 * The message as the sender wrote it this time: stop at the signature or the quoted earlier mail.
 * Rep signatures list every line they carry, so nothing below the sign-off counts as a vendor clue.
 */
export function bodyAboveSignature(body: string, maxChars = 4000): string {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (CUT.some((re) => re.test(t))) break
    if (t.startsWith('>')) continue
    out.push(line)
    if (out.join('\n').length > maxChars) break
  }
  return out.join('\n')
}

/** Clue text for the matcher: strong = subject, file names, From name; body = the message above the signature. */
export function clueText(p: Pick<ParsedMessage, 'subject' | 'attachments' | 'from' | 'body_text'>): { strong: string; body: string; from: string } {
  const files = p.attachments.map((a) => a.file_name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_.]+/g, ' ')).join(' \n ')
  const subject = (p.subject ?? '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
  // The From name is kept apart: a person's first name there ("Angie Castillo") is not a vendor.
  return { strong: [subject, files].join(' \n '), body: bodyAboveSignature(p.body_text), from: p.from?.name ?? '' }
}
