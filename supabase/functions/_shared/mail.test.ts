import { describe, expect, it } from 'vitest'
import { buildVendorIndex, domainLabel, domainVendors, mentionedVendors, vendorNames } from './mailMatch.ts'
import { bodyAboveSignature, clueText, decodeBase64Url, parseAddressList, parseMessage, type GmailMessage } from './mailParse.ts'

const vendors = [
  { id: 'wfs', name: 'WORLD FAMOUS SPORTS', aliases: ['WORLD FAMOUS SPORTS - WWD'] },
  { id: 'thermacell', name: 'THERMACELL', aliases: ['THERMACELL - WWD'] },
  { id: 'stansport', name: 'STANSPORT', aliases: [] },
  { id: 'ad', name: 'AMERICAN DREAM HOME GOODS', aliases: ['American Dream - Dandylines'] },
  { id: 'nw', name: 'NATIONWIDE WHOLESALE/RIVER TRAIL', aliases: [] },
  { id: 'sherry', name: 'SHERRY', aliases: [] },
  { id: 'slh', name: 'SHAVER LAKE HARDWARE', aliases: [] },
  { id: 'pacific', name: 'PACIFIC', aliases: [] },
  { id: 'etp', name: 'ET PRODUCTS', aliases: ['ET PRODUCTS (FAIRE)'] },
]
const index = buildVendorIndex(vendors, ['Shaver Lake'])
const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('vendor names', () => {
  it('drops route and rep tags, keeps both halves of a slash name', () => {
    expect(vendorNames(vendors[3]!)).toEqual(['american dream home goods', 'american dream'])
    expect(vendorNames(vendors[4]!)).toEqual(['nationwide wholesale', 'river trail'])
    expect(vendorNames(vendors[8]!)).toEqual(['et products'])
  })
})

describe('web address clues', () => {
  it('reads the company part of a domain', () => {
    expect(domainLabel('mail.wfsports.com')).toBe('wfsports')
    expect(domainLabel('stansport.co.uk')).toBe('stansport')
  })
  it('matches initials plus the last word, the whole name, and not generic words', () => {
    expect(domainVendors(index, 'wfsports.com')).toEqual(['wfs'])
    expect(domainVendors(index, 'thermacell.com')).toEqual(['thermacell'])
    expect(domainVendors(index, 'stansport.com')).toEqual(['stansport'])
    expect(domainVendors(index, 'americandreamhomegoods.com')).toContain('ad')
    expect(domainVendors(index, 'ups.com')).toEqual([])
    expect(domainVendors(index, 'pacificgas.com')).toEqual([])
  })
})

describe('names in the email', () => {
  it('finds a multi-word name in the body, a one-word name only in the subject or a file name', () => {
    expect(mentionedVendors(index, { strong: 'Re: your order', body: 'Your World Famous Sports order shipped today.' })).toEqual(['wfs'])
    expect(mentionedVendors(index, { strong: 'Hello', body: 'Hi Sherry, Thermacell refills are in.' })).toEqual([])
    expect(mentionedVendors(index, { strong: 'Thermacell confirmation', body: '' })).toEqual(['thermacell'])
  })
  it('never matches our own name or a lone generic word', () => {
    expect(mentionedVendors(index, { strong: 'Shaver Lake Hardware PO 55', body: 'Pacific time' })).toEqual([])
  })
  it('ignores the rep signature that lists every line', () => {
    const body = 'Here is the American Dream confirmation.\n\nThanks,\nDonna\nDandylines: American Dream, World Famous Sports, Stansport'
    expect(mentionedVendors(index, { strong: '', body: bodyAboveSignature(body) })).toEqual(['ad'])
  })
})

describe('message parsing', () => {
  const msg: GmailMessage = {
    id: 'm1', threadId: 't1', labelIds: ['INBOX', 'Label_1'], snippet: 'Order &amp; invoice', internalDate: '1791000000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Lee, Amy" <Amy@WFSports.com>' },
        { name: 'To', value: 'orders@shaverlakesports.com, "Dana" <dana@shaverlakesports.com>' },
        { name: 'Subject', value: 'RE: FW: Confirmation' },
        { name: 'Message-ID', value: '<abc@wfsports.com>' },
      ],
      parts: [
        { partId: '0', mimeType: 'text/plain', body: { data: b64('Confirmation attached.\n\nOn Mon, Oct 5, 2026 Dana wrote:\n> old text') } },
        { partId: '1', mimeType: 'application/pdf', filename: 'WFS_Confirmation_8-27-26.pdf', body: { size: 1200, attachmentId: 'att1' } },
      ],
    },
  }
  it('reads addresses, subject, body and attachments', () => {
    const p = parseMessage(msg)
    expect(p.from).toEqual({ email: 'amy@wfsports.com', name: 'Lee, Amy' })
    expect(p.to.map((a) => a.email)).toEqual(['orders@shaverlakesports.com', 'dana@shaverlakesports.com'])
    expect(p.snippet).toBe('Order & invoice')
    expect(p.attachments[0]).toMatchObject({ file_name: 'WFS_Confirmation_8-27-26.pdf', gmail_attachment_id: 'att1' })
    expect(p.message_id_header).toBe('<abc@wfsports.com>')
    const clues = clueText(p)
    expect(clues.body).toBe('Confirmation attached.\n')
    expect(clues.strong).toContain('Confirmation')
    expect(clues.strong).toContain('WFS Confirmation 8 27 26')
  })
  it('decodes UTF-8 and handles empty address lists', () => {
    expect(decodeBase64Url(b64(unescape(encodeURIComponent('Café')))).normalize()).toBe('Café')
    expect(parseAddressList(undefined)).toEqual([])
  })
})
