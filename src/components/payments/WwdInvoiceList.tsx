import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listWwdInvoices, updateWwdInvoice, type WwdInvoiceRow } from '@/services/wwd'
import { vendorOrderSummary } from '@/services/orders'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Badge, Button, Select } from '@/components/ui'

const KIND = { invoice: null, credit: { label: 'Credit', tone: 'success' }, debit: { label: 'Debit', tone: 'warning' }, fee: { label: 'Membership fee', tone: 'neutral' } } as const

function paidText(i: WwdInvoiceRow): string {
  const refs = [...new Set(i.wwd_payment_lines.map((l) => l.wwd_payments?.ref).filter(Boolean))]
  if (i.paid_date) return `Paid ${shortDate(i.paid_date)}${refs.length ? ` · ${refs.join(', ')}` : ''}`
  if (i.sheet_paid_date) return `Paid ${shortDate(i.sheet_paid_date)} (your sheet; WWD payment # comes with the next Payment History)`
  return 'Not paid yet'
}

/**
 * WWD invoices for a vendor or an order (Dana, Oct 9): WWD's number, the vendor's own invoice number, our
 * PO, amount, discount and when it was paid with which WWD payment. On a vendor page each invoice can be
 * tied to one of the vendor's orders (or untied); VMS ties them itself by PO or amount when it can.
 */
export function WwdInvoiceList({ vendorId, orderId, title = 'WWD invoices' }: { vendorId?: string; orderId?: string; title?: string }) {
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => listWwdInvoices({ vendorId, orderId }), [vendorId, orderId])
  const [all, setAll] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
  const orders = useSupabaseQuery(async () => (vendorId && linking ? (await vendorOrderSummary(vendorId)).orders : []), [vendorId, !!linking])
  const rows = q.data ?? []
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 8)
  const open = rows.filter((i) => i.kind !== 'fee' && !i.paid_date && !i.sheet_paid_date).reduce((s, i) => s + (i.amount ?? 0), 0)

  async function change(id: string, c: { orderId?: string; unlinkOrder?: boolean }) {
    setLinking(null)
    try {
      await updateWwdInvoice(id, c)
      toast.success(c.unlinkOrder ? 'Untied from the order' : 'Tied to the order')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
        <span className="text-sm text-stone-600">{rows.length}{open ? ` · ${money(open)} not paid yet` : ''}</span>
      </div>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {shown.map((i) => {
          const k = KIND[i.kind]
          return (
            <li key={i.id} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0">
                  <span className="font-medium text-stone-900">WWD #{i.seq}</span>
                  {k ? <Badge tone={k.tone} className="ml-2">{k.label}</Badge> : null}
                  <span className="text-stone-500"> · {shortDate(i.wwd_date)}</span>
                  {i.vendor_invoice_number ? <span className="text-stone-500"> · their invoice {i.vendor_invoice_number}</span> : null}
                  {i.po_number ? <span className="text-stone-500"> · PO {i.po_number}</span> : null}
                  {orderId && i.vendor ? <Link to={`${ROUTES.vendors}/${i.vendor.id}`} className="text-brand hover:underline"> · {i.vendor.name}</Link> : null}
                </span>
                <span className="font-medium text-stone-900">{money(i.amount ?? i.paid_amount)}{i.discount ? <span className="text-xs font-normal text-emerald-700"> − {money(i.discount)} discount</span> : null}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className={i.paid_date || i.sheet_paid_date ? 'text-stone-500' : 'font-medium text-amber-700'}>{paidText(i)}{i.due_date && !i.paid_date && !i.sheet_paid_date ? ` · due ${shortDate(i.due_date)}` : ''}</span>
                <span className="flex items-center gap-2">
                  {vendorId && i.order ? <Link to={`${ROUTES.orders}/${i.order.id}`} className="text-brand hover:underline">Order {shortDate(i.order.order_date)}{i.order.po_number ? ` · ${i.order.po_number}` : ''}</Link> : null}
                  {canEdit && vendorId && i.kind !== 'fee' ? (linking === i.id ? (
                    <span className="flex items-center gap-1">
                      <Select aria-label={`Order for WWD #${i.seq}`} className="h-8 w-64" defaultValue="" onChange={(e) => { if (e.target.value) void change(i.id, { orderId: e.target.value }) }}>
                        <option value="">{orders.isLoading ? 'Loading orders…' : 'Pick the order'}</option>
                        {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{shortDate(o.order_date)} · {money(o.final_cost ?? o.est_cost)}{o.po_number ? ` · ${o.po_number}` : ''}{o.description ? ` · ${o.description.slice(0, 30)}` : ''}</option>)}
                      </Select>
                      <Button size="sm" variant="ghost" onClick={() => setLinking(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setLinking(i.id)}>{i.order ? 'Change order' : 'Tie to an order'}</Button>
                  )) : null}
                  {canEdit && i.order ? <Button size="sm" variant="ghost" onClick={() => void change(i.id, { unlinkOrder: true })}>Untie</Button> : null}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {rows.length > 8 ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Button> : null}
    </section>
  )
}
