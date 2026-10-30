import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { listVendorShipmentRequests } from '@/services/shipmentRequests'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { SHIPMENT_STATUS, shipmentMethodLabel } from '@/lib/shipmentRequests'
import { Badge } from '@/components/ui'

/** This vendor's shipment details emails (Dana, Oct 30): each order's, with where it stands. */
export function VendorShipmentSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listVendorShipmentRequests(vendorId), [vendorId])
  useLiveTable('shipment_requests', `vendor_id=eq.${vendorId}`, () => { void q.refetch() })
  const [now] = useState(() => new Date().toISOString())
  const rows = q.data ?? []
  if (!rows.length) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><ClipboardList className="size-4" aria-hidden="true" />Shipment details</h2>
      <ul className="mt-3 divide-y divide-stone-100 text-sm">
        {rows.map((r) => {
          const late = ['sent', 'opened'].includes(r.status) && !!r.followup_due_at && r.followup_due_at < now
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              {r.order ? <Link to={`${ROUTES.orders}/${r.order.id}`} className="font-medium text-stone-900 hover:text-brand">PO {r.order.po_number ?? '?'}</Link> : null}
              <span className="text-stone-600">{r.sent_at ? `sent ${shortDate(r.sent_at)}` : 'not sent yet'}{r.answered_at ? ` · answered ${shortDate(r.answered_at)}` : ''}{r.method ? ` · ${shipmentMethodLabel(r.method)}` : ''}</span>
              <Badge tone={late ? 'danger' : SHIPMENT_STATUS[r.status].tone}>{late ? 'Past 3 business days' : SHIPMENT_STATUS[r.status].text}</Badge>
            </li>
          )
        })}
      </ul>
      <Link to={ROUTES.freightShipments} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">All shipment details</Link>
    </section>
  )
}
