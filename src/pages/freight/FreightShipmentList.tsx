import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Mail, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { useTableSort } from '@/hooks/useTableSort'
import { listShipmentRequests, sendShipmentRequestNow, type ShipmentFilter, type ShipmentRequestRow } from '@/services/shipmentRequests'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { cn, errorMessage } from '@/lib/utils'
import { SHIPMENT_STATUS, shipmentKindLabel, shipmentMethodLabel } from '@/lib/shipmentRequests'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

const TABS: { value: ShipmentFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'answered', label: 'Answered' },
  { value: 'all', label: 'All' },
]

/**
 * Shipment details (Dana, Oct 30): every confirmed order's email to the vendor, what went out when, whether they opened
 * the form and what came back. Red when 3 business days have passed with nothing. Trevor's list.
 */
export default function FreightShipmentListPage() {
  const { organization, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('show') ?? 'waiting') as ShipmentFilter
  const q = useSupabaseQuery(async () => (organization ? listShipmentRequests(organization.id, filter) : []), [organization?.id, filter])
  useLiveTable('shipment_requests', organization ? `organization_id=eq.${organization.id}` : null, () => { void q.refetch() })
  const canEdit = ['admin', 'manager', 'buyer'].includes(profile?.role ?? '')
  const [now] = useState(() => new Date().toISOString())
  const { sorted, sort, toggle } = useTableSort(q.data ?? [], {
    vendor: (r) => r.vendor?.name ?? '',
    order: (r) => r.order?.po_number ?? '',
    sent: (r) => r.sent_at ?? r.created_at,
    opened: (r) => r.opened_at ?? '',
    answered: (r) => r.answered_at ?? '',
    method: (r) => r.method ?? '',
    status: (r) => r.status,
  }, { param: 'sh_sort', descFirst: ['sent', 'opened', 'answered'] })

  async function sendNow(r: ShipmentRequestRow) {
    try { await sendShipmentRequestNow(r.id); toast.success('Sent'); await q.refetch() } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div>
      <BackLink fallback={ROUTES.freight} fallbackLabel="Freight" />
      <PageHeader title="Shipment details" description="The email VMS sends each vendor once an order is confirmed: the form for the shipment details and their freight quote, or the check on the freight we agreed. Red when 3 business days pass with nothing back." />
      <ul className="mb-4 flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1 sm:inline-flex" aria-label="Which requests">
        {TABS.map((t) => (
          <li key={t.value}>
            <button type="button" onClick={() => { const n = new URLSearchParams(params); n.set('show', t.value); setParams(n, { replace: true }) }} aria-current={filter === t.value ? 'page' : undefined}
              className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', filter === t.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{t.label}</button>
          </li>
        ))}
      </ul>
      {q.isLoading ? <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : !sorted.length ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">Nothing here. When an order is confirmed, its email to the vendor shows up here.</p>
        : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-4 py-2" />
                  <SortHeader label="PO" sortKey="order" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <th className="px-3 py-2">What</th>
                  <SortHeader label="Sent" sortKey="sent" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Opened" sortKey="opened" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
                  <SortHeader label="Answered" sortKey="answered" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Method" sortKey="method" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((r) => {
                  const late = ['sent', 'opened'].includes(r.status) && !!r.followup_due_at && r.followup_due_at < now
                  const st = SHIPMENT_STATUS[r.status]
                  return (
                    <tr key={r.id} className={late ? 'bg-red-50/50' : ''}>
                      <td className="px-4 py-2 font-medium text-stone-900">{r.vendor ? <Link to={`${ROUTES.vendors}/${r.vendor.id}`} className="hover:text-brand">{r.vendor.name}</Link> : '—'}</td>
                      <td className="px-3 py-2">{r.order ? <Link to={`${ROUTES.orders}/${r.order.id}`} className="text-brand hover:underline">{r.order.po_number ?? 'order'}</Link> : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{shipmentKindLabel(r.kind)}</td>
                      <td className="px-3 py-2 text-stone-700">{r.sent_at ? shortDate(r.sent_at) : r.hold ? <span className="text-amber-700">Ready, not sent</span> : r.status === 'ready' ? <span className="text-amber-700">{r.to_emails.length ? 'Sending…' : 'No email on file'}</span> : '—'}</td>
                      <td className="hidden px-3 py-2 text-stone-700 md:table-cell">{r.opened_at ? shortDate(r.opened_at) : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{r.answered_at ? shortDate(r.answered_at) : late ? <span className="font-medium text-red-700">Past 3 business days{r.followup_task_id ? ', follow-up with Trevor' : ''}</span> : '—'}</td>
                      <td className="hidden px-3 py-2 text-stone-700 md:table-cell">{shipmentMethodLabel(r.method)}</td>
                      <td className="px-3 py-2"><Badge tone={st.tone}>{st.text}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {r.thread_id ? <Link to={`${ROUTES.mail}/${r.thread_id}`} className="mr-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Mail className="size-3.5" aria-hidden="true" />the email</Link> : null}
                        {canEdit && r.status === 'ready' && r.to_emails.length ? <Button size="sm" variant="secondary" onClick={() => void sendNow(r)} leftIcon={<Send className="size-3.5" aria-hidden="true" />}>Send now</Button> : null}
                      </td>
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
