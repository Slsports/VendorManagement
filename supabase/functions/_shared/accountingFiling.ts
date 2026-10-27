// Shared by accounting-file (billing@ attachments, the drop box) and dropbox (Dana's Dropbox): how a bookkeeping paper
// becomes an Accounting document (Category / Party / Year, named by the convention). Deno only.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { sheetFileText } from './sheetFile.ts'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_KINDS, imageType, type AccountingChoiceReading, type AccountingFileCtx, type AccountingPaperReading, type PaperFile } from './ai.ts'

export const ACCOUNTING_BUCKET = 'accounting-files'
// The edge worker has little memory (a run died with WORKER_RESOURCE_LIMIT on Oct 16): a file over 5 MB is read by its
// name and the email, and one Claude call carries at most 12 MB of files.
export const MAX_READ_BYTES = 5 * 1024 * 1024
export const MAX_CALL_BYTES = 12 * 1024 * 1024
export const MAX_KEEP_BYTES = 15 * 1024 * 1024

export const PICTURE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i
export const JUNK = /\.(ics|vcf|p7s|zip|html?|eml|txt|rtf|json|xml|asc|sig|gz|rar)$/i
export const SHEET = /\.(xlsx?|xlsm|csv)$/i
export const DOC = /\.(pdf|docx?)$/i

export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function extOf(name: string, mime: string | null): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name)
  if (m) return m[1].toLowerCase()
  if (/pdf/i.test(mime ?? '')) return 'pdf'
  const img = /image\/(png|jpeg|gif|webp)/i.exec(mime ?? '')
  return img ? img[1].toLowerCase().replace('jpeg', 'jpg') : 'bin'
}

/** The file as Claude can see it: a PDF or picture as itself, a spreadsheet as its text, anything else by name only. */
export async function paperFile(name: string, mime: string | null, bytes: Uint8Array): Promise<PaperFile> {
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

/** What Claude is told about the business's own records, so parties, policies and contracts come out consistent. */
export async function knownContext(db: SupabaseClient, org: string): Promise<Pick<AccountingFileCtx, 'known_parties' | 'policies' | 'contracts'>> {
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

export const money = (n: number | null) => n == null ? null : n === Math.trunc(n) ? `$${Math.trunc(n)}` : `$${n.toFixed(2)}`

/** "<date> <whose> <party> <number> <what> $<amount> <status>.<ext>" (decisions, Oct 16), every piece optional but the date. */
export function documentName(r: AccountingPaperReading, fallbackDate: string, ext: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.doc_date ?? '') ? r.doc_date! : fallbackDate
  const parts = [date, r.whose, r.party, r.number, r.what, money(r.amount), r.status_word].map((p) => (p ?? '').trim()).filter(Boolean)
  return `${parts.join(' ').replace(/[/\\:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()}.${ext}`
}

export function cleanReading(r: AccountingPaperReading, ctx: Pick<AccountingFileCtx, 'policies' | 'contracts'>, year: number): AccountingPaperReading {
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

/** Claude's answers brought to what the buttons accept: a label, fields only from the lists, at most four, none when sure. */
export function cleanChoices(question: string, choices: AccountingChoiceReading[] | undefined, sure: boolean): { question: string; choices: AccountingChoiceReading[] } {
  if (sure || !question.trim() || !choices?.length) return { question: '', choices: [] }
  const out = choices.slice(0, 4).map((c) => ({
    label: c.label.trim().slice(0, 40),
    whose: ['SLS', 'P&S', 'SLM', 'GS'].includes(c.whose.trim().toUpperCase()) ? c.whose.trim().toUpperCase() : '',
    party: c.party.replace(/[/\\]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80),
    category: (ACCOUNTING_CATEGORIES as readonly string[]).includes(c.category) ? c.category : '',
    what: c.what.trim().slice(0, 80),
  })).filter((c) => c.label)
  return out.length >= 2 ? { question: question.trim().slice(0, 200), choices: out } : { question: '', choices: [] }
}

export function rowFromReading(r: AccountingPaperReading, fallbackDate: string, ext: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.doc_date ?? '') ? r.doc_date : null
  return {
    category: r.category, party: r.party || 'Unsorted', doc_year: r.doc_year, file_name: documentName(r, fallbackDate, ext), kind: r.kind, whose: r.whose, doc_date: date,
    number: r.number, what: r.what, amount: r.amount, status_word: r.status_word, policy_id: r.policy_id, contract_id: r.contract_id,
    status: r.sure && r.party ? 'filed' : 'review', sure: r.sure, claude_note: r.note,
    ...cleanChoices(r.question ?? '', r.choices, r.sure),
  }
}
