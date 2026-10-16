import { useState } from 'react'
import toast from 'react-hot-toast'
import { updateDocument } from '@/services/accountingDocuments'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_CATEGORY_LABELS } from '@/lib/accounting'
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, WHOSE_LABELS, WHOSE_OPTIONS } from '@/lib/accountingDocuments'
import { errorMessage } from '@/lib/utils'
import type { AccountingCategory, AccountingDocument, AccountingDocumentKind, AccountingWhose } from '@/types'
import { Modal } from '@/components/shared/Modal'
import { FormField, Input, Select } from '@/components/ui'

/**
 * Move or rename a filed paper (Dana, Oct 16). Changing the facts (date, who, party, number, what, amount, state)
 * renames the file by the convention on its own; typing a name keeps that name. The file itself never moves.
 */
export function DocumentEditDialog({ doc, parties, policies, contracts, onClose, onSaved }: {
  doc: AccountingDocument
  parties: string[]
  policies: { id: string; label: string }[]
  contracts: { id: string; label: string }[]
  onClose: () => void
  onSaved: (d: AccountingDocument) => void
}) {
  const [f, setF] = useState({
    category: doc.category as AccountingCategory, party: doc.party, doc_year: String(doc.doc_year), whose: doc.whose as AccountingWhose, kind: doc.kind as AccountingDocumentKind,
    doc_date: doc.doc_date ?? '', number: doc.number, what: doc.what, amount: doc.amount == null ? '' : String(doc.amount), status_word: doc.status_word,
    policy_id: doc.policy_id ?? '', contract_id: doc.contract_id ?? '', file_name: doc.file_name,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    const year = Number(f.doc_year)
    if (!Number.isInteger(year) || year < 1990 || year > 2100) { toast.error('Enter the year the paper is about'); return }
    if (!f.party.trim()) { toast.error('Enter the party (the folder under the category)'); return }
    const amount = f.amount.trim() === '' ? null : Number(f.amount.replace(/[$,]/g, ''))
    if (amount != null && !Number.isFinite(amount)) { toast.error('The amount must be a number'); return }
    setBusy(true)
    try {
      const saved = await updateDocument(doc.id, {
        category: f.category, party: f.party.trim(), doc_year: year, whose: f.whose, kind: f.kind, doc_date: f.doc_date || null, number: f.number.trim(), what: f.what.trim(), amount, status_word: f.status_word.trim().toLowerCase(),
        policy_id: f.policy_id || null, contract_id: f.contract_id || null,
        // only a name typed here is sent; left alone, the name follows the facts
        ...(f.file_name.trim() && f.file_name.trim() !== doc.file_name ? { file_name: f.file_name.trim() } : {}),
        status: 'filed',
      })
      toast.success('Saved')
      onSaved(saved)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Move or rename" submitLabel="Save" busy={busy} onSubmit={save} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Category" htmlFor="d-cat">
          <Select id="d-cat" value={f.category} onChange={(e) => set('category', e.target.value as AccountingCategory)}>
            {ACCOUNTING_CATEGORIES.map((c) => <option key={c} value={c}>{ACCOUNTING_CATEGORY_LABELS[c]}</option>)}
          </Select>
        </FormField>
        <FormField label="Year it is about" htmlFor="d-year"><Input id="d-year" inputMode="numeric" value={f.doc_year} onChange={(e) => set('doc_year', e.target.value)} /></FormField>
      </div>
      <FormField label="Party (the folder: Cal Fair, SCE Licensing, Hub)" htmlFor="d-party">
        <Input id="d-party" list="d-parties" value={f.party} onChange={(e) => set('party', e.target.value)} />
        <datalist id="d-parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Who it is for" htmlFor="d-whose">
          <Select id="d-whose" value={f.whose} onChange={(e) => set('whose', e.target.value as AccountingWhose)}>
            {WHOSE_OPTIONS.map((w) => <option key={w} value={w}>{WHOSE_LABELS[w]}</option>)}
          </Select>
        </FormField>
        <FormField label="Kind of paper" htmlFor="d-kind">
          <Select id="d-kind" value={f.kind} onChange={(e) => set('kind', e.target.value as AccountingDocumentKind)}>
            {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABELS[k]}</option>)}
          </Select>
        </FormField>
        <FormField label="Date on it" htmlFor="d-date"><Input id="d-date" type="date" value={f.doc_date} onChange={(e) => set('doc_date', e.target.value)} /></FormField>
        <FormField label="Number (policy, account, license)" htmlFor="d-num"><Input id="d-num" value={f.number} onChange={(e) => set('number', e.target.value)} /></FormField>
      </div>
      <FormField label="What it is for (a few words)" htmlFor="d-what"><Input id="d-what" value={f.what} onChange={(e) => set('what', e.target.value)} placeholder="SLS Building, License 2028-2032" /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Amount" htmlFor="d-amt"><Input id="d-amt" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="4472 or 6045.31" /></FormField>
        <FormField label="State (paid, executed, due)" htmlFor="d-state"><Input id="d-state" value={f.status_word} onChange={(e) => set('status_word', e.target.value)} /></FormField>
      </div>
      {policies.length ? (
        <FormField label="Insurance policy it belongs to" htmlFor="d-pol">
          <Select id="d-pol" value={f.policy_id} onChange={(e) => set('policy_id', e.target.value)}>
            <option value="">—</option>
            {policies.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </FormField>
      ) : null}
      {contracts.length ? (
        <FormField label="Contract it belongs to" htmlFor="d-con">
          <Select id="d-con" value={f.contract_id} onChange={(e) => set('contract_id', e.target.value)}>
            <option value="">—</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </FormField>
      ) : null}
      <FormField label="File name" htmlFor="d-name" hint="Leave it alone and it follows the facts above by the naming rule; type one to keep your own.">
        <Input id="d-name" value={f.file_name} onChange={(e) => set('file_name', e.target.value)} />
      </FormField>
    </Modal>
  )
}
