import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { poAskLine, poAsksForOrder } from '@/services/poAsks'
import { matchLink } from '@/lib/mailSearch'
import { ROUTES } from '@/lib/constants'
import type { Order } from '@/types'

/**
 * Our PO on the order, and each time we asked the vendor to add or use it (Dana, Oct 24): asked when, what they answered,
 * with the emails one click away. No answer shows "Asked to use our PO" with the date.
 */
export function OrderPoCard({ order }: { order: Pick<Order, 'id' | 'po_number' | 'po_auto'> }) {
  const q = useSupabaseQuery(() => poAsksForOrder(order.id), [order.id])
  const asks = q.data ?? []
  const waiting = asks.some((a) => a.status === 'asked' || a.status === 'yes' || a.status === 'drafted')
  const link = 'inline-flex items-center gap-1 text-brand hover:underline'
  return (
    <section className={`rounded-2xl border p-5 text-sm ${waiting ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Our PO</h2>
      <p className="mt-2 text-stone-900">
        {order.po_number ? <strong>{order.po_number}</strong> : 'None yet'}
        {order.po_auto ? <span className="text-stone-500"> · made by VMS from the order date</span> : null}
      </p>
      {asks.map((a) => (
        <div key={a.id} className="mt-2 border-t border-stone-200 pt-2">
          <p className="text-stone-800">{a.status === 'asked' ? <strong>{a.kind === 'add' ? 'Asked to add our PO' : 'Asked to use our PO'}{a.asked_at ? ` ${new Date(a.asked_at).toLocaleDateString()}` : ''}. </strong> : null}{poAskLine(a)}</p>
          <p className="mt-1 flex flex-wrap gap-x-3">
            {a.check ? <Link to={`${ROUTES.orders}/paperwork/${a.check_id}`} className={link}>Their confirmation{a.check.doc_number ? ` ${a.check.doc_number}` : ''}</Link> : null}
            {a.ask_email ? <Link to={matchLink(a.ask_email.thread_id, { email_id: a.ask_email_id! })} className={link}><Mail className="size-3.5" aria-hidden="true" />Our email</Link> : null}
            {a.answer_email ? <Link to={matchLink(a.answer_email.thread_id, { email_id: a.answer_email_id! })} className={link}><Mail className="size-3.5" aria-hidden="true" />Their answer</Link> : null}
            {a.status === 'drafted' && a.draft_id ? <Link to={`${ROUTES.mail}?view=drafts&draft=${a.draft_id}`} className={link}><Mail className="size-3.5" aria-hidden="true" />Open the email</Link> : null}
            {a.thanks_draft_id ? <Link to={`${ROUTES.mail}?view=drafts&draft=${a.thanks_draft_id}`} className={link}><Mail className="size-3.5" aria-hidden="true" />The thank-you (Drafts)</Link> : null}
            {a.new_check_id ? <Link to={`${ROUTES.orders}/paperwork/${a.new_check_id}`} className={link}>The updated confirmation</Link> : null}
          </p>
        </div>
      ))}
    </section>
  )
}
