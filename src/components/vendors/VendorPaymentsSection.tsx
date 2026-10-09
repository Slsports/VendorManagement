import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listPayments } from '@/services/payments'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'

/** Payments to this vendor (Bill.com history, Dana, Oct 9). Hidden until there is one. */
export function VendorPaymentsSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listPayments({ vendorId }, 50), [vendorId])
  const rows = q.data ?? []
  if (!rows.length) return null
  const total = rows.reduce((s, p) => s + (p.amount ?? 0), 0)
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Payments</h2>
        <span className="text-sm text-stone-600">{rows.length} · {money(total)}</span>
      </div>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-stone-700">{shortDate(p.process_date)}{p.invoice_number ? ` · ${p.invoice_number}` : ''}{p.method ? ` · ${p.method}` : ''}{p.confirmation ? <span className="text-xs text-stone-400"> · {p.confirmation}</span> : null}</span>
            <span className="flex items-center gap-2">
              {p.order_id ? <Link to={`${ROUTES.orders}/${p.order_id}`} className="text-xs text-brand hover:underline">Order</Link> : null}
              <span className="font-medium text-stone-900">{money(p.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
