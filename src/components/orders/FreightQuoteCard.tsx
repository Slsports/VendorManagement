import { Link } from 'react-router-dom'
import { Calculator } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOrderFreightQuotes } from '@/services/freightQuotes'
import { ROUTES } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { QUOTE_STATUS } from '@/lib/freightQuotes'
import { Badge } from '@/components/ui'

const CHOICE: Record<string, string> = { vendor: "the vendor's quote", priority_one: 'Priority One', wwex: 'WWEX', other: 'other' }

/**
 * Freight quote on an order (Dana, Oct 13: "No order is to be shipped without a freight quote from the vendor"): waiting
 * on Trevor's approval, or approved with the price; a warning when it shipped without one.
 */
export function FreightQuoteCard({ orderId, status, freeShipping, webOrders }: { orderId: string; status: string; freeShipping: boolean | null; webOrders: boolean }) {
  const q = useSupabaseQuery(() => listOrderFreightQuotes(orderId), [orderId])
  const quotes = (q.data ?? []).filter((x) => x.status !== 'declined')
  const approved = quotes.find((x) => x.status === 'approved')
  const shipped = ['shipped', 'received'].includes(status)
  // nothing to show for free-freight and web orders, or orders past receiving, unless a quote came in
  if (!quotes.length && (freeShipping || webOrders || ['entered', 'ready_to_pay', 'paid', 'cancelled'].includes(status))) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Calculator className="size-4" aria-hidden="true" />Freight quote</h2>
      {approved ? (
        <p className="mt-2 text-sm text-stone-800">Approved {CHOICE[approved.approved_choice ?? 'other']} <span className="font-semibold">{money(approved.approved_cost === null ? null : Number(approved.approved_cost))}</span>{approved.approved_at ? ` on ${shortDate(approved.approved_at)}` : ''}. <Link to={`${ROUTES.freightQuotes}/${approved.id}`} className="font-medium text-brand hover:underline">See it</Link></p>
      ) : quotes.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {quotes.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2"><Badge tone={QUOTE_STATUS[x.status].tone}>{QUOTE_STATUS[x.status].text}</Badge><Link to={`${ROUTES.freightQuotes}/${x.id}`} className="font-medium text-brand hover:underline">Vendor quote {money(x.vendor_cost === null ? null : Number(x.vendor_cost))}</Link></li>)}
        </ul>
      ) : shipped ? (
        <p className="mt-2 text-sm font-medium text-red-800">Shipped without an approved freight quote.</p>
      ) : (
        <p className="mt-2 text-sm text-stone-600">No freight quote yet. The vendor should send one before it ships.</p>
      )}
    </section>
  )
}
