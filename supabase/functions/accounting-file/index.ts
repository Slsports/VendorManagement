// accounting-file: files the papers that come to billing@ (docs/accounting-plan.md §4; Dana, Oct 16). Every attachment
// in the accounting mailbox is looked at once: pictures and junk are left in the email with a reason, papers are read
// by Claude and filed into Accounting folders (Category / Party / Year) under a name by the convention. The same bytes
// are never kept twice (sha256). Runs every minute from pg_cron (header x-cron-secret) through the whole history,
// newest first, and on demand from the app:
//   { }                               → a slice of the queue (the scheduler, or Dana pressing "File now")
//   { email_id }                      → this email's attachments now (the conversation page)
//   { attachment_id, force? }         → one attachment, filed even when Claude would have skipped it ("File in Accounting")
//   { document_id, hint? }            → a file dropped on the Documents page: read it, name it, file it
//   { backcheck: true }               → trusted only: look again at every email whose files were skipped (a rule changed)
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Gmail, GMAIL_SCOPES, googleAccessToken } from '../_shared/gmail.ts'
import { sheetFileText } from '../_shared/sheetFile.ts'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_KINDS, aiEnabled, imageType, readAccountingPapers, type AccountingFileCtx, type AccountingPaperReading, type PaperFile } from '../_shared/ai.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
const TIME_BUDGET_MS = 40_000
const EMAILS_PER_RUN = 12
// The edge worker has little memory (a run died with WORKER_RESOURCE_LIMIT on Oct 16): a file over 5 MB is read by its
// name and the email, and one Claude call carries at most 12 MB of files.
const MAX_READ_BYTES = 5 * 1024 * 1024
const MAX_CALL_BYTES = 12 * 1024 * 1024
const MAX_KEEP_BYTES = 15 * 1024 * 1024
const BUCKET = 'accounting-files'

type Att = { id: string; file_name: string; mime_type: string | null; size: number | null; gmail_attachment_id: string | null; accounting_document_id: string | null; accounting_skip: string | null }
type Mail = { id: string; organization_id: string; gmail_id: string; gmail_box: string | null; mailbox_id: string | null; thread_id: string; direction: 'in' | 'out' | 'internal'; from_email: string | null; from_name: string | null; subject: string | null; body_text: string | null; received_at: string; is_bulk: boolean | null; attachments: Att[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    // Who may run it: the scheduler, or a signed-in person with the Accounting tick.
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    let me: { id: string; organization_id: string } | null = null
    if (!trusted) {
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: u } = await db.auth.getUser(jwt)
      if (!u.user) return json({ error: 'Not signed in' }, 401)
      const { data: p } = await db.from('profiles').select('id, organization_id, is_active, sees_accounting').eq('id', u.user.id).single()
      if (!p?.is_active || !p.sees_accounting) return json({ error: 'Accounting only' }, 403)
      me = { id: p.id, organization_id: p.organization_id }
    }
    if (!aiEnabled()) return json({ error: 'Claude is not set up for this organization' }, 503)
    const body = await req.json().catch(() => ({})) as { email_id?: string; attachment_id?: string; force?: boolean; document_id?: string; hint?: string; backcheck?: boolean; gmail_filters?: boolean; apply_contact_filing?: string }
    const started = Date.now()

    // A contact's "their papers" rule applied to the old (from a cloud session, where the Storage API needs this function).
    if (body.apply_contact_filing && trusted) {
      const { data: paths, error } = await db.rpc('accounting_apply_contact_filing', { p_contact: body.apply_contact_filing })
      if (error) return json({ error: error.message }, 500)
      const list = (paths ?? []) as string[]
      if (list.length) { const { error: rerr } = await db.storage.from(BUCKET).remove(list); if (rerr) return json({ error: rerr.message, removed: 0, paths: list.length }, 500) }
      return json({ removed: list.length })
    }

    // Trusted only (Dana, Oct 16): the mailbox's own Gmail filters, to see what already forwards to bill.com.
    if (body.gmail_filters && trusted) {
      const { data: boxes } = await db.from('mailboxes').select('address').eq('kind', 'accounting').eq('is_active', true)
      const out: unknown[] = []
      for (const b of boxes ?? []) {
        try {
          const gmail = new Gmail(await googleAccessToken(b.address, [...GMAIL_SCOPES, 'https://www.googleapis.com/auth/gmail.settings.basic']))
          const labels = await gmail.call<{ labels: { id: string; name: string }[] }>('labels')
          const names = new Map((labels.labels ?? []).map((l) => [l.id, l.name]))
          const f = await gmail.call<{ filter?: { id: string; criteria: Record<string, unknown>; action: Record<string, unknown> }[] }>('settings/filters')
          out.push({ mailbox: b.address, filters: (f.filter ?? []).map((x) => ({ criteria: x.criteria, action: { ...x.action, addLabelIds: ((x.action.addLabelIds as string[] | undefined) ?? []).map((id) => names.get(id) ?? id), removeLabelIds: ((x.action.removeLabelIds as string[] | undefined) ?? []).map((id) => names.get(id) ?? id) } })) })
        } catch (e) {
          out.push({ mailbox: b.address, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return json(out)
    }

    if (body.document_id) {
      const { data: d } = await db.from('accounting_documents').select('*').eq('id', body.document_id).single()
      if (!d || (me && d.organization_id !== me.organization_id)) return json({ error: 'Document not found' }, 404)
      return json(await fileUploaded(db, d, body.hint ?? null))
    }

    if (body.attachment_id) {
      const { data: a } = await db.from('email_attachments').select('id, email_id').eq('id', body.attachment_id).single()
      if (!a) return json({ error: 'Attachment not found' }, 404)
      const mail = await loadMail(db, a.email_id)
      if (!mail || (me && mail.organization_id !== me.organization_id)) return json({ error: 'Email not found' }, 404)
      const r = await fileMail(db, mail, { only: a.id, force: !!body.force })
      return json(r)
    }

    if (body.email_id) {
      const mail = await loadMail(db, body.email_id)
      if (!mail || (me && mail.organization_id !== me.organization_id)) return json({ error: 'Email not found' }, 404)
      return json(await fileMail(db, mail, { force: false }))
    }

    // The queue: every accounting mailbox, newest unfiled mail first, a slice per run.
    let bq = db.from('mailboxes').select('id, organization_id, address').eq('kind', 'accounting').eq('is_active', true)
    if (me) bq = bq.eq('organization_id', me.organization_id)
    const { data: boxes } = await bq
    const out: unknown[] = []
    for (const box of boxes ?? []) {
      if (body.backcheck && trusted) {
        // a rule changed (Dana, Oct 14: "all the old stuff checked"): everything with a skipped file is looked at again
        const { data: skipped } = await db.from('email_attachments').select('email_id').eq('organization_id', box.organization_id).not('accounting_skip', 'is', null).is('accounting_document_id', null).limit(5000)
        const ids = [...new Set((skipped ?? []).map((s) => s.email_id))]
        for (let i = 0; i < ids.length; i += 200) await db.from('emails').update({ accounting_filed_at: null }).in('id', ids.slice(i, i + 200)).eq('mailbox_id', box.id)
        out.push({ mailbox: box.address, reset: ids.length })
        continue
      }
      let filed = 0, skipped = 0, linked = 0, errors = 0, mails = 0
      const { data: queue } = await db.from('emails').select('id').eq('mailbox_id', box.id).eq('has_attachments', true).is('accounting_filed_at', null).order('received_at', { ascending: false }).limit(EMAILS_PER_RUN)
      for (const q of queue ?? []) {
        if (Date.now() - started > TIME_BUDGET_MS) break
        const mail = await loadMail(db, q.id)
        if (!mail) continue
        const r = await fileMail(db, mail, { force: false })
        mails++; filed += r.filed; skipped += r.skipped; linked += r.linked; errors += r.errors
      }
      const { count: left } = await db.from('emails').select('id', { count: 'exact', head: true }).eq('mailbox_id', box.id).eq('has_attachments', true).is('accounting_filed_at', null)
      out.push({ mailbox: box.address, emails: mails, filed, skipped, linked, errors, left: left ?? 0, ms: Date.now() - started })
    }
    return json(out)
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

async function loadMail(db: SupabaseClient, id: string): Promise<Mail | null> {
  const { data } = await db.from('emails')
    .select('id, organization_id, gmail_id, gmail_box, mailbox_id, thread_id, direction, from_email, from_name, subject, body_text, received_at, is_bulk, attachments:email_attachments(id, file_name, mime_type, size, gmail_attachment_id, accounting_document_id, accounting_skip)')
    .eq('id', id).maybeSingle()
  return (data as unknown as Mail) ?? null
}

/** What Claude is told about the business's own records, so parties, policies and contracts come out consistent. */
async function knownContext(db: SupabaseClient, org: string): Promise<Pick<AccountingFileCtx, 'known_parties' | 'policies' | 'contracts'>> {
  const [{ data: contacts }, { data: policies }, { data: contracts }, { data: parties }] = await Promise.all([
    db.from('accounting_contacts').select('company').eq('organization_id', org).eq('status', 'confirmed').neq('company', ''),
    db.from('accounting_policies').select('id, label, policy_number, carrier').eq('organization_id', org).eq('is_active', true),
    db.from('accounting_contracts').select('id, label, contract_number, other_party').eq('organization_id', org).in('status', ['pending', 'active']),
    db.from('accounting_documents').select('party').eq('organization_id', org).neq('party', '').limit(2000),
  ])
  const known = new Set<string>()
  for (const c of contacts ?? []) known.add(c.company)
  for (const p of parties ?? []) known.add(p.party)
  for (const p of policies ?? []) if (p.carrier) known.add(p.carrier)
  for (const c of contracts ?? []) if (c.other_party) known.add(c.other_party)
  return {
    known_parties: [...known].sort().slice(0, 300),
    policies: (policies ?? []).map((p) => ({ id: p.id, label: p.label, number: p.policy_number, carrier: p.carrier })),
    contracts: (contracts ?? []).map((c) => ({ id: c.id, label: c.label, number: c.contract_number, party: c.other_party })),
  }
}

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i
const JUNK = /\.(ics|vcf|p7s|zip|html?|eml|txt|rtf|json|xml|asc|sig|gz|rar)$/i
const SHEET = /\.(xlsx?|xlsm|csv)$/i
const DOC = /\.(pdf|docx?)$/i

/** Why an attachment is left in the email before any reading; null when Claude should look at it. */
function preSkip(a: Att, mail: Mail, force: boolean): string | null {
  if (force) return null
  if ((a.size ?? 0) > MAX_KEEP_BYTES) return 'too big to keep (over 15 MB)'
  if (mail.is_bulk) return 'bulk mail'
  const name = a.file_name
  const pic = /^image\//i.test(a.mime_type ?? '') || PICTURE.test(name)
  if (pic && (a.size ?? 0) < 400 * 1024) return 'picture'
  if (JUNK.test(name) || /^text\/calendar|^application\/pkcs7|^application\/zip|^message\//i.test(a.mime_type ?? '')) return 'not a document'
  if (!pic && !SHEET.test(name) && !DOC.test(name) && !/pdf|spreadsheet|excel|csv|msword|officedocument/i.test(a.mime_type ?? '')) return 'not a document'
  return null
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function extOf(name: string, mime: string | null): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name)
  if (m) return m[1].toLowerCase()
  if (/pdf/i.test(mime ?? '')) return 'pdf'
  const img = /image\/(png|jpeg|gif|webp)/i.exec(mime ?? '')
  return img ? img[1].toLowerCase().replace('jpeg', 'jpg') : 'bin'
}

/** The file as Claude can see it: a PDF or picture as itself, a spreadsheet as its text, anything else by name only. */
async function paperFile(name: string, mime: string | null, bytes: Uint8Array): Promise<PaperFile> {
  const kind = mime ?? ''
  if (SHEET.test(name) || /spreadsheet|excel|csv/i.test(kind)) {
    const text = await sheetFileText(bytes)
    return { name, mime: kind, bytes: text ? bytes : new Uint8Array(), text: text?.slice(0, 20_000) ?? undefined }
  }
  const isPdf = /pdf/i.test(kind) || /\.pdf$/i.test(name)
  const img = !isPdf && imageType(bytes)
  if ((isPdf || img) && bytes.length <= MAX_READ_BYTES) return { name, mime: isPdf ? 'application/pdf' : img || kind, bytes }
  return { name, mime: kind, bytes: new Uint8Array() }
}

const money = (n: number | null) => n == null ? null : n === Math.trunc(n) ? `$${Math.trunc(n)}` : `$${n.toFixed(2)}`

/** "<date> <whose> <party> <number> <what> $<amount> <status>.<ext>" (decisions, Oct 16), every piece optional but the date. */
function documentName(r: AccountingPaperReading, fallbackDate: string, ext: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.doc_date ?? '') ? r.doc_date! : fallbackDate
  const parts = [date, r.whose, r.party, r.number, r.what, money(r.amount), r.status_word].map((p) => (p ?? '').trim()).filter(Boolean)
  return `${parts.join(' ').replace(/[/\\:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()}.${ext}`
}

function cleanReading(r: AccountingPaperReading, ctx: Pick<AccountingFileCtx, 'policies' | 'contracts'>, year: number): AccountingPaperReading {
  const policy = r.policy_id && ctx.policies.some((p) => p.id === r.policy_id) ? r.policy_id : null
  const contract = r.contract_id && ctx.contracts.some((c) => c.id === r.contract_id) ? r.contract_id : null
  const doc_year = Number.isInteger(r.doc_year) && r.doc_year >= 1990 && r.doc_year <= 2100 ? r.doc_year : year
  // Claude's words brought back to the lists the table accepts (an answer outside them is "other", never an error)
  const category = (ACCOUNTING_CATEGORIES as readonly string[]).includes(r.category) ? r.category : r.category === 'accounting' || r.category === 'cpa' ? 'accounting_firm' : 'other'
  const kindWord = r.kind.trim().toLowerCase().replace(/\s+/g, '_')
  const kind = (ACCOUNTING_KINDS as readonly string[]).includes(kindWord) ? kindWord : /quot|proposal/.test(kindWord) ? 'quote' : /invoice|bill/.test(kindWord) ? 'invoice' : /receipt/.test(kindWord) ? 'receipt' : /cert|coi/.test(kindWord) ? 'certificate' : /agree|contract|lease/.test(kindWord) ? 'contract' : /letter|memo/.test(kindWord) ? 'letter' : /form|w-?9|1099/.test(kindWord) ? 'form' : 'other'
  const whose = ['SLS', 'P&S', 'SLM', 'GS'].includes(r.whose.trim().toUpperCase()) ? r.whose.trim().toUpperCase() : /p\s*&\s*s|powell/i.test(r.whose) ? 'P&S' : ''
  return { ...r, category, kind, whose, policy_id: policy, contract_id: contract, doc_year, party: r.party.replace(/[/\\]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80), number: r.number.trim().slice(0, 60), what: r.what.trim().slice(0, 80), status_word: r.status_word.trim().toLowerCase().slice(0, 20), note: r.note.slice(0, 400) }
}

/** The contact the conversation is filed to, for Claude's context and the document's link. */
async function threadContact(db: SupabaseClient, threadId: string): Promise<{ id: string; company: string; category: string; filing: 'file' | 'skip'; filing_note: string } | null> {
  const { data: t } = await db.from('email_threads').select('accounting_contact_id').eq('id', threadId).maybeSingle()
  if (!t?.accounting_contact_id) return null
  const { data: c } = await db.from('accounting_contacts').select('id, company, category, filing, filing_note').eq('id', t.accounting_contact_id).maybeSingle()
  return c ?? null
}

/**
 * One email: its attachments skipped, linked to a copy already on file, or read and filed. Every attachment ends with
 * a document or a reason, and the email is stamped so it is looked at once.
 */
async function fileMail(db: SupabaseClient, mail: Mail, opts: { only?: string; force: boolean }): Promise<{ filed: number; skipped: number; linked: number; errors: number; results: { attachment_id: string; document_id?: string; skip?: string; error?: string }[] }> {
  const org = mail.organization_id
  const results: { attachment_id: string; document_id?: string; skip?: string; error?: string }[] = []
  let filed = 0, skipped = 0, linked = 0, errors = 0
  const atts = mail.attachments.filter((a) => (opts.only ? a.id === opts.only : !a.accounting_document_id))
  const toRead: { a: Att; bytes: Uint8Array; sha: string; file: PaperFile }[] = []
  let gmail: Gmail | null = null
  // the conversation's contact: its category for Claude, and "leave their papers in the email" (Dana, Oct 16: Emery Jensen goes to bill.com)
  const contact = atts.length ? await threadContact(db, mail.thread_id) : null
  const handledElsewhere = contact?.filing === 'skip' && !opts.force ? (contact.filing_note.trim() || 'handled elsewhere') : null
  for (const a of atts) {
    try {
      const why = handledElsewhere ?? preSkip(a, mail, opts.force)
      if (why) {
        await db.from('email_attachments').update({ accounting_skip: why }).eq('id', a.id)
        results.push({ attachment_id: a.id, skip: why }); skipped++
        continue
      }
      if (!a.gmail_attachment_id) throw new Error('not available from Gmail')
      gmail ??= new Gmail(await googleAccessToken(mail.gmail_box ?? ''))
      const bytes = await attachmentBytes(gmail, mail.gmail_id, a.gmail_attachment_id)
      const sha = await sha256(bytes)
      // the same bytes already on file: link, never a second copy (Dana, Oct 14)
      const { data: same } = await db.from('accounting_documents').select('id').eq('organization_id', org).eq('sha256', sha).maybeSingle()
      if (same) {
        await db.from('email_attachments').update({ accounting_document_id: same.id, accounting_skip: null }).eq('id', a.id)
        results.push({ attachment_id: a.id, document_id: same.id }); linked++
        continue
      }
      toRead.push({ a, bytes, sha, file: await paperFile(a.file_name, a.mime_type, bytes) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await db.from('email_attachments').update({ accounting_skip: `error: ${msg.slice(0, 200)}` }).eq('id', a.id)
      results.push({ attachment_id: a.id, error: msg }); errors++
    }
  }
  if (toRead.length) {
    const known = await knownContext(db, org)
    const ctx: AccountingFileCtx = { from: mail.from_email, from_name: mail.from_name, direction: mail.direction, subject: mail.subject, received_on: mail.received_at.slice(0, 10), email_text: mail.body_text, contact: contact ? { company: contact.company, category: contact.category } : null, ...known }
    try {
      // a few files per call; a long email is read in rounds
      for (let i = 0; i < toRead.length; i += 6) {
        const batch = toRead.slice(i, i + 6)
        // keep the call within the worker's memory: past the budget, files go by name only
        let budget = MAX_CALL_BYTES
        for (const b of batch) { if (b.file.bytes.length > budget) b.file = { ...b.file, bytes: new Uint8Array(), text: undefined }; else budget -= b.file.bytes.length }
        let readings: AccountingPaperReading[]
        try {
          readings = await readAccountingPapers(db, org, ctx, batch.map((b) => b.file))
        } catch (err) {
          // a PDF Claude cannot open (damaged, odd encoding): read the email and the names instead, and say so
          if (!/PDF specified was not valid|could not process/i.test(err instanceof Error ? err.message : String(err))) throw err
          readings = (await readAccountingPapers(db, org, ctx, batch.map((b) => ({ ...b.file, bytes: new Uint8Array(), text: undefined }))))
            .map((r) => ({ ...r, sure: false, note: `${r.note ? `${r.note} ` : ''}The file itself could not be opened by Claude; filed by its name and the email.`.trim() }))
        }
        for (let j = 0; j < batch.length; j++) {
          const b = batch[j]
          const raw = readings.find((r) => r.file === j + 1)
          try {
            if (!raw) throw new Error('Claude gave no answer for this file')
            const r = cleanReading(raw, known, Number(mail.received_at.slice(0, 4)))
            if (!r.keep && !opts.force) {
              const why = (r.skip_reason || 'not a paper to keep').slice(0, 120)
              await db.from('email_attachments').update({ accounting_skip: why }).eq('id', b.a.id)
              results.push({ attachment_id: b.a.id, skip: why }); skipped++
              continue
            }
            const id = await storeDocument(db, org, b.bytes, b.sha, b.a.file_name, b.a.mime_type, r, ctx.received_on, { source: 'email', email_id: mail.id, attachment_id: b.a.id, contact_id: contact?.id ?? null })
            await db.from('email_attachments').update({ accounting_document_id: id, accounting_skip: null }).eq('id', b.a.id)
            results.push({ attachment_id: b.a.id, document_id: id }); filed++
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            await db.from('email_attachments').update({ accounting_skip: `error: ${msg.slice(0, 200)}` }).eq('id', b.a.id)
            results.push({ attachment_id: b.a.id, error: msg }); errors++
          }
        }
      }
    } catch (err) {
      // Claude could not read the email's files: each is marked so it shows in the conversation, and "File now" retries
      const msg = err instanceof Error ? err.message : String(err)
      for (const b of toRead) {
        if (results.some((r) => r.attachment_id === b.a.id)) continue
        await db.from('email_attachments').update({ accounting_skip: `error: ${msg.slice(0, 200)}` }).eq('id', b.a.id)
        results.push({ attachment_id: b.a.id, error: msg }); errors++
      }
    }
  }
  if (!opts.only) await db.from('emails').update({ accounting_filed_at: new Date().toISOString() }).eq('id', mail.id)
  return { filed, skipped, linked, errors, results }
}

/** The bytes go into the bucket under an opaque path; the folder and the name live on the row. */
async function storeDocument(db: SupabaseClient, org: string, bytes: Uint8Array, sha: string, originalName: string, mime: string | null, r: AccountingPaperReading, fallbackDate: string, src: { source: 'email' | 'upload'; email_id: string | null; attachment_id: string | null; contact_id: string | null; uploaded_by?: string | null }): Promise<string> {
  const ext = extOf(originalName, mime)
  const path = `${org}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime ?? 'application/octet-stream', upsert: false })
  if (upErr) throw new Error(`Saving ${originalName}: ${upErr.message}`)
  const { data, error } = await db.from('accounting_documents').insert({
    organization_id: org, ...rowFromReading(r, fallbackDate, ext), storage_path: path, mime_type: mime, size: bytes.length, sha256: sha, original_name: originalName,
    source: src.source, email_id: src.email_id, attachment_id: src.attachment_id, contact_id: src.contact_id, uploaded_by: src.uploaded_by ?? null,
  }).select('id').single()
  if (error) {
    await db.storage.from(BUCKET).remove([path])
    throw new Error(error.message)
  }
  return data.id
}

function rowFromReading(r: AccountingPaperReading, fallbackDate: string, ext: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.doc_date ?? '') ? r.doc_date : null
  return {
    category: r.category, party: r.party || 'Unsorted', doc_year: r.doc_year, file_name: documentName(r, fallbackDate, ext), kind: r.kind, whose: r.whose, doc_date: date,
    number: r.number, what: r.what, amount: r.amount, status_word: r.status_word, policy_id: r.policy_id, contract_id: r.contract_id,
    status: r.sure && r.party ? 'filed' : 'review', sure: r.sure, claude_note: r.note,
  }
}

/** A file dropped on the Documents page (already in the bucket, row status "new"): read it, name it, file it. */
async function fileUploaded(db: SupabaseClient, d: { id: string; organization_id: string; storage_path: string; original_name: string; file_name: string; mime_type: string | null; created_at: string }, hint: string | null) {
  const { data, error } = await db.storage.from(BUCKET).download(d.storage_path)
  if (error || !data) throw new Error(error?.message ?? 'File not found')
  const bytes = new Uint8Array(await data.arrayBuffer())
  const name = d.original_name || d.file_name
  const known = await knownContext(db, d.organization_id)
  const ctx: AccountingFileCtx = { from: null, from_name: null, direction: 'upload', subject: null, received_on: d.created_at.slice(0, 10), email_text: null, contact: null, hint, ...known }
  const [raw] = await readAccountingPapers(db, d.organization_id, ctx, [await paperFile(name, d.mime_type, bytes)])
  if (!raw) throw new Error('Claude gave no answer for this file')
  const r = cleanReading({ ...raw, keep: true }, known, Number(d.created_at.slice(0, 4)))
  const row = rowFromReading(r, ctx.received_on, extOf(name, d.mime_type))
  const { data: saved, error: uerr } = await db.from('accounting_documents').update(row).eq('id', d.id).select('*').single()
  if (uerr) throw new Error(uerr.message)
  return saved
}

/** An attachment's bytes from Gmail (base64url). */
async function attachmentBytes(gmail: Gmail, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const part = await gmail.call<{ data: string }>(`messages/${messageId}/attachments/${attachmentId}`)
  const b64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
