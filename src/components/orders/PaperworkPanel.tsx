import { Link } from 'react-router-dom'
import { FileCheck2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { listOpenChecks } from '@/services/orderChecks'
import { CHECK_KIND_LABEL, checkStatusText, daysWaitingNow } from '@/lib/orderChecks'
import { ROUTES } from '@/lib/constants'
import { Badge } from '@/components/ui'

/**
 * Dashboard (Dana, Oct 10): confirmations and invoices Claude has checked against the order, waiting on the
 * person who placed it (or whoever it was handed to), oldest first. Hidden when there are none.
 */
export function PaperworkPanel() {
  const { organization } = useAuth()
  const { personId, isMe, personName } = useViewAs()
  const q = useSupabaseQuery(async () => (organization ? listOpenChecks(organization.id, personId) : []), [organization?.id, personId])
  const rows = q.data ?? []
  if (!rows.length) return null
  const whose = isMe ? '' : personId ? ` (${personName?.split(' ')[0] ?? 'theirs'})` : ' (everyone)'
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><FileCheck2 className="size-4 text-sky-600" aria-hidden="true" /> Confirmations &amp; invoices to review{whose} ({rows.length})</h2>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {rows.slice(0, 8).map((c) => {
          const st = checkStatusText(c)
          const days = daysWaitingNow(c.created_at)
          return (
            <li key={c.id}>
              <Link to={`${ROUTES.orderChecks}/${c.id}`} className="block py-2 hover:text-brand">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-stone-900">{c.vendor?.name ?? 'Vendor not filed'} · {CHECK_KIND_LABEL[c.kind]}{c.order?.po_number ? ` · PO ${c.order.po_number}` : ''}</span>
                  <span className={`shrink-0 text-xs ${days >= 2 ? 'font-semibold text-red-700' : 'text-stone-500'}`}>{days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                  <Badge tone={st.tone}>{st.text}</Badge>
                  {!isMe && c.assignee ? <span>{c.assignee.full_name}</span> : null}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {rows.length > 8 ? <p className="mt-1 text-xs text-stone-500">and {rows.length - 8} more</p> : null}
    </div>
  )
}
