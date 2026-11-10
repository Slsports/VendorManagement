import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ExternalLink, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorOrdersForFreight } from '@/services/freight'
import { answerFreightTermsCard } from '@/services/freightTerms'
import { ROUTES } from '@/lib/constants'
import { money } from '@/lib/freight'
import { errorMessage, shortDate } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details {
  vendor_id?: string | null; vendor_name?: string | null; terms_text?: string; quote?: string; said_by?: 'vendor' | 'us'; po_text?: string | null
  email_id?: string; thread_id?: string; said_on?: string
  order_id?: string | null; order_po?: string | null; order_date?: string | null; order_cost?: number | null; order_terms?: string | null
}

const TERMS_WORDS: Record<string, string> = { free: 'free freight', half: 'they cover half', capped: 'capped', charged: 'we pay freight' }

/**
 * Freight terms Claude read in a vendor or rep email (Dana, Nov 9: "rebuild it as review cards"). Their words, the email
 * one click away, the order VMS thinks it is for and the vendor's other orders. Put it on this order, or Not for an order;
 * nothing changes on an order without that click.
 */
export function FreightTermsReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const orders = useSupabaseQuery(() => (d.vendor_id ? listVendorOrdersForFreight(d.vendor_id) : Promise.resolve([])), [d.vendor_id])
  const [busy, setBusy] = useState(false)

  async function answer(orderId: string | null, label: string) {
    setBusy(true)
    try {
      await answerFreightTermsCard(item.id, orderId)
      toast.success(orderId ? `${d.terms_text ?? 'Freight terms'} put on ${label}` : 'Set aside: not for an order')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const others = (orders.data ?? []).filter((o) => o.id !== d.order_id)
  return (
    <div className="mt-2 space-y-2">
      {d.quote ? <p className="italic text-stone-800">"{d.quote}"</p> : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
        {d.email_id && d.thread_id ? (
          <Link to={`${ROUTES.mail}/${d.thread_id}?email=${d.email_id}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
            <ExternalLink className="size-3.5" aria-hidden="true" />{d.said_by === 'us' ? 'Our email' : 'Their email'} of {shortDate(d.said_on ?? null)}
          </Link>
        ) : null}
        {d.said_by === 'us' ? <span>Our own email says this: check they agreed.</span> : null}
        {d.po_text && !d.order_id ? <span>They wrote "{d.po_text}"; no order of theirs has that PO.</span> : null}
      </p>
      {d.order_id ? (
        <div className="rounded-lg border border-amber-200 bg-white/70 p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">The order VMS thinks it is for</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`${ROUTES.orders}/${d.order_id}`} className="font-medium text-brand hover:underline">PO {d.order_po ?? '(none)'}</Link>
            <span className="text-xs text-stone-500">{[shortDate(d.order_date ?? null), d.order_cost != null ? money(d.order_cost) : null, d.order_terms ? `now: ${TERMS_WORDS[d.order_terms] ?? d.order_terms}` : null].filter(Boolean).join(' · ')}</span>
            {canEdit ? <Button size="sm" className="ml-auto" loading={busy} onClick={() => void answer(d.order_id!, `PO ${d.order_po ?? ''}`)}>Put it on this order</Button> : null}
          </div>
        </div>
      ) : null}
      {others.length ? (
        <details className="rounded-lg bg-white/70 p-2 ring-1 ring-stone-200" open={!d.order_id}>
          <summary className="cursor-pointer text-xs font-medium text-stone-600">{d.order_id ? 'A different order' : `Which order? ${d.vendor_name ?? 'The vendor'}'s orders`}</summary>
          <ul className="mt-1 divide-y divide-stone-200">
            {others.map((o) => {
              const label = o.po_number ? `PO ${o.po_number}` : o.description || 'the order'
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Link to={`${ROUTES.orders}/${o.id}`} className="font-medium text-brand hover:underline">{label}</Link>
                  <span className="text-xs text-stone-500">{[shortDate(o.order_date), o.est_cost != null ? money(o.est_cost) : null].filter(Boolean).join(' · ')}</span>
                  {canEdit ? <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => void answer(o.id, label)}>Put it on this order</Button> : null}
                </li>
              )
            })}
          </ul>
        </details>
      ) : !d.order_id && !orders.isLoading ? <p className="text-xs text-stone-500">This vendor has no orders in VMS.</p> : null}
      {canEdit ? <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(null, '')} leftIcon={<X className="size-4" aria-hidden="true" />}>Not for an order</Button> : null}
    </div>
  )
}
