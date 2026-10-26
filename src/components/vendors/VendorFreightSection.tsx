import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorFreight } from '@/services/freight'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { FoldSection } from '@/components/shared/FoldSection'

/**
 * The carrier bills that carried this vendor's shipments (Dana, Oct 26): the vendor's view of the one file on the
 * Freight page. Each row opens the bill itself. Hidden until there is one.
 */
export function VendorFreightSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listVendorFreight(vendorId), [vendorId])
  const rows = q.data ?? []
  if (!rows.length) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <FoldSection title="Freight" summary={`${rows.length} shipment${rows.length === 1 ? '' : 's'} · ${money(total)}`} className="lg:col-span-3">
      <p className="mb-1 text-xs text-stone-500">Carrier bills that carried this vendor's shipments. The bill itself lives on the Freight page; this is the same file seen from the vendor's side.</p>
      <ul className="divide-y divide-stone-100 text-sm">
        {rows.map((r) => (
          <li key={r.line_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-stone-700">
              {shortDate(r.ship_date ?? r.invoice_date)} · {r.carrier ?? 'Carrier'}{r.invoice_number ? ` · ${r.invoice_number}` : ''}
              {r.po_number ? <span className="text-xs text-stone-400"> · PO {r.po_number}</span> : null}
              {r.paid_date ? <span className="text-xs text-green-700"> · paid {shortDate(r.paid_date)}</span> : r.status === 'needs_pdf' ? <span className="text-xs text-amber-700"> · PDF missing</span> : null}
            </span>
            <span className="flex items-center gap-2">
              {r.order_id ? <Link to={`${ROUTES.orders}/${r.order_id}`} className="text-xs text-brand hover:underline">Order</Link> : null}
              <Link to={`${ROUTES.freight}/${r.bill_id}`} className="text-xs text-brand hover:underline">Open the bill</Link>
              <span className="font-medium text-stone-900">{money(r.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
    </FoldSection>
  )
}
