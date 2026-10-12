import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { addSupply, countSupplies, listSupplies, setSupply, type SupplyView } from '@/services/supplies'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Modal } from '@/components/shared/Modal'
import { Alert, Badge, Button, FormField, Input, Spinner } from '@/components/ui'
import type { SupplyRequest } from '@/types'
import { AmazonTab } from './AmazonTab'

const TABS: { v: SupplyView; label: string }[] = [
  { v: 'requested', label: 'To order' },
  { v: 'ordered', label: 'Ordered' },
  { v: 'arrived', label: 'Arrived' },
  { v: 'all', label: 'All' },
]
type Tab = SupplyView | 'amazon'
const date = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const STATUS: Record<SupplyRequest['status'], { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' }> = {
  requested: { label: 'To order', tone: 'warning' }, ordered: { label: 'Ordered', tone: 'info' }, arrived: { label: 'Arrived', tone: 'success' }, closed: { label: 'Closed', tone: 'neutral' },
}

/**
 * Supplies (Dana, Oct 12): what staff asked for, from their email to the order and its arrival. Claude reads staff
 * emails into requests (a task for Dana, due in 2 days) and order confirmations onto them; the person who asked gets
 * an email when it is ordered.
 */
export default function SuppliesPage() {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('show') === 'amazon' ? 'amazon' : (TABS.find((t) => t.v === params.get('show'))?.v ?? 'requested')
  const view: SupplyView = tab === 'amazon' ? 'all' : tab
  const q = useSupabaseQuery(async () => (organization ? listSupplies(organization.id, view) : []), [organization?.id, view])
  const counts = useSupabaseQuery(async () => (organization ? countSupplies(organization.id) : null), [organization?.id])
  const [adding, setAdding] = useState(false)
  const [ordering, setOrdering] = useState<SupplyRequest | null>(null)
  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    asked: (r) => r.requested_at, what: (r) => r.summary, who: (r) => r.requested_by_name, status: (r) => r.status,
    from: (r) => r.ordered_from, expected: (r) => r.expected_at,
  }, { descFirst: ['asked', 'expected'] })

  function setView(v: Tab) {
    const next = new URLSearchParams(params)
    if (v === 'requested') next.delete('show'); else next.set('show', v)
    setParams(next, { replace: true })
  }
  async function act(p: Promise<unknown>, msg: string) {
    try { await p; toast.success(msg); await Promise.all([q.refetch(), counts.refetch()]) } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <PageHeader title="Supplies" description="Supplies the staff ask for. Claude turns their emails into requests and fills in the order from the confirmation email; the person who asked is told when it is ordered."
        actions={canEdit ? <Button onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>New request</Button> : undefined} />
      <nav aria-label="Which requests" className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {[...TABS, { v: 'amazon' as const, label: 'Amazon' }].map((t) => {
            const n = t.v === 'all' || t.v === 'amazon' ? null : counts.data?.[t.v]
            return (
              <li key={t.v}><button type="button" onClick={() => setView(t.v)} aria-current={tab === t.v ? 'page' : undefined}
                className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', tab === t.v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                {t.label}{n !== null && n !== undefined ? <span className="ml-1.5 text-xs font-normal text-stone-500">{n}</span> : null}
              </button></li>
            )
          })}
        </ul>
      </nav>

      {tab === 'amazon' ? <AmazonTab />
        : q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading supplies…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">{view === 'requested' ? 'Nothing to order.' : 'Nothing here.'}</p>
        : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Asked" sortKey="asked" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="What" sortKey="what" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Who" sortKey="who" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Ordered from" sortKey="from" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Arrives" sortKey="expected" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{date(r.requested_at)}</td>
                    <td className="min-w-48 px-3 py-2">
                      <span className="font-medium text-stone-900">{r.summary}</span>
                      {r.thread_id ? <Link to={`${ROUTES.mail}/${r.thread_id}`} className="ml-2 text-xs text-brand hover:underline">request email</Link> : null}
                      {r.is_old && r.status === 'requested' ? <span className="mt-0.5 block text-xs text-stone-500">From before Supplies; no confirmation found in the mail.</span> : null}
                      {r.notified_at ? <span className="mt-0.5 block text-xs text-stone-500">Emailed {r.requested_by_name?.split(' ')[0] ?? 'them'} {date(r.notified_at)}</span> : null}
                      {r.notify_error ? <span className="mt-0.5 block text-xs text-red-700" title={r.notify_error}>The email to {r.requested_by_name ?? 'them'} did not go out</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.requested_by_name ?? ''}{r.store_code ? <span className="text-xs text-stone-500"> · {r.store_code}</span> : null}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    <td className="px-3 py-2 text-stone-700">
                      {r.ordered_from ?? ''}{r.order_number ? <span className="block text-xs text-stone-500">#{r.order_number}</span> : null}
                      {r.ordered_at ? <span className="block text-xs text-stone-500">{date(r.ordered_at)}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.status === 'arrived' ? <span className="text-emerald-700">Arrived {date(r.arrived_at)}</span> : date(r.expected_at)}{r.tracking ? <span className="block text-xs text-stone-500">{r.tracking}</span> : null}</td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <span className="flex flex-wrap justify-end gap-1">
                          {r.status === 'requested' ? <Button size="sm" variant="secondary" onClick={() => setOrdering(r)}>Ordered</Button> : null}
                          {r.status === 'ordered' ? <Button size="sm" variant="secondary" onClick={() => void act(setSupply(r.id, 'arrived'), 'Marked arrived')}>Arrived</Button> : null}
                          {r.status === 'requested' || r.status === 'ordered' ? <Button size="sm" variant="ghost" onClick={() => void act(setSupply(r.id, 'closed'), 'Closed')}>Close</Button> : null}
                          {r.status === 'arrived' || r.status === 'closed' ? <Button size="sm" variant="ghost" onClick={() => void act(setSupply(r.id, r.ordered_at ? 'ordered' : 'requested'), 'Opened again')}>Open again</Button> : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {adding && organization ? <AddDialog onClose={() => setAdding(false)} onSave={(what, who, store) => act(addSupply(organization.id, what, who, store).then(() => setAdding(false)), 'Request added; it is on your tasks')} /> : null}
      {ordering ? <OrderedDialog request={ordering} onClose={() => setOrdering(null)} onSave={(from, order, expected) => act(setSupply(ordering.id, 'ordered', { from, order, expected }).then(() => setOrdering(null)), 'Marked ordered')} /> : null}
    </div>
  )
}

function AddDialog({ onClose, onSave }: { onClose: () => void; onSave: (what: string, who: string | null, store: string | null) => Promise<void> }) {
  const [what, setWhat] = useState('')
  const [who, setWho] = useState('')
  const [store, setStore] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="New supply request" submitLabel="Add request" busy={busy} onClose={onClose}
      onSubmit={async () => { setBusy(true); try { await onSave(what, who || null, store || null) } finally { setBusy(false) } }}>
      <div className="space-y-3">
        <FormField label="What is needed" htmlFor="sp-what"><Input id="sp-what" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Bubble wrap, register tape" required autoFocus /></FormField>
        <FormField label="Who asked" htmlFor="sp-who"><Input id="sp-who" value={who} onChange={(e) => setWho(e.target.value)} /></FormField>
        <FormField label="Store (SLS, SLH, SLM, GS)" htmlFor="sp-store"><Input id="sp-store" value={store} onChange={(e) => setStore(e.target.value)} /></FormField>
        <p className="text-xs text-stone-500">It goes on your tasks, due in 2 days.</p>
      </div>
    </Modal>
  )
}

function OrderedDialog({ request, onClose, onSave }: { request: SupplyRequest; onClose: () => void; onSave: (from: string | null, order: string | null, expected: string | null) => Promise<void> }) {
  const [from, setFrom] = useState('')
  const [order, setOrder] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`Ordered: ${request.summary}`} submitLabel="Save" busy={busy} onClose={onClose}
      onSubmit={async () => { setBusy(true); try { await onSave(from || null, order || null, expected || null) } finally { setBusy(false) } }}>
      <div className="space-y-3">
        <FormField label="Ordered from" htmlFor="so-from"><Input id="so-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Amazon" /></FormField>
        <FormField label="Order number" htmlFor="so-order"><Input id="so-order" value={order} onChange={(e) => setOrder(e.target.value)} /></FormField>
        <FormField label="Expected to arrive" htmlFor="so-exp"><Input id="so-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></FormField>
        <p className="text-xs text-stone-500">Usually not needed: the confirmation email fills this in on its own.</p>
      </div>
    </Modal>
  )
}
