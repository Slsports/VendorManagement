import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ShoppingCart } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { finishOrderingItem, isOverdue, isPlaced, listOrderingItems, listPlacedAndConfirmed, moveOrderingItem, needsLsPo, onOrderingChanged, type OrderingOrderRow, type OrderingRow } from '@/services/ordering'
import { listWorkingOrders, type WorkingRow } from '@/services/mail'
import { senderLabel, workingStatus } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { money } from '@/lib/freight'
import { cn, errorMessage } from '@/lib/utils'
import { AddOrderDialog } from '@/components/orders/AddOrderDialog'
import { Button } from '@/components/ui'
import { SalesReportUpload } from './SalesReportUpload'
import { SuggestedOrderDialog } from './SuggestedOrder'

type Row = 'check' | 'to_order' | 'working' | 'placed' | 'confirmed' | 'overdue'
const ROWS: { id: Row; label: string; help: string }[] = [
  { id: 'check', label: 'Check stock', help: 'Flagged "Check if we need it". Upload the LS sales report to see what to order.' },
  { id: 'to_order', label: 'To order', help: 'Flagged "Remind me to order", or the stock check said we need it.' },
  { id: 'working', label: 'Working on', help: 'Email conversations flagged "Working on order" while an order goes back and forth with the rep.' },
  { id: 'placed', label: 'Placed', help: 'Sent to the rep, no confirmation yet.' },
  { id: 'confirmed', label: 'Confirmed', help: 'Confirmed by the vendor. Make the LS PO once it is confirmed.' },
  { id: 'overdue', label: 'Overdue', help: 'Confirmed, and more than 30 days past the ship date.' },
]
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString() : '')

/**
 * Dashboard (Dana, Oct 11–12): one Ordering card with the counts — Check stock, To order, Working on, Placed,
 * Confirmed, Overdue — and "LS PO needed" for confirmed orders that have no LS PO yet. Click a count for its list.
 */
export function OrderingCard() {
  const { organization } = useAuth()
  const { personId } = useViewAs()
  const flags = useSupabaseQuery(async () => (organization ? listOrderingItems(organization.id) : []), [organization?.id])
  const orders = useSupabaseQuery(async () => (organization ? listPlacedAndConfirmed(organization.id) : []), [organization?.id])
  // "Working on" (Dana, Oct 12): the emails flagged "Working on order", the step between To order and Placed
  const working = useSupabaseQuery(async () => (organization ? listWorkingOrders(organization.id, personId) : []), [organization?.id, personId])
  const { refetch: rf } = flags
  const { refetch: ro } = orders
  useEffect(() => onOrderingChanged(() => { void rf(); void ro() }), [rf, ro])
  const [open, setOpen] = useState<Row | 'ls_po' | null>(null)

  // flags: the person's own when the admin shows one person; orders are everyone's
  const myFlags = (flags.data ?? []).filter((f) => !personId || !f.assigned_to || f.assigned_to === personId)
  const all = orders.data ?? []
  const lists: Record<Row, OrderingRow[] | OrderingOrderRow[] | WorkingRow[]> = {
    check: myFlags.filter((f) => f.stage === 'check'),
    to_order: myFlags.filter((f) => f.stage === 'to_order'),
    working: working.data ?? [],
    placed: all.filter(isPlaced),
    confirmed: all.filter((o) => o.status === 'confirmed'),
    overdue: all.filter(isOverdue),
  }
  const lsPo = all.filter(needsLsPo)
  const needsAnswer = (working.data ?? []).filter((t) => workingStatus(t) === 'needs').length
  const loading = flags.isLoading || orders.isLoading || working.isLoading

  return (
    <div className={cn('rounded-2xl border bg-white shadow-sm', open ? 'col-span-full border-brand/40' : 'border-stone-200')}>
      <div className="px-5 pt-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><ShoppingCart className="size-4 text-brand" aria-hidden="true" /> Ordering</h3>
      </div>
      <div className="grid grid-cols-4 gap-1 p-3 sm:grid-cols-7">
        {ROWS.map((r) => {
          const n = lists[r.id].length
          return (
            <button key={r.id} type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}
              className={cn('rounded-xl px-2 py-2 text-center hover:bg-stone-50', open === r.id && 'bg-stone-100')}>
              <span className={cn('block text-2xl font-semibold tracking-tight', loading ? 'text-stone-300' : r.id === 'overdue' && n ? 'text-red-700' : 'text-stone-900')}>{loading ? '…' : n}</span>
              {r.id === 'working' && needsAnswer ? <span className="block text-[11px] font-semibold text-amber-700">{needsAnswer} need{needsAnswer === 1 ? 's' : ''} an answer</span> : null}
              <span className="block text-xs text-stone-600">{r.label}</span>
            </button>
          )
        })}
        <button type="button" onClick={() => setOpen(open === 'ls_po' ? null : 'ls_po')} aria-expanded={open === 'ls_po'}
          className={cn('rounded-xl px-2 py-2 text-center hover:bg-stone-50', open === 'ls_po' && 'bg-stone-100')}>
          <span className={cn('block text-2xl font-semibold tracking-tight', loading ? 'text-stone-300' : lsPo.length ? 'text-amber-600' : 'text-stone-900')}>{loading ? '…' : lsPo.length}</span>
          <span className="block text-xs text-stone-600">LS PO needed</span>
        </button>
      </div>
      {open ? (
        <div className="border-t border-stone-100 px-5 pb-5 pt-3">
          <p className="text-xs text-stone-500">{open === 'ls_po' ? 'Confirmed orders with no LS PO yet: make the PO in LS, then type its number on the order (or save the LS PO to the order).' : ROWS.find((r) => r.id === open)!.help}</p>
          {open === 'check' || open === 'to_order' ? <FlagList rows={lists[open] as OrderingRow[]} /> : open === 'working' ? <WorkingList rows={lists.working as WorkingRow[]} /> : <OrderList rows={open === 'ls_po' ? lsPo : lists[open] as OrderingOrderRow[]} showLsPo={open !== 'placed'} />}
        </div>
      ) : null}
    </div>
  )
}

function FlagList({ rows }: { rows: OrderingRow[] }) {
  const [suggest, setSuggest] = useState<{ id: string; name: string } | null>(null)
  const [placing, setPlacing] = useState<OrderingRow | null>(null)
  const act = (p: Promise<void>, msg: string) => void p.then(() => toast.success(msg)).catch((e) => toast.error(errorMessage(e)))
  if (!rows.length) return <p className="mt-2 text-sm text-stone-500">None. Flag a vendor from its page or a review card.</p>
  return (
    <>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {rows.map((f) => f.vendor ? (
          <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <Link to={`${ROUTES.vendors}/${f.vendor.id}`} className="font-medium text-stone-900 hover:text-brand">{f.vendor.name}</Link>
              <span className="block text-xs text-stone-500">
                {[f.assignee ? `for ${f.assignee.full_name.split(' ')[0]}` : null, f.flagger ? `flagged by ${f.flagger.full_name.split(' ')[0]}` : null, new Date(f.created_at).toLocaleDateString(), f.note].filter(Boolean).join(' · ')}
              </span>
            </span>
            {f.stage === 'check' && !f.report_id ? <SalesReportUpload vendor={f.vendor} onSaved={() => setSuggest(f.vendor)} /> : null}
            {f.report_id ? <Button size="sm" variant="secondary" onClick={() => setSuggest(f.vendor)}>Suggested order</Button> : null}
            {f.stage === 'check' ? <Button size="sm" variant="ghost" onClick={() => act(moveOrderingItem(f.id, 'to_order'), `${f.vendor!.name}: moved to To order`)}>Order it</Button> : null}
            {f.stage === 'to_order' && !f.report_id ? <Button size="sm" variant="secondary" onClick={() => setPlacing(f)}>Order placed</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => act(finishOrderingItem(f.id, f.stage === 'check' ? 'not_needed' : 'removed'), f.stage === 'check' ? `${f.vendor!.name}: not needed` : 'Taken off the list')}>{f.stage === 'check' ? "Don't need it" : 'Remove'}</Button>
          </li>
        ) : null)}
      </ul>
      {suggest ? <SuggestedOrderDialog vendor={suggest} onClose={() => setSuggest(null)} /> : null}
      {placing?.vendor ? <AddOrderDialog vendor={placing.vendor} threadId={placing.thread_id ?? undefined} onClose={() => setPlacing(null)} onSaved={(o) => finishOrderingItem(placing.id, 'ordered', o.id)} /> : null}
    </>
  )
}

function OrderList({ rows, showLsPo }: { rows: OrderingOrderRow[]; showLsPo: boolean }) {
  if (!rows.length) return <p className="mt-2 text-sm text-stone-500">None.</p>
  return (
    <ul className="mt-2 divide-y divide-stone-100 text-sm">
      {rows.slice(0, 50).map((o) => (
        <li key={o.id}>
          <Link to={`${ROUTES.orders}/${o.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand">
            <span className="min-w-0 truncate"><span className="font-medium text-stone-900">{o.vendor?.name ?? 'Order'}</span>{o.po_number ? ` · PO ${o.po_number}` : ''}{o.description ? <span className="text-stone-500"> · {o.description}</span> : null}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
              {showLsPo && needsLsPo(o) ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">LS PO needed</span> : null}
              {o.est_ship_date ? <span className={cn(isOverdue(o) && 'font-semibold text-red-700')}>ships {day(o.est_ship_date)}</span> : null}
              {o.est_cost !== null ? <span>{money(o.est_cost)}</span> : null}
            </span>
          </Link>
        </li>
      ))}
      {rows.length > 50 ? <li className="py-2 text-xs text-stone-500">and {rows.length - 50} more on the Orders page</li> : null}
    </ul>
  )
}

function WorkingList({ rows }: { rows: WorkingRow[] }) {
  return (
    <>
      {rows.length === 0 ? <p className="mt-2 text-sm text-stone-500">None. On an email, click <span className="font-medium">Working on order</span> while an order goes back and forth.</p> : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {rows.slice(0, 25).map((t) => (
            <li key={t.id}>
              <Link to={`${ROUTES.mail}/${t.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand">
                <span className="min-w-0 truncate"><span className="font-medium text-stone-900">{t.vendor?.name ?? senderLabel(t.last)}</span> · {t.subject || '(no subject)'}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
                  {t.working_person ? <span>{t.working_person.full_name.split(' ')[0]}</span> : null}
                  {workingStatus(t) === 'needs' ? <span className="font-semibold text-amber-700">needs an answer</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to={ROUTES.workingOrders} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Open the full list</Link>
    </>
  )
}
