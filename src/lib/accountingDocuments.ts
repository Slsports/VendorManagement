import type { AccountingDocument, AccountingDocumentKind, AccountingWhose } from '@/types'
import { categoryLabel } from '@/lib/accounting'

export const DOCUMENT_KINDS: readonly AccountingDocumentKind[] = ['invoice', 'receipt', 'statement', 'policy', 'certificate', 'license', 'contract', 'quote', 'letter', 'form', 'tax_return', 'notice', 'report', 'check', 'other']

export const DOCUMENT_KIND_LABELS: Record<AccountingDocumentKind, string> = {
  invoice: 'Invoice', receipt: 'Receipt', statement: 'Statement', policy: 'Policy', certificate: 'Certificate', license: 'License', contract: 'Contract',
  quote: 'Quote', letter: 'Letter', form: 'Form', tax_return: 'Tax return', notice: 'Notice', report: 'Report', check: 'Check', other: 'Other',
}

export const WHOSE_OPTIONS: readonly AccountingWhose[] = ['', 'SLS', 'P&S', 'SLM', 'GS']
export const WHOSE_LABELS: Record<AccountingWhose, string> = { '': '—', SLS: 'SLS (Shaver Lake Sports)', 'P&S': 'P&S (Powell & Son Properties)', SLM: 'SLM (Shaver Lake Marina)', GS: 'GS (Happy Camper General Store)' }

export const kindLabel = (k: string | null | undefined) => DOCUMENT_KIND_LABELS[k as AccountingDocumentKind] ?? 'Other'

/** "Insurance › Cal Fair › 2026" */
export function folderLabel(d: Pick<AccountingDocument, 'category' | 'party' | 'doc_year'>): string {
  return `${categoryLabel(d.category)} › ${d.party || 'Unsorted'} › ${d.doc_year}`
}

/** The Documents page opened at this document's folder. */
export function folderSearch(d: Pick<AccountingDocument, 'category' | 'party' | 'doc_year'>): string {
  const p = new URLSearchParams({ category: d.category, party: d.party, year: String(d.doc_year) })
  return `?${p.toString()}`
}

/** $4472 or $6045.31: whole dollars unless cents were paid (Dana, Oct 16). */
export function docMoney(n: number | null | undefined): string {
  if (n == null) return ''
  const v = Number(n)
  return v === Math.trunc(v) ? `$${Math.trunc(v).toLocaleString()}` : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** An answer button: the fields that change when it is picked ('' = unchanged). */
export interface DocumentChoice { label: string; whose: string; party: string; category: string; what: string }
export function choicesOf(d: Pick<AccountingDocument, 'choices'>): DocumentChoice[] {
  if (!Array.isArray(d.choices)) return []
  return d.choices.flatMap((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return []
    const o = c as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
    return str('label') ? [{ label: str('label'), whose: str('whose'), party: str('party'), category: str('category'), what: str('what') }] : []
  })
}
