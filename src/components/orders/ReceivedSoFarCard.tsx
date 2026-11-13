import { Link } from 'react-router-dom'
import { PackageOpen } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { listOrderShipments, orderTally } from '@/services/orders'
import { downloadVendorFile } from '@/services/lines'
import { money } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/utils'
import type { VendorLink } from '@/types'
import { Badge } from '@/components/ui'

/**
 * Received so far (Dana, Nov 13, World Famous Sports): an order that ships in several shipments keeps the confirmation as
 * the list to fill. Each invoice (I88198, -2, -3 …) is a shipment; the box shows them with their dates and the running
 * count, then every confirmed item with what has come and what is still to come. Each shipment opens its invoice.
 */
export function ReceivedSoFarCard({ orderId, documents, shipsInParts }: { orderId: string; documents: VendorLink[]; shipsInParts: boolean }) {
  const ships = useSupabaseQuery(() => listOrderShipments(orderId), [orderId])
  const tally = useSupabaseQuery(() => orderTally(orderId), [orderId])
  const { view, viewer } = useDocumentViewer()
  const shipments = ships.data ?? []
  const rows = tally.data ?? []
  if (!shipments.length && !shipsInParts) return null
  const onConf = rows.filter((r) => r.on_confirmation)
  const extra = rows.filter((r) => !r.on_confirmation)
  const ordered = onConf.reduce((n, r) => n + Number(r.ordered), 0)
  const received = onConf.reduce((n, r) => n + Math.min(Number(r.received), Number(r.ordered)), 0)
  const still = onConf.reduce((n, r) => n + Number(r.still), 0)
  const openInvoice = (s: (typeof shipments)[number]) => {
    const doc = documents.find((d) => d.id === s.vendor_link_id)
    if (doc?.storage_path) view({ name: doc.file_name ?? doc.label, mime: doc.mime_type, load: () => downloadVendorFile(doc.storage_path!) })
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><PackageOpen className="size-4 text-brand" aria-hidden="true" />Received so far</h2>
        {ordered > 0 ? <Badge tone={still > 0 ? 'warning' : 'success'}>{still > 0 ? `${received} of ${ordered} in · ${still} still to come` : `All ${ordered} in`}</Badge>
          : shipments.length ? <Badge tone="neutral">No confirmation item list to check against</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">This vendor ships one order in several shipments. Each invoice is a shipment; the order stays on order until the confirmation is filled.</p>
      {shipments.length ? (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {shipments.map((s) => {
            const doc = documents.find((d) => d.id === s.vendor_link_id)
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium text-stone-900">Shipment {s.seq}</span>
                <span className="text-stone-600">{s.shipped_on ? shortDate(s.shipped_on) : 'date not known'}</span>
                {doc ? <button type="button" onClick={() => openInvoice(s)} className="text-brand hover:underline">invoice {doc.doc_number ?? s.invoice_number}</button>
                  : s.wwd_invoice_id ? <Link to={`${ROUTES.payments}?invoice=${s.wwd_invoice_id}`} className="text-brand hover:underline">invoice {s.invoice_number}</Link>
                    : <span className="text-stone-700">invoice {s.invoice_number}</span>}
                {s.amount !== null ? <span className="text-stone-600">{money(Number(s.amount))}</span> : null}
                <span className="text-stone-500">{Number(s.units) > 0 ? `${Number(s.units)} units` : 'items not read yet'}{s.seq > 1 && Number(s.units) > 0 ? ` · ${Number(s.received_so_far)} units in so far` : ''}</span>
              </li>
            )
          })}
        </ul>
      ) : <p className="mt-3 text-sm text-stone-500">No shipment yet.</p>}
      {onConf.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <tr><th className="py-2 pr-3">Vendor ID</th><th className="py-2 pr-3">Item</th><th className="py-2 pr-3 text-right">Ordered</th><th className="py-2 pr-3 text-right">In</th><th className="py-2 text-right">Still to come</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {onConf.map((r) => (
                <tr key={r.item_key} className={Number(r.still) > 0 ? '' : 'text-stone-500'}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.vendor_item_id}</td>
                  <td className="py-1.5 pr-3">{r.description ?? ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{Number(r.ordered)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{Number(r.received)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${Number(r.still) > 0 ? 'font-medium text-amber-800' : ''}`}>{Number(r.still) > 0 ? Number(r.still) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {extra.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-stone-600">{extra.length} billed {extra.length === 1 ? 'item' : 'items'} not on the confirmation</summary>
          <ul className="mt-1 space-y-0.5 text-stone-600">{extra.map((r) => <li key={r.item_key}><span className="font-mono text-xs">{r.vendor_item_id}</span> {r.description ?? ''} · {Number(r.received)}</li>)}</ul>
        </details>
      ) : null}
      {viewer}
    </section>
  )
}
