import { describe, expect, it } from 'vitest'
import { buildMime, encodeHeader, formatAddress, prefixSubject, utf8ToBase64, withSignature } from './mime.ts'

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)))

describe('mime', () => {
  it('builds a plain reply that threads', () => {
    const raw = buildMime({ from: formatAddress('Dana Powell | Shaver Lake Sports', 'orders@shaverlakesports.com'), to: ['amy@wfsports.com'], replyTo: 'orders@shaverlakesports.com', subject: 'Re: Order 123', text: 'Thanks Amy — got it.', inReplyTo: '<abc@wfsports.com>' })
    expect(raw).toContain('From: "Dana Powell | Shaver Lake Sports" <orders@shaverlakesports.com>')
    expect(raw).toContain('In-Reply-To: <abc@wfsports.com>')
    expect(raw).toContain('References: <abc@wfsports.com>')
    expect(raw).not.toContain('multipart')
    const body = raw.split('\r\n\r\n')[1]!
    expect(decode(body)).toBe('Thanks Amy — got it.')
  })
  it('adds attachments as a mixed message', () => {
    const raw = buildMime({ from: 'orders@x.com', to: ['a@b.com'], cc: ['c@d.com'], subject: 'PO 55', text: 'Attached.', attachments: [{ name: 'PO 55.pdf', mime: 'application/pdf', base64: utf8ToBase64('%PDF') }], boundary: 'B' })
    expect(raw).toContain('Cc: c@d.com')
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="B"')
    expect(raw).toContain('Content-Disposition: attachment; filename="PO 55.pdf"')
    expect(raw.trim().endsWith('--B--')).toBe(true)
  })
  it('encodes non-ASCII subjects, prefixes Re/Fwd once, appends the signature', () => {
    expect(encodeHeader('Café order')).toMatch(/^=\?UTF-8\?B\?/)
    expect(prefixSubject('Order 1', 'Re')).toBe('Re: Order 1')
    expect(prefixSubject('RE: Order 1', 'Re')).toBe('RE: Order 1')
    expect(prefixSubject('Order 1', 'Fwd')).toBe('Fwd: Order 1')
    expect(withSignature('Hi\n\n', 'Dana Powell\nShaver Lake Sports')).toBe('Hi\n\nDana Powell\nShaver Lake Sports\n')
  })
})
