import { Link } from 'react-router-dom'
import { FileText, Mail, Truck } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { orderSources } from '@/services/orders'
import { downloadVendorFile } from '@/services/lines'
import { money } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/utils'
import type { Order } from '@/types'

const MADE: Record<Order['source'], string> = {
  email: 'Claude made this order from an email',
  placed_order_summary: 'Loaded from the Placed Order Summary',
  order_guide: 'Loaded from the Placed Order Summary',
  show_scan: 'Claude read it from a show order sheet',
  confirmation: "Made from the vendor's confirmation",
  manual: 'Entered in VMS',
}

/**
 * Where this order came from (Dana, Oct 21: one click to the source): how it got into VMS (the email Claude read, the
 * sheet row), the emails tied to it, the WWD invoices its items were filled from, and the freight bills its freight came
 * from.
 */
export function OrderSourceCard({ order }: { order: Pick<Order, 'id' | 'source' | 'source_sheet' | 'source_key' | 'freight_notes'> }) {
  const q = useSupabaseQuery(() => orderSources(order.id), [order.id])
  const { view, viewer } = useDocumentViewer()
  const s = q.data
  const link = 'inline-flex items-center gap-1 text-brand hover:underline'
  const sheet = (order.source === 'placed_order_summary' || order.source === 'order_guide') && (order.source_sheet || order.source_key)
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Where this order came from</h2>
      <p className="mt-2 text-stone-800">{MADE[order.source]}{sheet ? ` (${[order.source_sheet, order.source_key ? `row ${order.source_key}` : null].filter(Boolean).join(', ')})` : ''}.</p>
      {s?.emails.length ? (
        <ul className="mt-2 space-y-1">
          {s.emails.map((e, i) => (
            <li key={e.id}>
              <Link to={`${ROUTES.mail}/${e.thread_id}`} className={link}><Mail className="size-3.5 shrink-0" aria-hidden="true" />{e.subject || '(no subject)'}</Link>
              <span className="text-xs text-stone-500"> · {e.from_name || e.from_email} · {shortDate(e.received_at)}{i === 0 && order.source === 'email' ? ' · made from this one' : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {s?.wwd.length ? (
        <ul className="mt-2 space-y-1">
          {s.wwd.map((w) => (
            <li key={w.id} className="text-stone-700">
              {w.lines} item{w.lines === 1 ? '' : 's'} filled from Edenred's lines for WWD Seq #{' '}
              {w.doc?.storage_path ? <button type="button" className={link} onClick={() => view({ name: w.doc!.file_name ?? `WWD ${w.seq}`, mime: w.doc!.mime_type, load: () => downloadVendorFile(w.doc!.storage_path!) })}><FileText className="size-3.5" aria-hidden="true" />{w.seq}</button> : w.seq}
            </li>
          ))}
        </ul>
      ) : null}
      {s?.freight.length ? (
        <ul className="mt-2 space-y-1">
          {s.freight.map((f) => (
            <li key={`${f.bill_id}-${f.amount}`} className="text-stone-700">
              Freight {money(f.amount)} from{' '}
              <Link to={`${ROUTES.freight}/${f.bill_id}`} className={link}><Truck className="size-3.5" aria-hidden="true" />{[f.carrier, f.invoice_number ? `#${f.invoice_number}` : null].filter(Boolean).join(' ') || 'the freight bill'}</Link>
              {f.confirmed ? '' : ' (matched by Claude, not confirmed yet)'}
            </li>
          ))}
        </ul>
      ) : order.freight_notes ? <p className="mt-2 text-xs text-stone-500">Freight: {order.freight_notes}</p> : null}
      {viewer}
    </section>
  )
}
