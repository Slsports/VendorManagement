import { Link } from 'react-router-dom'
import { FileText, Mail, Package } from 'lucide-react'
import type { OnOrderSource } from '@/services/ordering'
import { downloadVendorFile } from '@/services/lines'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/utils'

// Dana, Oct 21: pending until the vendor confirms, placed once confirmed
const STAGE = { placed: 'Pending', confirmed: 'Placed', shipped: 'Shipped, not in LS yet' } as const
const FROM = { confirmation: 'from their confirmation', invoice: 'from their invoice', our_order: "from our order's items", none: 'no item list' } as const

/**
 * Where "On order" comes from (Dana, Oct 21: "where it got its data needs to be accessible with one click"): each order
 * the suggested order counted, with one click to the order, the paper VMS read and the email it came in.
 */
export function OnOrderSources({ sources }: { sources: OnOrderSource[] }) {
  const { view, viewer } = useDocumentViewer()
  if (!sources.length) return null
  const link = 'inline-flex items-center gap-1 font-medium text-brand hover:underline'
  return (
    <section aria-label="Where On order comes from" className="mb-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Where "On order" comes from</h3>
      <ul className="mt-1 divide-y divide-stone-200">
        {sources.map((s) => (
          <li key={s.orderId} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs ${s.from === 'none' ? 'text-amber-900' : 'text-stone-700'}`}>
            <Link to={`${ROUTES.orders}/${s.orderId}`} className={link}><Package className="size-3.5" aria-hidden="true" />{s.label}</Link>
            <span className="font-medium">{STAGE[s.stage]}</span>
            <span>{s.from === 'none' ? 'no item list: check it before ordering' : `${s.items} item${s.items === 1 ? '' : 's'} ${FROM[s.from]}`}{s.wwdLines ? " (filled from Edenred's WWD invoice lines)" : ''}</span>
            {s.paper?.storage_path ? (
              <button type="button" className={link} onClick={() => view({ name: s.paper!.file_name ?? 'Paper', mime: s.paper!.mime_type, load: () => downloadVendorFile(s.paper!.storage_path!) })}>
                <FileText className="size-3.5" aria-hidden="true" />{s.from === 'invoice' ? 'Invoice' : 'Confirmation'}
              </button>
            ) : null}
            {s.paperEmail ? <Link to={`${ROUTES.mail}/${s.paperEmail.thread_id}`} className={link}><Mail className="size-3.5" aria-hidden="true" />Email it came in ({shortDate(s.paperEmail.received_at)})</Link> : null}
            {s.made ? <span className="text-stone-500">{s.made}</span> : null}
            {s.madeEmail ? <Link to={`${ROUTES.mail}/${s.madeEmail.thread_id}`} className={link}><Mail className="size-3.5" aria-hidden="true" />{s.madeEmail.subject?.slice(0, 50) || 'The email'} ({shortDate(s.madeEmail.received_at)})</Link> : null}
          </li>
        ))}
      </ul>
      {viewer}
    </section>
  )
}
