import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getOrder, updateOrder } from '@/services/orders'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ROUTES, type OrderStatus } from '@/lib/constants'
import { BILLING_ROUTE_LABELS, PAID_VIA_LABELS, money, showLabel } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { OrderDocumentsSection } from '@/components/orders/OrderDocumentsSection'
import { OrderRepsCard } from '@/components/orders/OrderRepsCard'
import { FreeShippingCard } from '@/components/orders/FreeShippingCard'
import { Alert, Badge, Select, Spinner } from '@/components/ui'

const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString() : null)

export default function OrderDetailPage() {
  const { id = '' } = useParams()
  const { role, profile } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => getOrder(id), [id])
  const o = q.data
  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading order…" className="text-brand" /></div>
  if (q.error || !o) return <Alert variant="error">{q.error ?? 'Order not found'}</Alert>

  async function setStatus(status: OrderStatus) {
    try {
      await updateOrder(o!.id, { status })
      toast.success(`Now ${ORDER_STATUS_LABELS[status].toLowerCase()}`)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const groups: [string, [string, string | number | null | undefined][]][] = [
    ['Order', [
      ['Ordered', d(o.order_date)], ['Season', o.season], ['Show', o.show_code ? `${showLabel(o.show_code)}${o.show_inferred ? ' (inferred from the date)' : ''}` : null],
      ['Placed by', o.placed_by], ['Store', o.store_codes.join(', ')], ['Route', o.billing_route ? BILLING_ROUTE_LABELS[o.billing_route] : null],
      ['Est. cost', money(o.est_cost)], ['Freight', o.freight_cost !== null ? money(o.freight_cost) : o.freight_notes], ['Est. ship', d(o.est_ship_date)], ['PO', o.po_number],
    ]],
    ['Receiving & entry', [
      ['Received', d(o.date_received)], ['Backorder', o.backorder ? 'Yes' : null], ['Shipment notes', o.shipment_notes],
      ['Entered in LS', d(o.date_entered_ls)], ['Entered by', o.entered_by],
    ]],
    ['Payment', [
      ['Terms', o.ar_due], ['Due', d(o.ar_due_date)], ['OK to pay', o.ok_to_pay ? 'Yes' : null], ['Final cost', money(o.final_cost)],
      ['Paid', d(o.paid_date)], ['Paid via', o.paid_via ? PAID_VIA_LABELS[o.paid_via] : null], ['WWD reference', o.paid_ref], ['Cost basis', money(o.cost_basis)],
    ]],
    ['Credits', [
      ['Credits due', o.credits_due ? 'Yes' : null], ['Credit notes', o.credit_notes], ['Credits received', d(o.date_credits_received)],
    ]],
  ]
  const extra = Object.entries((o.extra ?? {}) as Record<string, string>)

  return (
    <div>
      <BackLink fallback={ROUTES.orders} fallbackLabel="Orders" />
      <PageHeader
        eyebrow="Order"
        title={o.vendor ? o.vendor.name : 'Order'}
        description={<span className="inline-flex flex-wrap items-center gap-2"><OrderStatusBadge status={o.status} />{o.order_date ? <span>{d(o.order_date)}</span> : null}{o.source !== 'manual' ? <Badge tone="neutral">from {o.source.replaceAll('_', ' ')}</Badge> : null}</span>}
        actions={canEdit ? (
          <Select value={o.status} onChange={(e) => void setStatus(e.target.value as OrderStatus)} aria-label="Change status" className="h-9 w-52">
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
          </Select>
        ) : undefined}
      />
      {o.description ? <p className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 text-stone-900">{o.description}</p> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {groups.map(([title, facts]) => {
            const shown = facts.filter(([, v]) => v !== null && v !== undefined && v !== '')
            if (!shown.length) return null
            return (
              <section key={title} className="rounded-2xl border border-stone-200 bg-white p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
                <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map(([k, v]) => <div key={k}><dt className="text-xs font-medium text-stone-500">{k}</dt><dd className="text-sm text-stone-900">{String(v)}</dd></div>)}
                </dl>
              </section>
            )
          })}
          {o.notes ? <section className="rounded-2xl border border-stone-200 bg-white p-5"><h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Dana's notes</h2><p className="mt-2 whitespace-pre-line text-sm text-stone-800">{o.notes}</p></section> : null}
          {extra.length ? <section className="rounded-2xl border border-stone-200 bg-white p-5"><h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Also on the sheet</h2><dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">{extra.map(([k, v]) => <div key={k}><dt className="text-xs font-medium text-stone-500">{k}</dt><dd className="text-sm text-stone-900">{v}</dd></div>)}</dl></section> : null}
        </div>
        <div className="space-y-6">
          {o.vendor ? <OrderRepsCard orderId={o.id} vendorId={o.vendor.id} takenBy={o.taken_by} canEdit={canEdit} onChange={q.refetch} /> : null}
          <FreeShippingCard order={o} vendor={o.vendor} canEdit={canEdit} onChange={q.refetch} />
          {o.vendor ? <OrderDocumentsSection orderId={o.id} vendorId={o.vendor.id} organizationId={o.organization_id} userId={profile?.id ?? null} documents={o.documents} canEdit={canEdit} onChange={q.refetch} /> : null}
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">History</h2>
            <ul className="mt-3 space-y-1 text-sm text-stone-700">
              {o.order_status_history.map((h) => <li key={h.id}>{new Date(h.changed_at).toLocaleDateString()} · {h.from_status ? `${ORDER_STATUS_LABELS[h.from_status]} → ` : ''}{ORDER_STATUS_LABELS[h.to_status]}</li>)}
            </ul>
            {o.vendor ? <Link to={`${ROUTES.vendors}/${o.vendor.id}`} className="mt-3 inline-block text-sm text-brand hover:underline">Open {o.vendor.name}</Link> : null}
          </section>
        </div>
      </div>
    </div>
  )
}
