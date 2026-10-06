import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { vendorOrderSummary } from '@/services/orders'
import { ROUTES } from '@/lib/constants'
import { money, showLabel } from '@/lib/vendors'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'

/** Every order we have placed with this vendor, newest first, with the totals that tell you when they buy. */
export function VendorOrdersSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => vendorOrderSummary(vendorId), [vendorId])
  const s = q.data
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Order history</h2>
        {s && s.count ? (
          <p className="text-xs text-stone-500">
            {s.count} order{s.count === 1 ? '' : 's'} · {money(s.totalSpend)} · last {s.lastOrderDate ? new Date(s.lastOrderDate).toLocaleDateString() : '—'}
            {s.seasons.summer || s.seasons.winter ? ` · buys for ${[s.seasons.summer ? `summer (${s.seasons.summer})` : '', s.seasons.winter ? `winter (${s.seasons.winter})` : ''].filter(Boolean).join(' and ')}` : ''}
            {s.shows.length ? ` · ${s.shows.map(showLabel).join(', ')}` : ''}
          </p>
        ) : null}
      </div>
      {!s || s.count === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No orders on file yet. They arrive from the Placed Order Summary import and, later, from the mailbox.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr><th className="py-1 pr-3">Ordered</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">What</th><th className="py-1 pr-3">Store</th><th className="py-1 pr-3">By</th><th className="py-1 pr-3 text-right">Cost</th><th className="py-1 pr-3">Ship</th><th className="py-1">Paid</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {s.orders.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="whitespace-nowrap py-1.5 pr-3"><Link to={`${ROUTES.orders}/${o.id}`} className="font-medium text-stone-900 hover:text-brand">{o.order_date ? new Date(o.order_date).toLocaleDateString() : 'no date'}</Link>{o.season ? <span className="block text-xs text-stone-500">{o.season}{o.show_code ? ` · ${showLabel(o.show_code)}${o.show_inferred ? '?' : ''}` : ''}</span> : null}</td>
                  <td className="py-1.5 pr-3"><OrderStatusBadge status={o.status} /></td>
                  <td className="max-w-md py-1.5 pr-3 text-stone-700">{o.description}{o.po_number ? <span className="block text-xs text-stone-500">PO {o.po_number}</span> : null}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-stone-600">{o.store_codes.join(', ')}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-stone-600">{o.placed_by}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right text-stone-900">{money(o.final_cost ?? o.est_cost)}{o.free_shipping === true ? <span className="block text-xs text-emerald-700">free ship</span> : o.free_shipping === false && o.freight_cost ? <span className="block text-xs text-stone-500">+{money(o.freight_cost)} freight</span> : null}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-stone-600">{o.est_ship_date ? new Date(o.est_ship_date).toLocaleDateString() : ''}</td>
                  <td className="whitespace-nowrap py-1.5 text-stone-600">{o.paid_date ? new Date(o.paid_date).toLocaleDateString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
