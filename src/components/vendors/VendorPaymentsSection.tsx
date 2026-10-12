import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listPayments } from '@/services/payments'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { FoldSection } from '@/components/shared/FoldSection'

/** Payments to this vendor (Bill.com history, Dana, Oct 9). Hidden until there is one. */
export function VendorPaymentsSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listPayments({ vendorId }, 50), [vendorId])
  const rows = q.data ?? []
  if (!rows.length) return null
  const total = rows.reduce((s, p) => s + (p.amount ?? 0), 0)
  return (
    <FoldSection title="Payments" summary={`${rows.length} · ${money(total)}`} className="lg:col-span-3">
      <ul className="divide-y divide-stone-100 text-sm">
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
    </FoldSection>
  )
}
