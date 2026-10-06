import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { countOrdersByStatus, listOrders } from '@/services/orders'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ROUTES, type OrderStatus } from '@/lib/constants'
import { money, showLabel } from '@/lib/vendors'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { Alert, Select, Spinner } from '@/components/ui'

function isOrderStatus(v: string | null): v is OrderStatus {
  return !!v && (ORDER_STATUSES as readonly string[]).includes(v)
}

export default function OrderListPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const raw = params.get('status')
  const status = isOrderStatus(raw) ? raw : null
  const season = (params.get('season') ?? '') as '' | 'summer' | 'winter'
  const search = params.get('q') ?? ''
  const [draft, setDraft] = useState(search)
  const q = useSupabaseQuery(async () => (organization ? listOrders(organization.id, { status: status ?? undefined, season: season || undefined }) : []), [organization?.id, status, season])
  const counts = useSupabaseQuery(async (): Promise<Record<string, number>> => (organization ? countOrdersByStatus(organization.id) : {}), [organization?.id])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return q.data ?? []
    return (q.data ?? []).filter((o) => (o.vendor?.name ?? '').toLowerCase().includes(s) || (o.description ?? '').toLowerCase().includes(s) || (o.po_number ?? '').toLowerCase().includes(s) || (o.placed_by ?? '').toLowerCase().includes(s))
  }, [q.data, search])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const total = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0)

  return (
    <div>
      <PageHeader title="Orders" description={status ? `${ORDER_STATUS_LABELS[status]} orders.` : 'Every order, from placement to payment. Loaded from the Placed Order Summary.'} />
      <nav aria-label="Order status" className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          <li><Link to={`${ROUTES.orders}${season ? `?season=${season}` : ''}`} aria-current={!status ? 'page' : undefined} className={tab(!status)}>All{total ? ` (${total})` : ''}</Link></li>
          {ORDER_STATUSES.filter((s) => (counts.data?.[s] ?? 0) > 0 || s === status).map((s) => (
            <li key={s}><Link to={`${ROUTES.orders}?status=${s}${season ? `&season=${season}` : ''}`} aria-current={status === s ? 'page' : undefined} className={tab(status === s)}>{ORDER_STATUS_LABELS[s]}{counts.data?.[s] ? ` (${counts.data[s]})` : ''}</Link></li>
          ))}
        </ul>
      </nav>
      <form onSubmit={(e) => { e.preventDefault(); setParam('q', draft.trim()) }} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search vendor, what was ordered, PO, who placed it…" aria-label="Search orders" className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm" />
        </div>
        <Select value={season} onChange={(e) => setParam('season', e.target.value)} aria-label="Season" className="sm:w-44">
          <option value="">Any season</option>
          <option value="summer">Summer</option>
          <option value="winter">Winter</option>
        </Select>
      </form>
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading orders…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">No orders match.</p>
        : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="px-3 py-2">Ordered</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Store</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2">Ship</th><th className="px-3 py-2">Paid</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.slice(0, 500).map((o) => (
                  <tr key={o.id} className="align-top hover:bg-stone-50">
                    <td className="whitespace-nowrap px-3 py-2"><Link to={`${ROUTES.orders}/${o.id}`} className="font-medium text-stone-900 hover:text-brand">{o.order_date ? new Date(o.order_date).toLocaleDateString() : 'no date'}</Link>{o.show_code ? <span className="block text-xs text-stone-500">{showLabel(o.show_code)}{o.show_inferred ? '?' : ''}</span> : o.season ? <span className="block text-xs text-stone-500">{o.season}</span> : null}</td>
                    <td className="px-3 py-2">{o.vendor ? <Link to={`${ROUTES.vendors}/${o.vendor.id}`} className="text-stone-900 hover:text-brand">{o.vendor.name}</Link> : '—'}</td>
                    <td className="px-3 py-2"><OrderStatusBadge status={o.status} /></td>
                    <td className="max-w-md px-3 py-2 text-stone-700">{o.description}{o.po_number ? <span className="block text-xs text-stone-500">PO {o.po_number}</span> : null}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{o.store_codes.join(', ')}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(o.final_cost ?? o.est_cost)}{o.free_shipping === true ? <span className="block text-xs text-emerald-700">free ship</span> : o.free_shipping === false && o.freight_cost ? <span className="block text-xs text-stone-500">+{money(o.freight_cost)} freight</span> : null}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{o.est_ship_date ? new Date(o.est_ship_date).toLocaleDateString() : ''}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{o.paid_date ? new Date(o.paid_date).toLocaleDateString() : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 ? <p className="px-3 py-2 text-xs text-stone-500">Showing the first 500 of {rows.length}. Narrow the search to see the rest.</p> : null}
          </div>
        )}
    </div>
  )
}

function tab(active: boolean) {
  return cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')
}
