import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, FileText, Mail, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { useTableSort } from '@/hooks/useTableSort'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { deleteDocument, downloadDocument, updateDocument } from '@/services/accountingDocuments'
import { threadsOfEmails } from '@/services/insurance'
import { listPolicies } from '@/services/insurance'
import { listContracts } from '@/services/contracts'
import { choicesOf, docMoney, folderLabel, folderSearch, kindLabel, type DocumentChoice } from '@/lib/accountingDocuments'
import { categoryLabel } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { AccountingDocument } from '@/types'
import { SortHeader } from '@/components/shared/SortHeader'
import { Badge } from '@/components/ui'
import { DocumentEditDialog } from './DocumentEditDialog'

/**
 * A table of filed papers: click the name to open it, the folder to go there, the envelope to land on the email it
 * came from (Dana, Oct 16: no extra clicking). Edit moves or renames; "Looks right" clears a paper Claude was unsure of.
 */
function choiceTitle(c: DocumentChoice): string {
  const parts = [c.whose && `for ${c.whose}`, c.category && `under ${categoryLabel(c.category)}`, c.party && `folder ${c.party}`, c.what && `"${c.what}"`].filter(Boolean)
  return parts.length ? `Files it ${parts.join(', ')}` : 'Keeps it as filed'
}

export function DocumentRows({ docs, parties, showFolder = true, onChanged, empty = 'Nothing here yet.' }: {
  docs: AccountingDocument[]
  parties?: string[]
  showFolder?: boolean
  onChanged: () => void
  empty?: string
}) {
  const { organization } = useAuth()
  const { view, viewer } = useDocumentViewer()
  const [editing, setEditing] = useState<AccountingDocument | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const threads = useSupabaseQuery(() => threadsOfEmails(docs.map((d) => d.email_id).filter((x): x is string => !!x)), [docs.map((d) => d.email_id).join(',')])
  const policies = useSupabaseQuery(async () => (organization && editing ? listPolicies(organization.id, true) : []), [organization?.id, !!editing])
  const contracts = useSupabaseQuery(async () => (organization && editing ? listContracts(organization.id) : []), [organization?.id, !!editing])
  const { sorted, sort, toggle } = useTableSort(docs, {
    name: (d) => d.file_name,
    date: (d) => d.doc_date ?? '',
    kind: (d) => kindLabel(d.kind),
    amount: (d) => d.amount ?? -1,
    folder: (d) => folderLabel(d),
    filed: (d) => d.created_at,
  }, { descFirst: ['date', 'filed', 'amount'] })

  const open = (d: AccountingDocument) => view({ name: d.file_name, mime: d.mime_type, load: () => downloadDocument(d.storage_path) })
  async function looksRight(d: AccountingDocument) {
    setBusyId(d.id)
    try { await updateDocument(d.id, { status: 'filed', sure: true, question: '', choices: [] }); onChanged() } catch (e) { toast.error(errorMessage(e)) } finally { setBusyId(null) }
  }
  // one click settles Claude's doubt (Dana, Oct 27): the answer's fields are applied, the name follows the rule
  async function answer(d: AccountingDocument, c: DocumentChoice) {
    setBusyId(d.id)
    try {
      await updateDocument(d.id, {
        ...(c.whose ? { whose: c.whose as AccountingDocument['whose'] } : {}), ...(c.party ? { party: c.party } : {}),
        ...(c.category ? { category: c.category as AccountingDocument['category'] } : {}), ...(c.what ? { what: c.what } : {}),
        status: 'filed', sure: true, question: '', choices: [],
      })
      toast.success(c.label)
      onChanged()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusyId(null) }
  }
  async function remove(d: AccountingDocument) {
    if (!window.confirm(`Delete "${d.file_name}" from the Accounting files? The email it came from keeps its attachment.`)) return
    setBusyId(d.id)
    try { await deleteDocument(d); toast.success('Deleted'); onChanged() } catch (e) { toast.error(errorMessage(e)) } finally { setBusyId(null) }
  }

  if (!docs.length) return <p className="px-4 py-3 text-sm text-stone-500">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <SortHeader label="File" sortKey="name" sort={sort} onSort={toggle} className="px-4 py-2" />
            <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
            <SortHeader label="Kind" sortKey="kind" sort={sort} onSort={toggle} className="hidden px-3 py-2 lg:table-cell" />
            <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={toggle} align="right" className="hidden px-3 py-2 md:table-cell" />
            {showFolder ? <SortHeader label="Folder" sortKey="folder" sort={sort} onSort={toggle} className="hidden px-3 py-2 lg:table-cell" /> : null}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((d) => {
            const thread = d.email_id ? threads.data?.get(d.email_id) : null
            return (
              <tr key={d.id} className={d.status === 'review' ? 'bg-amber-50/40' : ''}>
                <td className="px-4 py-2">
                  <button type="button" onClick={() => open(d)} className="inline-flex max-w-full items-start gap-1.5 text-left font-medium text-stone-900 hover:text-brand">
                    <FileText className="mt-0.5 size-4 shrink-0 text-stone-400" aria-hidden="true" /><span className="break-words">{d.file_name}</span>
                  </button>
                  {d.status === 'review' ? <span className="mt-0.5 block text-xs text-amber-800"><Badge tone="warning" className="mr-1">Needs a look</Badge>{d.claude_note}</span> : d.claude_note ? <span className="mt-0.5 block text-xs text-stone-500">{d.claude_note}</span> : null}
                  {d.status === 'review' && d.question && choicesOf(d).length ? (
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-stone-900">{d.question}</span>
                      {choicesOf(d).map((c) => (
                        <button key={c.label} type="button" onClick={() => answer(d, c)} disabled={busyId === d.id} title={choiceTitle(c)}
                          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 hover:border-brand hover:text-brand disabled:opacity-50">{c.label}</button>
                      ))}
                    </span>
                  ) : null}
                  {d.original_name && d.original_name !== d.file_name ? <span className="block text-xs text-stone-400">was {d.original_name}</span> : null}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-stone-600 md:table-cell">{d.doc_date ? new Date(`${d.doc_date}T00:00:00`).toLocaleDateString() : '—'}</td>
                <td className="hidden px-3 py-2 text-stone-600 lg:table-cell">{kindLabel(d.kind)}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-right text-stone-700 md:table-cell">{docMoney(d.amount)}</td>
                {showFolder ? <td className="hidden px-3 py-2 lg:table-cell"><Link to={`${ROUTES.accountingDocuments}${folderSearch(d)}`} className="text-stone-600 hover:text-brand hover:underline">{folderLabel(d)}</Link></td> : null}
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-1">
                    {d.status === 'review' ? <button type="button" onClick={() => looksRight(d)} disabled={busyId === d.id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50" title="Keep it exactly as filed: this folder and this name"><Check className="size-3.5" aria-hidden="true" />Keep as filed</button> : null}
                    {thread ? <Link to={`${ROUTES.mail}/${thread}`} className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900" title="Open the email it came from" aria-label="Open the email it came from"><Mail className="size-4" aria-hidden="true" /></Link> : null}
                    <button type="button" onClick={() => setEditing(d)} className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900" title="Move or rename" aria-label="Move or rename"><Pencil className="size-4" aria-hidden="true" /></button>
                    <button type="button" onClick={() => remove(d)} disabled={busyId === d.id} className="rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-700" title="Delete" aria-label="Delete"><Trash2 className="size-4" aria-hidden="true" /></button>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {viewer}
      {editing ? (
        <DocumentEditDialog doc={editing} parties={parties ?? []} policies={(policies.data ?? []).map((p) => ({ id: p.id, label: p.label }))} contracts={(contracts.data ?? []).map((c) => ({ id: c.id, label: c.label }))}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged() }} />
      ) : null}
    </div>
  )
}
