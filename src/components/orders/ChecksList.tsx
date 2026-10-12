import { Link } from 'react-router-dom'
import type { OrderCheckRow } from '@/services/orderChecks'
import { CHECK_KIND_LABEL, checkStatusText, daysWaitingNow } from '@/lib/orderChecks'
import { ROUTES } from '@/lib/constants'
import { Badge } from '@/components/ui'

/**
 * Confirmations and invoices Claude checked against the order, waiting on the person who placed it (or whoever it
 * was handed to), oldest first. Each row opens its check page. Shown on the Review queue tabs (Dana, Oct 12).
 */
export function ChecksList({ rows, showWho }: { rows: OrderCheckRow[]; showWho: boolean }) {
  return (
    <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white px-4 text-sm">
      {rows.map((c) => {
        const st = checkStatusText(c)
        const days = daysWaitingNow(c.created_at)
        return (
          <li key={c.id}>
            <Link to={`${ROUTES.orderChecks}/${c.id}`} className="block py-2.5 hover:text-brand">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-stone-900">{c.vendor?.name ?? 'Vendor not filed'} · {CHECK_KIND_LABEL[c.kind]}{c.order?.po_number ? ` · PO ${c.order.po_number}` : ''}</span>
                <span className={`shrink-0 text-xs ${days >= 2 ? 'font-semibold text-red-700' : 'text-stone-500'}`}>{days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                <Badge tone={st.tone}>{st.text}</Badge>
                {showWho && c.assignee ? <span>{c.assignee.full_name}</span> : null}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
