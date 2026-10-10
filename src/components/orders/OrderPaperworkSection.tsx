import { Link } from 'react-router-dom'
import { CheckCircle2, Circle } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOrderChecks } from '@/services/orderChecks'
import { CHECK_TITLE, checkStatusText, ORDER_PAPERS } from '@/lib/orderChecks'
import { ROUTES } from '@/lib/constants'
import type { VendorLink } from '@/types'
import { Badge } from '@/components/ui'

/**
 * The four documents to an order (Dana, Oct 10): our order, the LS PO, the vendor's confirmation, the invoice,
 * each ticked when it is on file; and Claude's checks (confirmation vs our order, invoice vs confirmation).
 */
export function OrderPaperworkSection({ orderId, documents }: { orderId: string; documents: VendorLink[] }) {
  const checks = useSupabaseQuery(() => listOrderChecks(orderId), [orderId, documents.length])
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Paperwork</h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ORDER_PAPERS.map((p) => {
          const n = documents.filter((d) => d.kind === p.kind).length
          return (
            <li key={p.kind} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${n ? 'border-green-200 bg-green-50 text-green-900' : 'border-stone-200 text-stone-500'}`}>
              {n ? <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden="true" /> : <Circle className="size-4 shrink-0 text-stone-300" aria-hidden="true" />}
              <span>{p.label}{n > 1 ? ` (${n})` : ''}</span>
            </li>
          )
        })}
      </ul>
      {checks.data?.length ? (
        <ul className="mt-3 divide-y divide-stone-100">
          {checks.data.map((c) => {
            const st = checkStatusText(c)
            return (
              <li key={c.id}>
                <Link to={`${ROUTES.orderChecks}/${c.id}`} className="flex flex-wrap items-center gap-2 py-2 text-sm hover:text-brand">
                  <span className="font-medium text-stone-900">{CHECK_TITLE[c.kind]}</span>
                  {c.doc_number ? <span className="text-stone-500">#{c.doc_number}</span> : null}
                  <Badge tone={st.tone}>{st.text}</Badge>
                  {c.assignee && c.status !== 'done' ? <span className="text-xs text-stone-500">· {c.assignee.full_name}</span> : null}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : <p className="mt-3 text-xs text-stone-500">When a confirmation or invoice comes in by email or is attached below, Claude checks it against the order.</p>}
    </section>
  )
}
