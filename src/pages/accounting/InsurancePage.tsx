import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Plus, Search, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listPolicies, listRecipients, proposeRecipients, saveRecipient, syncPolicyTasks, type PolicyRow } from '@/services/insurance'
import { listProcedures } from '@/services/procedures'
import { coverageLabel, daysUntil, latestTerm, money, termFor } from '@/lib/insurance'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import type { AccountingPolicyRecipient } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

type Tab = 'policies' | 'who'

/** The insurance tracker (Dana, Oct 16): every policy and its renewal, and who must get proof each year. */
export default function InsurancePage() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'who' ? 'who' : 'policies'
  const [showInactive, setShowInactive] = useState(false)
  const policies = useSupabaseQuery(async () => (organization ? listPolicies(organization.id, showInactive) : []), [organization?.id, showInactive])
  const recipients = useSupabaseQuery(async () => (organization ? listRecipients(organization.id) : []), [organization?.id])
  const [busy, setBusy] = useState(false)
  const procedures = useSupabaseQuery(async () => (organization ? listProcedures(organization.id) : []), [organization?.id])
  const renewalProc = (procedures.data ?? []).find((p) => p.slug === 'property-insurance-renewal')
  const proofProc = (procedures.data ?? []).find((p) => p.slug === 'send-proof-of-insurance')

  // renewal tasks for anything within 45 days, every time the page opens (the daily job does the same)
  useEffect(() => {
    if (organization) void syncPolicyTasks(organization.id).catch(() => {})
  }, [organization])

  function setTab(t: Tab) {
    const next = new URLSearchParams(params)
    if (t === 'policies') next.delete('tab'); else next.set('tab', t)
    setParams(next, { replace: true })
  }

  async function findRequesters() {
    if (!organization) return
    setBusy(true)
    try {
      const n = await proposeRecipients(organization.id)
      toast.success(n ? `${n} found in the mail, to confirm` : 'Nobody new asked for proof in the mail')
      await recipients.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function quick(r: AccountingPolicyRecipient, status: AccountingPolicyRecipient['status']) {
    if (!organization) return
    try {
      await saveRecipient(organization.id, r.id, { status })
      toast.success(status === 'confirmed' ? 'Confirmed' : status === 'ignored' ? 'Ignored' : 'Saved')
      await recipients.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Insurance" description="Every policy, when it renews, what it cost and who paid. Renewal tasks appear 30 days ahead. Who needs proof gets a send task when the new policy comes in."
        actions={tab === 'policies'
          ? <Button onClick={() => navigate(`${ROUTES.accountingInsurance}/new`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add policy</Button>
          : <div className="flex gap-2">
              <Button variant="secondary" loading={busy} onClick={() => void findRequesters()} leftIcon={<Search className="size-4" aria-hidden="true" />}>Find requesters in the mail</Button>
              <Button onClick={() => navigate(`${ROUTES.accountingInsurance}/who/new`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add someone</Button>
            </div>} />
      <nav aria-label="Insurance" className="mb-4 flex flex-wrap items-center gap-3">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {[{ v: 'policies' as Tab, label: 'Policies' }, { v: 'who' as Tab, label: `Who needs proof${(recipients.data ?? []).some((r) => r.status === 'proposed') ? ` (${(recipients.data ?? []).filter((r) => r.status === 'proposed').length} to confirm)` : ''}` }].map((t) => (
            <li key={t.v}>
              <button type="button" onClick={() => setTab(t.v)} aria-current={tab === t.v ? 'page' : undefined}
                className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', tab === t.v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
        <span className="text-sm text-stone-600">
          Procedures:{' '}
          {renewalProc ? <Link to={`${ROUTES.accountingProcedures}/${renewalProc.id}`} className="text-brand hover:underline">renewal</Link> : null}
          {renewalProc && proofProc ? ' · ' : null}
          {proofProc ? <Link to={`${ROUTES.accountingProcedures}/${proofProc.id}`} className="text-brand hover:underline">proof of insurance</Link> : null}
        </span>
      </nav>
      {tab === 'policies' ? (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" className="size-4 accent-brand" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show retired policies</label>
          {policies.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
            : policies.error ? <Alert variant="error">{policies.error}</Alert>
            : <PolicyTable rows={policies.data ?? []} />}
        </>
      ) : (
        recipients.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
          : recipients.error ? <Alert variant="error">{recipients.error}</Alert>
          : <RecipientTable rows={recipients.data ?? []} policies={policies.data ?? []} onQuick={quick} />
      )}
    </div>
  )
}

function PolicyTable({ rows }: { rows: PolicyRow[] }) {
  const { sorted, sort, toggle } = useTableSort(rows, {
    label: (p) => p.label,
    type: (p) => coverageLabel(p.coverage_type),
    carrier: (p) => p.carrier,
    renewal: (p) => p.renewal_date,
    paidBy: (p) => p.paid_by,
    premium: (p) => latestTerm(p.terms)?.premium ?? null,
    number: (p) => p.policy_number,
  })
  if (!rows.length) return <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">No policies yet. Add one, or send Claude the insurance guide.</p>
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <SortHeader label="Policy" sortKey="label" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Type" sortKey="type" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
            <SortHeader label="Carrier" sortKey="carrier" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
            <SortHeader label="Renews" sortKey="renewal" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Paid by" sortKey="paidBy" sort={sort} onSort={toggle} className="hidden px-3 py-2 sm:table-cell" />
            <SortHeader label="Latest premium" sortKey="premium" sort={sort} onSort={toggle} align="right" className="px-3 py-2" />
            <SortHeader label="Policy #" sortKey="number" sort={sort} onSort={toggle} className="hidden px-3 py-2 lg:table-cell" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((p) => {
            const days = daysUntil(p.renewal_date)
            const term = latestTerm(p.terms)
            const thisTerm = termFor(p.renewal_date ? `${Number(p.renewal_date.slice(0, 4)) - 1}` : null)
            const paidThisTerm = p.terms.some((t) => t.term_label === thisTerm && t.paid_on)
            return (
              <tr key={p.id} className={cn('hover:bg-stone-50', !p.is_active && 'text-stone-400')}>
                <td className="px-3 py-2">
                  <Link to={`${ROUTES.accountingInsurance}/${p.id}`} className="font-medium text-stone-900 hover:text-brand">{p.label}</Link>
                  <span className="block text-xs text-stone-500">{p.property}{p.autopay ? ' · autopay' : ''}</span>
                </td>
                <td className="hidden px-3 py-2 text-stone-700 md:table-cell">{coverageLabel(p.coverage_type)}</td>
                <td className="hidden px-3 py-2 text-stone-700 md:table-cell">{p.carrier}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {p.renewal_date ? new Date(`${p.renewal_date}T00:00:00`).toLocaleDateString() : '—'}
                  {days != null && p.is_active ? <Badge tone={days < 0 ? 'danger' : days <= 30 ? 'warning' : 'neutral'} className="ml-2">{days < 0 ? `${-days} days ago` : days === 0 ? 'today' : `in ${days} days`}</Badge> : null}
                </td>
                <td className="hidden px-3 py-2 text-stone-700 sm:table-cell">{p.paid_by}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-stone-800">
                  {term ? <>{money(term.premium)}<span className="block text-xs text-stone-500">{term.term_label}{term.paid_on ? ` · paid ${new Date(`${term.paid_on}T00:00:00`).toLocaleDateString()}` : paidThisTerm ? '' : ' · not paid'}</span></> : '—'}
                </td>
                <td className="hidden px-3 py-2 text-stone-600 lg:table-cell">{p.policy_number}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RecipientTable({ rows, policies, onQuick }: { rows: AccountingPolicyRecipient[]; policies: PolicyRow[]; onQuick: (r: AccountingPolicyRecipient, s: AccountingPolicyRecipient['status']) => Promise<void> }) {
  const label = (id: string) => policies.find((p) => p.id === id)?.label ?? 'a policy'
  const { sorted, sort, toggle } = useTableSort(rows, {
    status: (r) => (r.status === 'proposed' ? 0 : r.status === 'confirmed' ? 1 : 2),
    who: (r) => r.company || r.person,
    email: (r) => r.email,
    policies: (r) => r.policy_ids.length,
    last: (r) => r.last_sent_on,
    asked: (r) => r.asked_at,
  })
  if (!rows.length) return <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">Nobody on the list yet. Click Find requesters in the mail, or add someone.</p>
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Who" sortKey="who" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Email" sortKey="email" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
            <SortHeader label="Needs" sortKey="policies" sort={sort} onSort={toggle} className="hidden px-3 py-2 lg:table-cell" />
            <SortHeader label="Last sent" sortKey="last" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Asked" sortKey="asked" sort={sort} onSort={toggle} className="px-3 py-2" />
            <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((r) => (
            <tr key={r.id} className={cn('hover:bg-stone-50', r.status === 'ignored' && 'text-stone-400')}>
              <td className="px-3 py-2"><Badge tone={r.status === 'confirmed' ? 'success' : r.status === 'proposed' ? 'warning' : 'neutral'}>{r.status === 'proposed' ? 'To confirm' : r.status === 'confirmed' ? 'Confirmed' : 'Ignored'}</Badge></td>
              <td className="px-3 py-2">
                <Link to={`${ROUTES.accountingInsurance}/who/${r.id}`} className="font-medium text-stone-900 hover:text-brand">{r.company || r.person || r.email}</Link>
                {r.company && r.person ? <span className="block text-xs text-stone-500">{r.person}</span> : null}
                {r.why ? <span className="block text-xs text-stone-500">{r.why}</span> : null}
              </td>
              <td className="hidden px-3 py-2 text-stone-600 md:table-cell">{r.email}</td>
              <td className="hidden px-3 py-2 text-stone-600 lg:table-cell">{r.policy_ids.length ? r.policy_ids.map(label).join(', ') : <span className="text-stone-400">not set</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.last_sent_on ? `${new Date(`${r.last_sent_on}T00:00:00`).toLocaleDateString()}${r.last_sent_term ? ` (${r.last_sent_term})` : ''}${r.last_sent_by === 'agent' ? ' by Hub' : ''}` : <span className="text-stone-400">never</span>}</td>
              <td className="whitespace-nowrap px-3 py-2">{r.asked_at ? <Badge tone="danger">They asked {new Date(r.asked_at).toLocaleDateString()}</Badge> : ''}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {r.status === 'proposed' ? (
                  <span className="inline-flex gap-1">
                    <button type="button" onClick={() => void onQuick(r, 'confirmed')} title="Confirm" aria-label={`Confirm ${r.company || r.email}`} className="rounded-md p-1 text-stone-400 hover:bg-emerald-50 hover:text-emerald-700"><Check className="size-4" aria-hidden="true" /></button>
                    <button type="button" onClick={() => void onQuick(r, 'ignored')} title="Ignore" aria-label={`Ignore ${r.company || r.email}`} className="rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-700"><X className="size-4" aria-hidden="true" /></button>
                  </span>
                ) : r.status === 'ignored' ? <Button size="sm" variant="ghost" onClick={() => void onQuick(r, 'confirmed')}>Bring back</Button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
