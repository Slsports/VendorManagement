// autopay-read: scheduled and automatic payments in the billing@ mail become tasks reminded 5 days before the money goes
// out (Dana, Nov 2: "I need reminders 5 days ahead of any auto pays … Any notifications from MBS Accountancy or the IRS
// or FTB"). Runs every 10 minutes from pg_cron (header x-cron-secret): autopay_queue → Claude (the email and up to two
// PDFs) → autopay_apply (one task per payment still to come; the same payment from two emails is one task).
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled } from '../_shared/ai.ts'
import { Gmail, googleAccessToken } from '../_shared/gmail.ts'
import { readAutopayEmail } from '../_shared/autopayRead.ts'

const TIME_BUDGET_MS = 100_000
const MAX_PDF = 5_000_000

interface Queued { email_id: string; gmail_id: string; gmail_box: string; from_email: string | null; subject: string | null; received_at: string; text: string; pdfs: { file_name: string; gmail_attachment_id: string }[] }

async function attachmentBytes(gmail: Gmail, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const part = await gmail.call<{ data: string }>(`messages/${messageId}/attachments/${attachmentId}`)
  const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }
const decode = (data: string) => new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4)), (c) => c.charCodeAt(0)))
function htmlOf(p: Part | undefined): string | null {
  if (!p) return null
  if (p.mimeType === 'text/html' && p.body?.data) return decode(p.body.data)
  for (const c of p.parts ?? []) { const h = htmlOf(c); if (h) return h }
  return null
}
/** An email stored with no plain text (IRS Direct Pay): its HTML from Gmail, as plain words. */
async function textFromGmail(gmail: Gmail, messageId: string): Promise<string> {
  const m = await gmail.call<{ payload?: Part }>(`messages/${messageId}`, { query: { format: 'full' } })
  const html = htmlOf(m.payload) ?? ''
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const { data: accounts } = await db.from('mail_accounts').select('organization_id')
    const gmails = new Map<string, Gmail>()
    const out: unknown[] = []
    for (const a of accounts ?? []) {
      const org = a.organization_id as string
      while (Date.now() - started < TIME_BUDGET_MS * 0.7) {
        const { data, error } = await db.rpc('autopay_queue', { p_org: org, p_limit: 4 })
        if (error) throw new Error(error.message)
        const batch = (data ?? []) as Queued[]
        if (!batch.length) break
        for (const q of batch) {
          try {
            if (!gmails.has(q.gmail_box)) gmails.set(q.gmail_box, new Gmail(await googleAccessToken(q.gmail_box)))
            const gmail = gmails.get(q.gmail_box)!
            const pdfs: { name: string; bytes: Uint8Array }[] = []
            for (const p of q.pdfs.slice(0, 2)) {
              const bytes = await attachmentBytes(gmail, q.gmail_id, p.gmail_attachment_id)
              if (bytes.length <= MAX_PDF) pdfs.push({ name: p.file_name, bytes })
            }
            const text = !q.text || q.text.trim() === 'NO TEXT' ? await textFromGmail(gmail, q.gmail_id) : q.text
            const items = await readAutopayEmail(db, org, { from: q.from_email ?? '', subject: q.subject, received: q.received_at.slice(0, 10), text, pdfs })
            const { data: n, error: e2 } = await db.rpc('autopay_apply', { p_email: q.email_id, p_items: items })
            if (e2) throw new Error(e2.message)
            out.push({ email: q.email_id, payments: items.length, tasks: n })
          } catch (e) {
            // marked read so one bad email never blocks the queue; the error is kept on the email
            await db.rpc('autopay_apply', { p_email: q.email_id, p_items: [], p_error: e instanceof Error ? e.message.slice(0, 300) : String(e) })
            out.push({ email: q.email_id, error: e instanceof Error ? e.message : String(e) })
          }
        }
      }
    }
    return json({ read: out.length, out })
  } catch (e) {
    return errorResponse(e)
  }
})
