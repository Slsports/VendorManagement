import { Link, useSearchParams } from 'react-router-dom'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ROUTES, type OrderStatus } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

function isOrderStatus(v: string | null): v is OrderStatus {
  return !!v && (ORDER_STATUSES as readonly string[]).includes(v)
}

export default function OrderListPage() {
  const [params] = useSearchParams()
  const raw = params.get('status')
  const status = isOrderStatus(raw) ? raw : null

  return (
    <div>
      <PageHeader title="Orders" description={status ? `Showing ${ORDER_STATUS_LABELS[status].toLowerCase()} orders.` : 'Every order, from placement to payment.'} />
      <nav aria-label="Order status" className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          <li>
            <Link to={ROUTES.orders} aria-current={!status ? 'page' : undefined} className={tab(!status)}>
              All
            </Link>
          </li>
          {ORDER_STATUSES.map((s) => (
            <li key={s}>
              <Link to={`${ROUTES.orders}?status=${s}`} aria-current={status === s ? 'page' : undefined} className={tab(status === s)}>
                {ORDER_STATUS_LABELS[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <ComingSoon phase={4}>
        The order table with line items inline, a date-range filter for arrivals, "View confirmation" on every row, and the status workflow.
      </ComingSoon>
    </div>
  )
}

function tab(active: boolean) {
  return cn(
    'block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900',
  )
}
