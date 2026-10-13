import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, RotateCcw, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { freightQuoteAction, getFreightQuote, type FreightQuoteRow, type QuoteDetails } from '@/services/freightQuotes'
import { listOrders } from '@/services/orders'
import { ROUTES } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { cheapest, QUOTE_STATUS } from '@/lib/freightQuotes'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmailConversation } from '@/components/orders/EmailConversation'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'

/** One freight quote: the vendor's price and shipment details, our Priority One and WWEX prices, approve one. */
export default function FreightQuoteDetailPage() {
  const { id = '' } = useParams()
  const q = useSupabaseQuery(() => getFreightQuote(id), [id])
  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Not found'}</Alert>
  return <QuoteView quote={q.data} refetch={q.refetch} />
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[$,\s]/g, '')))

function QuoteView({ quote: f, refetch }: { quote: FreightQuoteRow; refetch: () => Promise<unknown> }) {
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [p1, setP1] = useState(f.priority_one_cost?.toString() ?? '')
  const [wwex, setWwex] = useState(f.wwex_cost?.toString() ?? '')
  const [note, setNote] = useState(f.our_note ?? '')
  const [busy, setBusy] = useState(false)
  const d = (f.details ?? {}) as QuoteDetails
  const best = cheapest({ vendor_cost: f.vendor_cost, priority_one_cost: num(p1), wwex_cost: num(wwex) })

  async function act(label: string, action: Parameters<typeof freightQuoteAction>[1], opts: Parameters<typeof freightQuoteAction>[2] = {}) {
    const bad = [p1, wwex].find((v) => v.trim() && Number.isNaN(num(v)))
    if (bad !== undefined) return toast.error(`"${bad}" is not a dollar amount`)
    setBusy(true)
    try {
      if (action === 'approve' || action === 'ours') await freightQuoteAction(f.id, 'ours', { priorityOne: num(p1), wwex: num(wwex), note })
      if (action !== 'ours') await freightQuoteAction(f.id, action, opts)
      toast.success(label)
      await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const choices: { key: 'vendor' | 'priority_one' | 'wwex'; label: string; cost: number | null }[] = [
    { key: 'vendor', label: `${f.vendor?.name ?? 'Vendor'}'s quote`, cost: f.vendor_cost === null ? null : Number(f.vendor_cost) },
    { key: 'priority_one', label: 'Priority One', cost: num(p1) },
    { key: 'wwex', label: 'WWEX', cost: num(wwex) },
  ]
  const approved = f.status === 'approved'

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <BackLink fallback={ROUTES.freightQuotes} fallbackLabel="Freight quotes" />
      <PageHeader eyebrow="Freight quote" title={f.vendor?.name ?? 'Vendor not known'}
        description={[f.email?.received_at ? `Received ${shortDate(f.email.received_at)}` : null, f.email?.from_name || f.email?.from_email].filter(Boolean).join(' · ') || undefined} />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3">
        <Badge tone={QUOTE_STATUS[f.status].tone}>{QUOTE_STATUS[f.status].text}</Badge>
        {f.order ? <Link to={`${ROUTES.orders}/${f.order.id}`} className="text-sm font-medium text-brand hover:underline">Order PO {f.order.po_number ?? '—'} · {shortDate(f.order.order_date)}{f.order.est_cost !== null ? ` · ${money(Number(f.order.est_cost))}` : ''}</Link> : null}
        {approved ? <span className="text-sm text-stone-700">Approved {choices.find((c) => c.key === f.approved_choice)?.label ?? 'other'} {money(f.approved_cost === null ? null : Number(f.approved_cost))}{f.approver ? ` by ${f.approver.full_name.split(' ')[0]}` : ''}{f.approved_at ? `, ${shortDate(f.approved_at)}` : ''}</span> : null}
      </div>

      {f.status === 'needs_order' ? <PickOrder quote={f} canEdit={canEdit} busy={busy} onPick={(order) => void act('Order picked', 'set_order', { order })} /> : null}

      <section className="mb-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">The vendor's quote</h2>
          <p className="mt-2 text-2xl font-semibold text-stone-900">{money(f.vendor_cost === null ? null : Number(f.vendor_cost))}</p>
          <p className="text-stone-700">{[f.vendor_carrier, f.vendor_service, f.transit].filter(Boolean).join(' · ') || 'No carrier given'}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Shipment details</h2>
          <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            {[['Ship from', [d.ship_from, d.ship_from_zip].filter(Boolean).join(' ')], ['Pickup', d.pickup_type], ['Ready', d.ready_date ? shortDate(d.ready_date) : null], ['Hours', d.pickup_hours], ['Contact', d.contact],
              ['Total weight', d.total_weight ? `${d.total_weight} lb` : null], ['Value', d.value ? money(d.value) : null], ['Hazardous', d.hazardous ? 'Yes' : null], ['Notes', d.notes]]
              .filter(([, v]) => v).map(([k, v]) => <div key={k as string} className="contents"><dt className="text-stone-500">{k}</dt><dd className="text-stone-900">{v}</dd></div>)}
          </dl>
          {d.cartons?.length ? <p className="mt-2 text-stone-800"><span className="text-stone-500">Cartons: </span>{d.cartons.map((c) => `${c.count} × ${[c.length, c.width, c.height].every((x) => x) ? `${c.length}×${c.width}×${c.height} in` : 'size not given'}${c.weight ? `, ${c.weight} lb` : ''}`).join('; ')}</p> : null}
          {d.pallets?.length ? <p className="mt-1 text-stone-800"><span className="text-stone-500">Pallets: </span>{d.pallets.map((p) => `${p.count} × ${[p.length, p.width, p.height].every((x) => x) ? `${p.length}×${p.width}×${p.height} in` : 'size not given'}${p.weight ? `, ${p.weight} lb` : ''}${p.freight_class ? `, class ${p.freight_class}` : ''}${p.stackable === false ? ', not stackable' : ''}`).join('; ')}</p> : null}
          {!d.cartons?.length && !d.pallets?.length ? <p className="mt-2 text-amber-800">No carton or pallet sizes yet: ask the vendor for them to get our own prices.</p> : null}
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Our prices</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <FormField label="Priority One" htmlFor="fq-p1"><Input id="fq-p1" inputMode="decimal" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="$" disabled={!canEdit || approved} /></FormField>
          <FormField label="WWEX" htmlFor="fq-wwex"><Input id="fq-wwex" inputMode="decimal" value={wwex} onChange={(e) => setWwex(e.target.value)} placeholder="$" disabled={!canEdit || approved} /></FormField>
          <FormField label="Note" htmlFor="fq-note"><Input id="fq-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} /></FormField>
        </div>
        {canEdit && !approved ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {choices.map((c) => (
              <Button key={c.key} variant={c.cost !== null && c.cost === best ? 'primary' : 'secondary'} disabled={c.cost === null || !f.order_id} loading={busy}
                onClick={() => void act(`Approved ${c.label}`, 'approve', { choice: c.key, cost: c.cost })} leftIcon={<Check className="size-4" aria-hidden="true" />}>
                Approve {c.label} {money(c.cost)}{c.cost !== null && c.cost === best ? ' (cheapest)' : ''}
              </Button>
            ))}
            <Button variant="ghost" loading={busy} onClick={() => void act('Prices saved', 'ours')}>Save prices</Button>
            <Button variant="ghost" loading={busy} onClick={() => void act('Marked not a freight quote', 'decline')} leftIcon={<X className="size-4" aria-hidden="true" />}>Not a freight quote</Button>
          </div>
        ) : null}
        {canEdit && (approved || f.status === 'declined') ? <Button className="mt-4" variant="ghost" loading={busy} onClick={() => void act('Opened again', 'reopen')} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>Change it</Button> : null}
        {!f.order_id && canEdit ? <p className="mt-2 text-xs text-stone-500">Pick the order first, then approve.</p> : null}
      </section>

      <EmailConversation emailId={f.email_id} orderId={f.order_id} canEdit={canEdit} onShared={() => void refetch()} note="" />
    </div>
  )
}

/** "Which order?": the vendor's open orders, newest first. */
function PickOrder({ quote, canEdit, busy, onPick }: { quote: FreightQuoteRow; canEdit: boolean; busy: boolean; onPick: (orderId: string) => void }) {
  const { organization } = useAuth()
  const orders = useSupabaseQuery(async () => (organization && quote.vendor ? listOrders(organization.id, { vendorId: quote.vendor.id, limit: 60 }) : []), [organization?.id, quote.vendor?.id])
  const [pick, setPick] = useState('')
  const open = (orders.data ?? []).filter((o) => ['open', 'awaiting_confirmation', 'confirmed'].includes(o.status))
  return (
    <Alert variant="warning" className="mb-4">
      <p>Claude could not tell which order this freight quote is for. Pick it:</p>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className={cn('h-9 max-w-md text-sm')} aria-label="Order">
            <option value="">{orders.isLoading ? 'Loading orders…' : quote.vendor ? 'Choose an order' : 'The vendor is not known: file the email first'}</option>
            {(open.length ? open : orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{[shortDate(o.order_date), o.po_number ? `PO ${o.po_number}` : null, o.est_cost !== null ? money(Number(o.est_cost)) : null, o.description?.slice(0, 40)].filter(Boolean).join(' · ')}</option>)}
          </Select>
          <Button size="sm" disabled={!pick} loading={busy} onClick={() => onPick(pick)}>Use this order</Button>
        </div>
      ) : null}
    </Alert>
  )
}
