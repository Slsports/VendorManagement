import { Link } from 'react-router-dom'
import { Truck } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOpenOrdersForFreight } from '@/services/templates'
import { ORDER_STATUS_LABELS, ROUTES, type OrderStatus } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { FreightEmailButton } from '@/components/orders/FreightEmailButton'

/** The Freight email for each of this vendor's open orders, one click (Dana, Nov 13: "from every vendor page"). */
export function VendorFreightEmail({ vendorId, canEdit }: { vendorId: string; canEdit: boolean }) {
  const q = useSupabaseQuery(() => listOpenOrdersForFreight(vendorId), [vendorId])
  const rows = q.data ?? []
  if (!canEdit || !rows.length) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Truck className="size-4 text-brand" aria-hidden="true" />Freight email</h2>
      <p className="mt-1 text-xs text-stone-500">Their freight terms, the form for that order and our routing letter. Opens ready to send.</p>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {rows.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link to={`${ROUTES.orders}/${o.id}`} className="font-medium text-stone-900 hover:text-brand">{o.po_number ? `PO ${o.po_number}` : 'Order'}</Link>
            <span className="text-xs text-stone-500">{[ORDER_STATUS_LABELS[o.status as OrderStatus], o.order_date ? shortDate(o.order_date) : null, o.est_cost != null ? money(Number(o.est_cost)) : null, o.sent ? `freight email sent ${shortDate(o.sent)}` : null].filter(Boolean).join(' · ')}</span>
            <span className="ml-auto"><FreightEmailButton orderId={o.id} label={o.sent ? 'Send again' : 'Freight email'} onSent={() => void q.refetch()} /></span>
          </li>
        ))}
      </ul>
    </section>
  )
}
