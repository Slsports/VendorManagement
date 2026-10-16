import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Plus, Search, UserRoundSearch, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listAccountingContacts, proposeAccountingContacts, rematchAccountingMail, setAccountingContactStatus, type ContactStatus } from '@/services/accounting'
import { categoryLabel } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

const TABS: { value: ContactStatus; label: string }[] = [
  { value: 'proposed', label: 'To confirm' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'ignored', label: 'Ignored' },
]

/** The people and companies Dana deals with in billing@ (Oct 16): proposed from the mail, confirmed by her. */
export default function AccountingContactsPage() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? 'proposed') as ContactStatus
  const search = (params.get('q') ?? '').toLowerCase()
  const [draft, setDraft] = useState(params.get('q') ?? '')
  const [busy, setBusy] = useState(false)
  const q = useSupabaseQuery(async () => (organization ? listAccountingContacts(organization.id, status) : []), [organization?.id, status])
  const rows = (q.data ?? []).filter((c) => !search || `${c.company} ${c.person} ${c.role}`.toLowerCase().includes(search))
  const { sorted, sort, toggle } = useTableSort(rows, {
    company: (c) => c.company,
    person: (c) => c.person,
    role: (c) => c.role,
    category: (c) => categoryLabel(c.category),
    messages: (c) => c.message_count,
    last: (c) => c.last_contact_at,
  }, { descFirst: ['messages', 'last'] })

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  async function findNew() {
    if (!organization) return
    setBusy(true)
    try {
      const n = await proposeAccountingContacts(organization.id)
      toast.success(n ? `${n} new to confirm` : 'Nobody new in the mail')
      if (status !== 'proposed') setParam('status', 'proposed')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function quick(id: string, next: ContactStatus, label: string) {
    if (!organization) return
    try {
      await setAccountingContactStatus(id, next)
      await rematchAccountingMail(organization.id)
      toast.success(label)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Accounting contacts" description="Who you deal with in billing@: the accounting firm, insurance, banks, payroll, and the rest. Confirm the ones VMS found; their mail sorts by the category you give them."
        actions={<div className="flex gap-2">
          <Button variant="secondary" loading={busy} onClick={() => void findNew()} leftIcon={<UserRoundSearch className="size-4" aria-hidden="true" />}>Find new in the mail</Button>
          <Button onClick={() => navigate(`${ROUTES.accountingContacts}/new`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add contact</Button>
        </div>} />
      <nav aria-label="Contact status" className="mb-3">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {TABS.map((t) => (
            <li key={t.value}>
              <button type="button" onClick={() => setParam('status', t.value)} aria-current={status === t.value ? 'page' : undefined}
                className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', status === t.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <form onSubmit={(e) => { e.preventDefault(); setParam('q', draft.trim()) }} className="mb-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value) setParam('q', '') }} placeholder="Company, person or role…" aria-label="Search contacts" className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm" />
        </div>
      </form>
      {status === 'proposed' ? <p className="mb-3 text-sm text-stone-600">VMS found these in the mail. Open one to fix the name, give it a category and confirm it, or tick ✓ to confirm as is. Newsletters and one-off senders are not listed.</p> : null}
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : sorted.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">{status === 'proposed' ? 'Nothing to confirm. Click Find new in the mail after more mail has come in.' : 'Nobody here yet.'}</p>
        : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Company" sortKey="company" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Person" sortKey="person" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Role" sortKey="role" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
                  <SortHeader label="Category" sortKey="category" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Emails" sortKey="messages" sort={sort} onSort={toggle} align="right" className="px-3 py-2" />
                  <SortHeader label="Last" sortKey="last" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2"><Link to={`${ROUTES.accountingContacts}/${c.id}`} className="font-medium text-stone-900 hover:text-brand">{c.company || <span className="text-stone-400">(no company)</span>}</Link></td>
                    <td className="px-3 py-2 text-stone-800">{c.person || '—'}</td>
                    <td className="hidden px-3 py-2 text-stone-600 md:table-cell">{c.role || '—'}</td>
                    <td className="px-3 py-2"><Badge tone={c.category === 'other' ? 'neutral' : 'brand'}>{categoryLabel(c.category)}</Badge></td>
                    <td className="px-3 py-2 text-right text-stone-700">{c.message_count}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{c.last_contact_at ? new Date(c.last_contact_at).toLocaleDateString() : ''}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {status === 'proposed' ? (
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => void quick(c.id, 'confirmed', 'Confirmed')} title="Confirm as is" aria-label={`Confirm ${c.company || c.person}`} className="rounded-md p-1 text-stone-400 hover:bg-emerald-50 hover:text-emerald-700"><Check className="size-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => void quick(c.id, 'ignored', 'Ignored')} title="Ignore" aria-label={`Ignore ${c.company || c.person}`} className="rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-700"><X className="size-4" aria-hidden="true" /></button>
                        </span>
                      ) : status === 'ignored' ? (
                        <Button size="sm" variant="ghost" onClick={() => void quick(c.id, 'confirmed', 'Back on the list')}>Bring back</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
