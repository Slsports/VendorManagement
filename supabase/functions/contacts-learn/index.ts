// contacts-learn: vendor and rep group contacts from email (Dana, Oct 13: "Why didn't vms tag any of the contact info to our
// reps & contacts for WFS? There are plenty of emails there to learn from." … "Contacts go straight onto the vendor with
// the note it came from email."). Runs every minute from pg_cron (header x-cron-secret). Orders mail and shared
// conversations only, 12 months back, then as new people write:
//   1. queue  — contact_learn_queue: each address at a vendor or rep group not read yet, with up to three of its emails
//   2. read   — Claude (cheapest model) reads the signatures: name, title, phones with their kind, what they do for us
//   3. save   — a new person is added to the vendor's Reps & contacts (or the rep group's reps), marked "Learned from
//               email"; someone already there only gets what is missing (another phone, a title). Typed details and
//               the starred rep never change. Each address is read once (contact_learning), so deleted ones stay gone.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, readContacts, type ContactReading, type ContactToRead } from '../_shared/ai.ts'

const TIME_BUDGET_MS = 90_000
const BATCH = 8

interface Queued { email: string; vendor_id: string | null; rep_group_id: string | null; owner_name: string; emails: { direction: string; from_name: string | null; subject: string | null; text: string }[] }
interface Phone { number: string; type: 'work' | 'cell' | 'fax' | 'other'; label?: string | null; ext?: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const { data: accounts } = await db.from('mail_accounts').select('organization_id')
    const out: Record<string, Record<string, number>> = {}
    for (const a of accounts ?? []) {
      const org = a.organization_id as string
      const tally: Record<string, number> = {}
      while (Date.now() - started < TIME_BUDGET_MS * 0.7) {
        const { data, error } = await db.rpc('contact_learn_queue', { p_org: org, p_limit: BATCH })
        if (error) throw new Error(error.message)
        const batch = (data ?? []) as Queued[]
        if (!batch.length) break
        const readings = await readContacts(db, org, batch.map((q): ContactToRead => ({ email: q.email, company: q.owner_name, emails: q.emails.map((e) => ({ ...e, text: ownPart(e.text) })) })))
        const byEmail = new Map(readings.map((r) => [r.email.trim().toLowerCase(), r]))
        for (const q of batch) {
          const result = await save(db, org, q, byEmail.get(q.email))
          tally[result] = (tally[result] ?? 0) + 1
        }
      }
      out[org] = tally
    }
    return json(out)
  } catch (e) {
    return errorResponse(e)
  }
})

/** The email without the earlier mail quoted under it. */
function ownPart(text: string): string {
  const m = /\n(?:On .{4,200}wrote:|-{3,} ?Original Message|_{10,}|From: .+\n(?:Sent|Date): )/i.exec(text)
  return (m ? text.slice(0, m.index) : text).trim()
}

const digits = (n: string) => n.replace(/\D/g, '').slice(-10)

function cleanPhones(list: ContactReading['phones']): Phone[] {
  const seen = new Set<string>()
  const out: Phone[] = []
  for (const p of list) {
    const d = digits(p.number)
    if (d.length < 7 || seen.has(d) || d === '5598412740') continue // never the store's own number
    seen.add(d)
    out.push({ number: p.number.trim(), type: p.type, ...(p.type === 'other' && p.label ? { label: p.label.trim() } : {}), ...(p.ext ? { ext: p.ext.trim() } : {}) })
  }
  return out
}

async function mark(db: SupabaseClient, org: string, q: Queued, result: string, note?: string) {
  // the unique index (address + vendor or rep group) keeps a second run from adding it twice
  await db.from('contact_learning').insert({ organization_id: org, email: q.email, vendor_id: q.vendor_id, rep_group_id: q.rep_group_id, result, note: note ?? null })
  return result
}

async function save(db: SupabaseClient, org: string, q: Queued, r: ContactReading | undefined): Promise<string> {
  if (!r) return mark(db, org, q, 'failed', 'Claude did not read it')
  if (r.automated) return mark(db, org, q, 'skipped', 'automatic address')
  if (!r.belongs) return mark(db, org, q, 'skipped', `not ${q.owner_name}`)
  const phones = cleanPhones(r.phones)
  const name = r.name?.trim() || null
  const title = r.title?.trim() || null
  const note = 'Learned from email'
  if (q.vendor_id) {
    const { data: have } = await db.from('vendor_emails').select('id, contact_name, title, phones').eq('vendor_id', q.vendor_id).ilike('email', q.email).maybeSingle()
    if (have) return mark(db, org, q, await fill(db, 'vendor_emails', have, { nameCol: 'contact_name', name, title, phones }))
    let roles: string[] = r.roles.length ? r.roles : ['other']
    // a vendor we buy through a rep group: its rep is the group's person; the company's own people are customer service,
    // shipping or billing, never "our rep" (Dana, Oct 15: Heather at Planet Cotton showed as the rep, not Maryellen)
    const { data: v } = await db.from('vendors').select('rep_group_id').eq('id', q.vendor_id).maybeSingle()
    if (v?.rep_group_id && roles.includes('rep')) roles = [...new Set(roles.map((x) => (x === 'rep' ? 'customer_service' : x)))]
    const { error } = await db.from('vendor_emails').insert({
      organization_id: org, vendor_id: q.vendor_id, email: q.email, contact_name: name, title, phones, roles, contact_type: roles[0],
      source: 'email_enrichment', confidence: 0.7, notes: note,
    })
    if (error) return mark(db, org, q, 'failed', error.message.slice(0, 200))
    return mark(db, org, q, 'added')
  }
  const { data: have } = await db.from('rep_group_contacts').select('id, name, title, phones').eq('rep_group_id', q.rep_group_id!).ilike('email', q.email).maybeSingle()
  if (have) return mark(db, org, q, await fill(db, 'rep_group_contacts', have, { nameCol: 'name', name, title, phones }))
  const { error } = await db.from('rep_group_contacts').insert({ organization_id: org, rep_group_id: q.rep_group_id, email: q.email, name, title, phones, notes: note })
  if (error) return mark(db, org, q, 'failed', error.message.slice(0, 200))
  return mark(db, org, q, 'added')
}

/** Someone already on file: only what is missing (a name, a title, numbers not there yet). */
async function fill(db: SupabaseClient, table: 'vendor_emails' | 'rep_group_contacts', have: Record<string, unknown>, r: { nameCol: string; name: string | null; title: string | null; phones: Phone[] }): Promise<string> {
  const current = (have.phones ?? []) as Phone[]
  const known = new Set(current.map((p) => digits(p.number)))
  const extra = r.phones.filter((p) => !known.has(digits(p.number)))
  const patch: Record<string, unknown> = {
    ...(!have[r.nameCol] && r.name ? { [r.nameCol]: r.name } : {}),
    ...(!have.title && r.title ? { title: r.title } : {}),
    ...(extra.length ? { phones: [...current, ...extra] } : {}),
  }
  if (!Object.keys(patch).length) return 'same'
  const { error } = await db.from(table).update(patch).eq('id', have.id as string)
  return error ? 'failed' : 'updated'
}
