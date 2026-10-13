import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Calculator } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listFreightQuotes, listUnapprovedShipments, type QuoteFilter } from '@/services/freightQuotes'
import { ROUTES } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { cn } from '@/lib/utils'
import { cheapest, QUOTE_STATUS } from '@/lib/freightQuotes'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Spinner } from '@/components/ui'

const TABS: { value: QuoteFilter; label: string }[] = [
  { value: 'waiting', label: 'To approve' },
  { value: 'needs_order', label: 'Which order?' },
  { value: 'approved', label: 'Approved' },
  { value: 'all', label: 'All' },
]

/**
 * Freight quotes (Dana, Oct 13): every vendor's freight quote, matched to its order, for Trevor to price with Priority
 * One and WWEX and approve. Below: orders that shipped without an approved quote.
 */
export default function FreightQuoteListPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('show') ?? 'waiting') as QuoteFilter
  const q = useSupabaseQuery(async () => (organization ? listFreightQuotes(organization.id, filter) : []), [organization?.id, filter])
  const shipped = useSupabaseQuery(async () => (organization ? listUnapprovedShipments(organization.id) : []), [organization?.id])
  const { sorted, sort, toggle } = useTableSort(q.data ?? [], {
    vendor: (r) => r.vendor?.name ?? '',
    order: (r) => r.order?.po_number ?? '',
    received: (r) => r.email?.received_at ?? r.created_at,
    vendor_cost: (r) => r.vendor_cost,
    best: (r) => cheapest(r),
    status: (r) => r.status,
  }, { param: 'fq_sort', descFirst: ['received'] })

  return (
    <div>
      <BackLink fallback={ROUTES.freight} fallbackLabel="Freight" />
      <PageHeader title="Freight quotes" description="No order ships until its freight quote is approved. Add our price (Pallet → Priority One, Parcel → WWEX/UPS), then approve the cheaper one." />
      <ul className="mb-4 flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1 sm:inline-flex" aria-label="Which quotes">
        {TABS.map((t) => (
          <li key={t.value}>
            <button type="button" onClick={() => { const n = new URLSearchParams(params); n.set('show', t.value); setParams(n, { replace: true }) }} aria-current={filter === t.value ? 'page' : undefined}
              className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', filter === t.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{t.label}</button>
          </li>
        ))}
      </ul>

      {q.isLoading ? <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : !sorted.length ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-12 text-center">
            <Calculator className="size-8 text-stone-400" aria-hidden="true" />
            <p className="mt-3 text-sm text-stone-600">Nothing here. When a vendor emails a freight quote, it shows up here and on Trevor's tasks.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Order" sortKey="order" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Received" sortKey="received" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Vendor's quote" sortKey="vendor_cost" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Cheapest" sortKey="best" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2"><Link to={`${ROUTES.freightQuotes}/${r.id}`} className="font-medium text-stone-900 hover:text-brand">{r.vendor?.name ?? 'Vendor not known'}</Link></td>
                    <td className="px-3 py-2 text-stone-700">{r.order ? <>PO {r.order.po_number ?? '—'} <span className="text-xs text-stone-500">{shortDate(r.order.order_date)}</span></> : <span className="text-red-700">Which order?</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{shortDate(r.email?.received_at ?? r.created_at)}</td>
                    <td className="px-3 py-2 text-stone-700">{money(r.vendor_cost)}{r.vendor_carrier ? <span className="block text-xs text-stone-500">{r.vendor_carrier}</span> : null}</td>
                    <td className="px-3 py-2 text-stone-700">{money(r.status === 'approved' ? r.approved_cost : cheapest(r))}</td>
                    <td className="px-3 py-2"><Badge tone={QUOTE_STATUS[r.status].tone}>{QUOTE_STATUS[r.status].text}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {(shipped.data ?? []).length ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-red-900"><AlertTriangle className="size-4" aria-hidden="true" />Shipped without an approved freight quote</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(shipped.data ?? []).map((s) => (
              <li key={s.order_id}><Link to={`${ROUTES.orders}/${s.order_id}`} className="font-medium text-red-900 hover:underline">{s.vendor_name}{s.po_number ? `, PO ${s.po_number}` : ''}</Link> <span className="text-red-800">· placed {shortDate(s.order_date)} · {s.has_quote ? 'quote not approved' : 'no quote'}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
