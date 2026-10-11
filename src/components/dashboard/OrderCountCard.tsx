import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { countOrderView, listOrders, ORDER_VIEW_LABELS, type OrderView } from '@/services/orders'
import { ROUTES } from '@/lib/constants'
import { money } from '@/lib/freight'
import { CountCard } from '@/components/dashboard/CountCard'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'

/** A number box for orders (open, overdue, future-dated, payments due): the count; click for the orders. */
export function OrderCountCard({ view }: { view: OrderView }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? countOrderView(organization.id, view) : 0), [organization?.id, view])
  return (
    <CountCard tile title={ORDER_VIEW_LABELS[view].title} count={q.data ?? 0} loading={q.isLoading} error={q.error} alert={view === 'overdue'}>
      <OrderViewList view={view} />
    </CountCard>
  )
}

function OrderViewList({ view }: { view: OrderView }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listOrders(organization.id, { view, limit: 200 }) : []), [organization?.id, view])
  const rows = q.data ?? []
  return (
    <>
      <p className="text-xs text-stone-500">{ORDER_VIEW_LABELS[view].help} <Link to={`${ROUTES.orders}?view=${view}`} className="font-medium text-brand hover:underline">Open on the Orders page</Link></p>
      {q.isLoading ? <p className="mt-2 text-sm text-stone-500">Loading…</p> : rows.length === 0 ? <p className="mt-2 text-sm text-stone-500">None.</p> : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {rows.slice(0, 25).map((o) => (
            <li key={o.id}>
              <Link to={`${ROUTES.orders}/${o.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand">
                <span className="min-w-0 truncate"><span className="font-medium text-stone-900">{o.vendor?.name ?? 'Order'}</span>{o.po_number ? ` · PO ${o.po_number}` : ''}{o.description ? <span className="text-stone-500"> · {o.description}</span> : null}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
                  {o.est_ship_date ? `ships ${new Date(`${o.est_ship_date}T12:00:00`).toLocaleDateString()}` : null}
                  {o.est_cost !== null ? <span>{money(o.est_cost)}</span> : null}
                  <OrderStatusBadge status={o.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 25 ? <Link to={`${ROUTES.orders}?view=${view}`} className="mt-1 inline-block text-xs text-brand hover:underline">and {rows.length - 25} more</Link> : null}
    </>
  )
}
