// Email signatures (Dana, Oct 12-13): one template for everyone, filled in per person, with the store logo above it.
// Pure TypeScript (no Deno APIs): the app's compose window uses the same rules (src/lib/signature.ts, kept identical by a test).

export interface SignaturePerson { name: string | null; title: string | null; direct: string | null; own: string | null }

export const LOGO_URL = 'https://vms.shaverlakesports.com/brand/sls/email-logo.png'

/** The person's signature: their own version when they keep one, else the template with their name, title and direct line. */
export function fillSignature(template: string | null, p: SignaturePerson): string {
  if (p.own?.trim()) return p.own.trim()
  if (!template?.trim()) return [p.name, p.title, 'Shaver Lake Sports'].filter(Boolean).join('\n')
  return template
    .replace(/\{name\}/g, p.name?.trim() ?? '')
    .replace(/\{title\}/g, p.title?.trim() ?? '')
    .replace(/\{direct\}/g, p.direct?.trim() ? ` | Direct: ${p.direct.trim()}` : '')
    .split('\n').filter((l) => l.trim() !== '').join('\n')
}

/** Where a reply's quoted mail starts (the signature goes above it). */
const QUOTE = /\n(?=On .{4,200}wrote:\s*$|-{5,} ?Forwarded message|From: .+\nSent: )/m

/** The body with the signature placed above any quoted mail (or at the end). */
export function placeSignature(body: string, signature: string | null): { top: string; signature: string; quoted: string } {
  const m = QUOTE.exec(body)
  const top = (m ? body.slice(0, m.index) : body).replace(/\s+$/, '')
  const quoted = m ? body.slice(m.index).replace(/^\n+/, '') : ''
  return { top, signature: (signature ?? '').trim(), quoted }
}

/** Plain text version of the email. */
export function textEmail(body: string, signature: string | null): string {
  const p = placeSignature(body, signature)
  return [p.top, p.signature, p.quoted].filter((x) => x).join('\n\n') + '\n'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const lines = (s: string) => esc(s).replace(/\n/g, '<br>')
const linkify = (s: string) => s
  .replace(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi, '<a href="mailto:$1" style="color:#0f6b3a">$1</a>')
  .replace(/(^|[\s|])((?:https?:\/\/)?(?:www\.)?shaverlakesports\.com)(?![^<]*>)/gi, (_m, pre: string, url: string) => `${pre}<a href="https://${url.replace(/^https?:\/\//, '')}" style="color:#0f6b3a">${url}</a>`)

/** Full web addresses in the message become links (the routing letter's "I received it" link, Oct 13). */
const links = (s: string) => s.replace(/(^|[\s(])(https:\/\/[^\s<>"]+[^\s<>".,;:)])/g, (_m, pre: string, url: string) => `${pre}<a href="${url}" style="color:#0f6b3a">${url}</a>`)

/** HTML version: the body, then the logo and the signature, then any quoted mail in grey. */
export function htmlEmail(body: string, signature: string | null, logoUrl = LOGO_URL): string {
  const p = placeSignature(body, signature)
  const sig = p.signature
    ? `<div style="margin-top:18px"><img src="${logoUrl}" width="240" height="31" alt="Shaver Lake Sports" style="display:block;border:0;margin-bottom:8px"><div style="color:#333;font-size:13px;line-height:1.45">${linkify(lines(p.signature))}</div></div>`
    : ''
  const quoted = p.quoted ? `<div style="margin-top:18px;color:#666">${lines(p.quoted)}</div>` : ''
  return `<!doctype html><html><body><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5">${links(lines(p.top))}${sig}${quoted}</div></body></html>`
}
