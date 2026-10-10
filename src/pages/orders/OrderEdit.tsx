import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getOrder, updateOrder, type OrderDetail } from '@/services/orders'
import { BILLING_ROUTE_LABELS, PAID_VIA_LABELS } from '@/lib/vendors'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { BillingRoute, Order } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { Alert, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

const STORES = ['SLS', 'SLH', 'SLM', 'GS'] as const

type Form = {
  order_date: string; placed_by: string; store_codes: string[]; billing_route: BillingRoute | ''; po_number: string; description: string
  est_ship_date: string; est_cost: string; freight_cost: string; freight_notes: string
  date_received: string; backorder: boolean; shipment_notes: string; date_entered_ls: string; entered_by: string
  ar_due: string; ar_due_date: string; ok_to_pay: boolean; final_cost: string; paid_date: string; paid_via: NonNullable<Order['paid_via']> | ''; paid_ref: string
  credits_due: boolean; credit_notes: string; date_credits_received: string; notes: string
}

const s = (v: string | null | undefined) => v ?? ''
const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

function formFrom(o: OrderDetail): Form {
  return {
    order_date: s(o.order_date), placed_by: s(o.placed_by), store_codes: o.store_codes, billing_route: o.billing_route ?? '', po_number: s(o.po_number), description: s(o.description),
    est_ship_date: s(o.est_ship_date), est_cost: n(o.est_cost), freight_cost: n(o.freight_cost), freight_notes: s(o.freight_notes),
    date_received: s(o.date_received), backorder: o.backorder, shipment_notes: s(o.shipment_notes), date_entered_ls: s(o.date_entered_ls), entered_by: s(o.entered_by),
    ar_due: s(o.ar_due), ar_due_date: s(o.ar_due_date), ok_to_pay: o.ok_to_pay, final_cost: n(o.final_cost), paid_date: s(o.paid_date), paid_via: o.paid_via ?? '', paid_ref: s(o.paid_ref),
    credits_due: o.credits_due, credit_notes: s(o.credit_notes), date_credits_received: s(o.date_credits_received), notes: s(o.notes),
  }
}

const nz = (v: string) => (v.trim() ? v.trim() : null)
const num = (v: string) => { const t = v.replace(/[$,\s]/g, ''); return t && Number.isFinite(Number(t)) ? Number(t) : null }

/** Edit an order (Dana, Oct 10: "How can I change the order date on an order?"): every date and detail the sheet tracks. */
export default function OrderEditPage() {
  const { id = '' } = useParams()
  const q = useSupabaseQuery(() => getOrder(id), [id])
  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading order…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Order not found'}</Alert>
  return <OrderEditForm order={q.data} />
}

function OrderEditForm({ order: o }: { order: OrderDetail }) {
  const navigate = useNavigate()
  const [f, setF] = useState<Form>(() => formFrom(o))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const leave = () => navigate(`${ROUTES.orders}/${o.id}`, { replace: true })

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateOrder(o.id, {
        order_date: f.order_date || null, placed_by: nz(f.placed_by), store_codes: f.store_codes, billing_route: f.billing_route || null, po_number: nz(f.po_number), description: nz(f.description),
        est_ship_date: f.est_ship_date || null, est_cost: num(f.est_cost), freight_cost: num(f.freight_cost), freight_notes: nz(f.freight_notes),
        date_received: f.date_received || null, backorder: f.backorder, shipment_notes: nz(f.shipment_notes), date_entered_ls: f.date_entered_ls || null, entered_by: nz(f.entered_by),
        ar_due: nz(f.ar_due), ar_due_date: f.ar_due_date || null, ok_to_pay: f.ok_to_pay, final_cost: num(f.final_cost), paid_date: f.paid_date || null, paid_via: f.paid_via || null, paid_ref: nz(f.paid_ref),
        credits_due: f.credits_due, credit_notes: nz(f.credit_notes), date_credits_received: f.date_credits_received || null, notes: nz(f.notes),
      })
      toast.success('Order saved')
      leave()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const date = (k: keyof Form, label: string) => (
    <FormField label={label} htmlFor={`f-${k}`}><Input id={`f-${k}`} type="date" value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} /></FormField>
  )
  const text = (k: keyof Form, label: string, placeholder?: string) => (
    <FormField label={label} htmlFor={`f-${k}`}><Input id={`f-${k}`} value={f[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} /></FormField>
  )
  const money = (k: keyof Form, label: string) => (
    <FormField label={label} htmlFor={`f-${k}`}><Input id={`f-${k}`} inputMode="decimal" value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} /></FormField>
  )
  const check = (k: keyof Form, label: string) => (
    <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={f[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} /> {label}</label>
  )
  const box = 'rounded-2xl border border-stone-200 bg-white p-5'
  const grid = 'mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div>
      <BackLink fallback={`${ROUTES.orders}/${o.id}`} fallbackLabel="Order" />
      <PageHeader eyebrow="Edit order" title={o.vendor?.name ?? 'Order'} />
      <form onSubmit={save} noValidate className="space-y-6">
        <section className={box}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Order</h2>
          <div className={grid}>
            {date('order_date', 'Ordered')}
            {text('placed_by', 'Placed by')}
            {text('po_number', 'PO')}
            <FormField label="Route" htmlFor="f-route">
              <Select id="f-route" value={f.billing_route} onChange={(e) => set('billing_route', e.target.value as BillingRoute | '')}>
                <option value="">Not set</option>
                {(Object.keys(BILLING_ROUTE_LABELS) as BillingRoute[]).map((r) => <option key={r} value={r}>{BILLING_ROUTE_LABELS[r]}</option>)}
              </Select>
            </FormField>
            {money('est_cost', 'Est. cost')}
            {date('est_ship_date', 'Est. ship')}
            <FormField label="What was ordered" htmlFor="f-description" className="sm:col-span-2 lg:col-span-3"><Textarea id="f-description" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></FormField>
            <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-3">
              <span className="text-sm font-medium text-stone-700">Store</span>
              {STORES.map((st) => (
                <label key={st} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={f.store_codes.includes(st)} onChange={(e) => set('store_codes', e.target.checked ? [...f.store_codes, st] : f.store_codes.filter((x) => x !== st))} />{st}</label>
              ))}
            </div>
          </div>
        </section>

        <section className={box}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Freight, receiving and entry</h2>
          <div className={grid}>
            {money('freight_cost', 'Freight cost')}
            {text('freight_notes', 'Freight notes', 'e.g. FREE @ $500')}
            {date('date_received', 'Received')}
            {date('date_entered_ls', 'Entered in LS')}
            {text('entered_by', 'Entered by')}
            <div className="flex items-end pb-2">{check('backorder', 'Backorder')}</div>
            <FormField label="Shipment notes" htmlFor="f-shipment_notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="f-shipment_notes" rows={2} value={f.shipment_notes} onChange={(e) => set('shipment_notes', e.target.value)} /></FormField>
          </div>
        </section>

        <section className={box}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Payment and credits</h2>
          <div className={grid}>
            {text('ar_due', 'Terms', 'e.g. NET 60')}
            {date('ar_due_date', 'Due')}
            {money('final_cost', 'Final cost')}
            {date('paid_date', 'Paid')}
            <FormField label="Paid via" htmlFor="f-paid_via">
              <Select id="f-paid_via" value={f.paid_via} onChange={(e) => set('paid_via', e.target.value as Form['paid_via'])}>
                <option value="">Not paid / not set</option>
                {(Object.keys(PAID_VIA_LABELS) as NonNullable<Order['paid_via']>[]).map((p) => <option key={p} value={p}>{PAID_VIA_LABELS[p]}</option>)}
              </Select>
            </FormField>
            {text('paid_ref', 'Payment reference', 'Bill.com # or WWD payment #')}
            <div className="flex items-end pb-2">{check('ok_to_pay', 'OK to pay')}</div>
            <div className="flex items-end pb-2">{check('credits_due', 'Credits due')}</div>
            {date('date_credits_received', 'Credits received')}
            <FormField label="Credit notes" htmlFor="f-credit_notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="f-credit_notes" rows={2} value={f.credit_notes} onChange={(e) => set('credit_notes', e.target.value)} /></FormField>
            <FormField label="Dana's notes" htmlFor="f-notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="f-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
          </div>
        </section>

        <StickySaveBar saving={saving} error={error} onCancel={leave} />
      </form>
    </div>
  )
}
