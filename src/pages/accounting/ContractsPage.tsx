import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { CONTRACT_KIND_LABELS, CONTRACT_STATUS_LABELS, listContracts, nextPayment, syncContractTasks } from '@/services/contracts'
import { daysUntil, money } from '@/lib/insurance'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

/** The contracts tracker (Dana, Oct 16): the SCE licenses first; leases, the loan and other contracts as they are added. */
export default function ContractsPage() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (organization ? listContracts(organization.id) : []), [organization?.id])
  useEffect(() => {
    if (organization) void syncContractTasks(organization.id).catch(() => {})
  }, [organization])
  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    label: (c) => c.label,
    kind: (c) => CONTRACT_KIND_LABELS[c.kind],
    party: (c) => c.other_party,
    term: (c) => c.term_end,
    next: (c) => nextPayment(c)?.due_on ?? null,
    status: (c) => c.status,
  })

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Contracts" description="Licenses, leases and the loan: term, who signs, what insurance they require, when each payment is due and when to start the renewal. Payment tasks appear 30 days ahead."
        actions={<Button onClick={() => navigate(`${ROUTES.accountingContracts}/new`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add contract</Button>} />
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">No contracts yet.</p>
        : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Contract" sortKey="label" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Kind" sortKey="kind" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
                  <SortHeader label="With" sortKey="party" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
                  <SortHeader label="Term ends" sortKey="term" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Next payment" sortKey="next" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((c) => {
                  const next = nextPayment(c)
                  const days = daysUntil(c.term_end)
                  const nextDays = daysUntil(next?.due_on)
                  return (
                    <tr key={c.id} className={cn('hover:bg-stone-50', (c.status === 'expired' || c.status === 'ended') && 'text-stone-400')}>
                      <td className="px-3 py-2">
                        <Link to={`${ROUTES.accountingContracts}/${c.id}`} className="font-medium text-stone-900 hover:text-brand">{c.label}</Link>
                        {c.contract_number ? <span className="block text-xs text-stone-500">#{c.contract_number}</span> : null}
                        {c.follow_up_on ? <span className="block text-xs text-amber-700">Follow up {new Date(`${c.follow_up_on}T00:00:00`).toLocaleDateString()}: {c.follow_up_note}</span> : null}
                      </td>
                      <td className="hidden px-3 py-2 text-stone-700 md:table-cell">{CONTRACT_KIND_LABELS[c.kind]}</td>
                      <td className="hidden px-3 py-2 text-stone-700 md:table-cell">{c.other_party}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {c.term_end ? new Date(`${c.term_end}T00:00:00`).toLocaleDateString() : '—'}
                        {days != null && c.status === 'active' && days <= c.renewal_lead_days ? <Badge tone={days < 0 ? 'danger' : 'warning'} className="ml-2">{days < 0 ? 'ended' : 'renewal window'}</Badge> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-800">
                        {next ? <>{money(next.amount)} <span className="text-xs text-stone-500">{new Date(`${next.due_on}T00:00:00`).toLocaleDateString()}{nextDays != null && nextDays <= 30 ? ` · in ${nextDays} days` : ''}</span></> : <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-3 py-2"><Badge tone={c.status === 'active' ? 'success' : c.status === 'pending' ? 'warning' : 'neutral'}>{CONTRACT_STATUS_LABELS[c.status]}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
