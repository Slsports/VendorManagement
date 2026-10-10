// Build an RFC 5322 message for Gmail's send endpoint. Plain-text body (UTF-8), optional attachments,
// reply headers so the message threads with the conversation. Pure: shared by gmail-send and the tests.

export interface MimeAttachment { name: string; mime: string; base64: string }
export interface MimeInput {
  from: string
  to: string[]
  cc?: string[]
  replyTo?: string
  subject: string
  text: string
  inReplyTo?: string | null
  references?: string | null
  attachments?: MimeAttachment[]
  boundary?: string
}

export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const wrap = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n')
// deno-lint-ignore no-control-regex
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s)
/** RFC 2047 for headers with non-ASCII text (Subject, names). */
export function encodeHeader(s: string): string {
  return ascii(s) ? s : `=?UTF-8?B?${utf8ToBase64(s)}?=`
}
/** "Dana Powell | Shaver Lake Sports" <orders@…> */
export function formatAddress(name: string | null | undefined, email: string): string {
  if (!name) return email
  const clean = name.replace(/["\r\n]/g, '')
  return ascii(clean) ? `"${clean}" <${email}>` : `${encodeHeader(clean)} <${email}>`
}
const fileName = (n: string) => n.replace(/["\r\n\\]/g, '_')

export function buildMime(m: MimeInput): string {
  const boundary = m.boundary ?? `vms-${crypto.randomUUID()}`
  const head = [
    `From: ${m.from}`,
    `To: ${m.to.join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references || m.inReplyTo ? [`References: ${[m.references, m.inReplyTo].filter(Boolean).join(' ')}`] : []),
    'MIME-Version: 1.0',
  ]
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(utf8ToBase64(m.text))]
  if (!m.attachments?.length) return [...head, ...textPart].join('\r\n')
  const parts = [
    `--${boundary}`, ...textPart,
    ...m.attachments.flatMap((a) => [
      `--${boundary}`,
      `Content-Type: ${a.mime || 'application/octet-stream'}; name="${fileName(a.name)}"`,
      `Content-Disposition: attachment; filename="${fileName(a.name)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(a.base64.replace(/\s/g, '')),
    ]),
    `--${boundary}--`,
  ]
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join('\r\n')
}

/** "Re: Order 123" stays as is; "Order 123" becomes "Re: Order 123" (or "Fwd:"). */
export function prefixSubject(subject: string | null, prefix: 'Re' | 'Fwd'): string {
  const s = (subject ?? '').trim()
  const re = prefix === 'Re' ? /^re:/i : /^(fwd?|fw):/i
  return re.test(s) ? s : `${prefix}: ${s}`.trim()
}

/** The body with the sender's signature below it. */
export function withSignature(text: string, signature: string | null | undefined): string {
  const sig = (signature ?? '').trim()
  return sig ? `${text.replace(/\s+$/, '')}\n\n${sig}\n` : text
}
