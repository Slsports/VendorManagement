import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { CircleCheck, PackageCheck } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getShipStep, orderShipAction } from '@/services/orders'
import type { Order } from '@/types'
import { errorMessage, shortDate } from '@/lib/utils'
import { Button } from '@/components/ui'
import { FreightEmailButton } from '@/components/orders/FreightEmailButton'
import { SharedFreightPick } from '@/components/freight/SharedFreightPick'

const BEFORE = ['open', 'awaiting_confirmation']
const RECEIVED = ['received', 'entered', 'ready_to_pay', 'paid']

/**
 * Shipping & receiving (Dana, Oct 20): once the confirmation is approved the order goes to Trevor. The shipping email
 * with our routing instructions opens right here; the LS PO is in its own box; Mark received closes his task.
 */
export function ShipCard({ order, canEdit, onChange, focus = false }: {
  order: Pick<Order, 'id' | 'status' | 'date_received' | 'ship_email_sent_at'> & { vendor?: { web_orders: boolean } | null }
  canEdit: boolean; onChange: () => void; focus?: boolean
}) {
  const step = useSupabaseQuery(() => getShipStep(order.id), [order.id, order.status])
  const box = useRef<HTMLElement>(null)
  useEffect(() => { if (focus) box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [focus])
  const [busy, setBusy] = useState<string | null>(null)
  if (BEFORE.includes(order.status) || order.status === 'cancelled' || order.vendor?.web_orders) return null
  const s = step.data
  const received = RECEIVED.includes(order.status)

  async function act(action: 'start' | 'received') {
    if (action === 'received' && !window.confirm('Mark this order received? Trevor\'s task closes.')) return
    setBusy(action)
    try {
      await orderShipAction(order.id, action)
      toast.success(action === 'start' ? 'Handed to logistics' : 'Marked received')
      await step.refetch()
      onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section ref={box} className={`rounded-2xl border p-5 ${s?.task && !s.task.done_at ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'} ${focus ? 'ring-4 ring-brand/40' : ''}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Shipping & receiving</h2>
      {s?.task?.assignee ? <p className="mt-1 text-xs text-stone-600">With {s.task.assignee.full_name.split(' ')[0]}{s.task.done_at ? ' · done' : ''}</p> : null}
      <ol className="mt-3 space-y-3 text-sm">
        <li>
          <p className="font-medium text-stone-800">1. Freight email (our routing letter attached)</p>
          {order.ship_email_sent_at ? (
            <p className="mt-1 flex items-center gap-1.5 text-emerald-800"><CircleCheck className="size-4" aria-hidden="true" />Sent {shortDate(order.ship_email_sent_at)}</p>
          ) : s?.request_status === 'skipped' ? (
            <p className="mt-1 text-xs text-stone-500">Not needed for this order.</p>
          ) : null}
          {canEdit ? <div className="mt-1"><FreightEmailButton orderId={order.id} label={order.ship_email_sent_at ? 'Send again' : 'Freight email'} onSent={() => { void step.refetch(); onChange() }} /></div> : null}
        </li>
        <li>
          <p className="font-medium text-stone-800">2. Route the freight and finish the LS PO</p>
          <p className="mt-1 text-xs text-stone-500">The freight quote and LS PO boxes on this page.</p>
        </li>
        <li>
          <p className="font-medium text-stone-800">3. Receive it</p>
          {received ? (
            <p className="mt-1 flex items-center gap-1.5 text-emerald-800"><CircleCheck className="size-4" aria-hidden="true" />Received{order.date_received ? ` ${shortDate(order.date_received)}` : ''}</p>
          ) : canEdit ? (
            <Button size="sm" variant="secondary" className="mt-1" loading={busy === 'received'} onClick={() => void act('received')} leftIcon={<PackageCheck className="size-4" aria-hidden="true" />}>Mark received</Button>
          ) : null}
          <SharedFreightPick orderId={order.id} canEdit={canEdit} />
        </li>
      </ol>
      {!step.isLoading && !s?.task && order.status === 'confirmed' && canEdit ? (
        <div className="mt-3 border-t border-stone-200 pt-3">
          <p className="text-xs text-stone-500">Not handed to logistics yet.</p>
          <Button size="sm" className="mt-1" loading={busy === 'start'} onClick={() => void act('start')}>Hand it to logistics</Button>
        </div>
      ) : null}
    </section>
  )
}
