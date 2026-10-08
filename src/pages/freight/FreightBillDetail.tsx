import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, ExternalLink, FileText, Mail, RefreshCw, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getFreightBill, listVendorOrdersForFreight, readFreightBill, setFreightBillPaid, setFreightBillStatus, setFreightLine, uploadFreightPdf, type FreightBillDetail } from '@/services/freight'
import { downloadVendorFile } from '@/services/lines'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { ROUTES } from '@/lib/constants'
import { FREIGHT_STATUS, money, shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { Modal } from '@/components/shared/Modal'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'

export default function FreightBillDetailPage() {
  const { id = '' } = useParams()
  const { role, profile } = useAuth()
  const [paying, setPaying] = useState(false)
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => getFreightBill(id), [id])
  const [busy, setBusy] = useState(false)
  const { view, viewer } = useDocumentViewer()
  const fileInput = useRef<HTMLInputElement>(null)
  const b = q.data

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading freight bill…" className="text-brand" /></div>
  if (q.error || !b) return <Alert variant="error">{q.error ?? 'Freight bill not found'}</Alert>

  const st = FREIGHT_STATUS[b.status]
  const linesTotal = b.freight_bill_lines.reduce((n, l) => n + Number(l.amount), 0) + Number(b.fee_amount)

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      toast.success(label)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
      await q.refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      {viewer}
      <BackLink fallback={ROUTES.freight} fallbackLabel="Freight bills" />
      <PageHeader
        eyebrow="Freight bill"
        title={`${b.carriers?.name ?? 'Carrier'}${b.invoice_number ? ` #${b.invoice_number}` : ''}`}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge>
          <span>Billed {shortDate(b.invoice_date)}{b.due_date ? ` · due ${shortDate(b.due_date)}` : ''} · {money(b.total)}</span>
          {b.paid_date ? <Badge tone="success">Paid {shortDate(b.paid_date)}{b.paid_via ? ` · ${PAID_LABELS[b.paid_via]}` : ''}{b.paid_ref ? ` · ${b.paid_ref}` : ''}</Badge> : null}</span>}
        actions={canEdit ? (
          <div className="flex flex-wrap gap-2">
            {b.paid_date
              ? <Button variant="ghost" disabled={busy} onClick={() => void act('Marked not paid', () => setFreightBillPaid(b.id, null))}>Not paid</Button>
              : <Button disabled={busy} onClick={() => setPaying(true)}>Mark paid</Button>}
            {b.status !== 'done' ? <Button variant="secondary" disabled={busy} onClick={() => void act('Marked done', () => setFreightBillStatus(b.id, 'done'))}>Mark done</Button> : null}
          </div>
        ) : undefined}
      />

      <section className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-stone-200 bg-white p-4 text-sm">
        {b.storage_path ? (
          <button type="button" className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => view({ name: b.file_name ?? 'Bill.pdf', mime: 'application/pdf', load: () => downloadVendorFile(b.storage_path!) })}>
            <FileText className="size-4" aria-hidden="true" /> {b.file_name ?? 'Bill PDF'}
          </button>
        ) : <span className="text-stone-600">No PDF yet.</span>}
        {b.carriers?.website ? <a href={b.carriers.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Log in to {b.carriers.name} <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
        {b.emails ? <Link to={`${ROUTES.mail}/${b.emails.thread_id}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail className="size-4" aria-hidden="true" /> The email</Link> : null}
        {b.receipt_path ? (
          <button type="button" className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => view({ name: b.receipt_file_name ?? 'Payment receipt.pdf', mime: 'application/pdf', load: () => downloadVendorFile(b.receipt_path!) })}>
            <FileText className="size-4" aria-hidden="true" /> Payment receipt
          </button>
        ) : null}
        {b.paid_date && b.paid_email ? (
          <Link to={`${ROUTES.mail}/${b.paid_email.thread_id}`} className="inline-flex items-center gap-1 text-stone-600 hover:text-brand">
            <Mail className="size-4" aria-hidden="true" /> {b.paid_source === 'email' ? 'Marked paid from our email' : 'Marked paid from the receipt'}
          </Link>
        ) : null}
        {canEdit ? (
          <span className="ml-auto flex gap-2">
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void act('Bill read: check the lines below', () => uploadFreightPdf(b, f))
            }} />
            <Button size="sm" variant={b.storage_path ? 'ghost' : 'primary'} loading={busy && !b.storage_path} onClick={() => fileInput.current?.click()} leftIcon={<Upload className="size-4" aria-hidden="true" />}>{b.storage_path ? 'Replace PDF' : 'Add the bill PDF'}</Button>
            {b.storage_path ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('Read again', () => readFreightBill(b.id))} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Read again</Button> : null}
          </span>
        ) : null}
      </section>
      {b.status === 'needs_pdf' ? <Alert variant="info" className="mb-6">This carrier does not attach the bill. Log in, download it, and add it here: Claude reads the shippers and amounts.</Alert> : null}
      {b.read_note ? <Alert variant="warning" className="mb-6">{b.read_note}</Alert> : null}

      {paying && profile ? <PaidDialog onClose={() => setPaying(false)} onSave={async (p) => { setPaying(false); await act('Marked paid', () => setFreightBillPaid(b.id, { ...p, paid_by: profile.id })) }} /> : null}
      {b.freight_bill_lines.length ? (
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <ul className="divide-y divide-stone-100">
            {b.freight_bill_lines.map((l) => <LineRow key={l.id} line={l} canEdit={canEdit} onChange={q.refetch} />)}
          </ul>
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-stone-100 px-4 py-3 text-sm">
            {Number(b.fee_amount) ? <span className="text-stone-600">Invoice fee {money(b.fee_amount)} <span className="text-xs text-stone-400">(on the biggest order)</span></span> : null}
            <span className="font-medium text-stone-900">Lines {money(linesTotal)}{b.total !== null && Math.abs(linesTotal - Number(b.total)) > 0.01 ? <span className="ml-2 text-xs font-normal text-red-700">bill says {money(b.total)}</span> : null}</span>
          </div>
        </section>
      ) : null}
    </div>
  )
}

const PAID_LABELS: Record<NonNullable<FreightBillDetail['paid_via']>, string> = { card: 'Card', check: 'Check', ach: 'ACH / bank', billcom: 'Bill.com', other: 'Other' }

function PaidDialog({ onClose, onSave }: { onClose: () => void; onSave: (p: { paid_date: string; paid_via: FreightBillDetail['paid_via']; paid_ref: string | null }) => void | Promise<void> }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [via, setVia] = useState<NonNullable<FreightBillDetail['paid_via']>>('card')
  const [ref, setRef] = useState('')
  return (
    <Modal title="Mark this bill paid" submitLabel="Mark paid" onClose={onClose} onSubmit={() => onSave({ paid_date: date, paid_via: via, paid_ref: ref.trim() || null })}>
      <FormField label="Paid on" htmlFor="fp-date"><Input id="fp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></FormField>
      <FormField label="Paid by" htmlFor="fp-via">
        <Select id="fp-via" value={via} onChange={(e) => setVia(e.target.value as typeof via)}>
          {(Object.keys(PAID_LABELS) as (keyof typeof PAID_LABELS)[]).map((k) => <option key={k} value={k}>{PAID_LABELS[k]}</option>)}
        </Select>
      </FormField>
      <FormField label="Check or confirmation number (optional)" htmlFor="fp-ref"><Input id="fp-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></FormField>
    </Modal>
  )
}

type Line = FreightBillDetail['freight_bill_lines'][number]

function LineRow({ line: l, canEdit, onChange }: { line: Line; canEdit: boolean; onChange: () => Promise<void> }) {
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(l.vendors)
  const [orderId, setOrderId] = useState(l.order_id ?? '')
  const [busy, setBusy] = useState(false)
  const orders = useSupabaseQuery(async () => (vendor ? listVendorOrdersForFreight(vendor.id) : []), [vendor?.id])
  const changed = (vendor?.id ?? null) !== l.vendor_id || (orderId || null) !== l.order_id

  async function save(confirm: boolean) {
    setBusy(true)
    try {
      await setFreightLine(l.id, vendor?.id ?? null, orderId || null, confirm)
      toast.success(confirm ? `Freight on ${vendor?.name ?? 'the order'}` : 'Saved')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[1.2fr_1.6fr_auto] lg:items-center">
      <div className="min-w-0">
        <p className="font-medium text-stone-900">{l.shipper_name ?? 'Unknown shipper'}</p>
        <p className="text-xs text-stone-500">
          {[shortDate(l.ship_date), l.pieces ? `${l.pieces} pc` : null, l.weight_lb ? `${l.weight_lb} lb` : null, l.description].filter((x) => x && x !== '—').join(' · ')}
        </p>
        {l.tracking.length ? <p className="truncate text-xs text-stone-400">{l.tracking.join(', ')}</p> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {canEdit && !l.confirmed ? (
          <>
            <div className="sm:w-56">
              {vendor ? (
                <button type="button" onClick={() => { setVendor(null); setOrderId('') }} className="w-full truncate rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-left hover:bg-stone-50" title="Pick another vendor">{vendor.name}</button>
              ) : <VendorPicker placeholder="Which vendor shipped it?" onPick={(v) => { setVendor(v); setOrderId('') }} />}
            </div>
            <Select value={orderId} onChange={(e) => setOrderId(e.target.value)} aria-label="Order" className="h-9 sm:w-64" disabled={!vendor}>
              <option value="">{vendor ? (orders.isLoading ? 'Loading orders…' : 'No order (vendor only)') : 'Pick the vendor first'}</option>
              {(orders.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>{[shortDate(o.order_date), o.po_number, money(o.final_cost ?? o.est_cost), o.date_received ? 'received' : null].filter((x) => x && x !== '—').join(' · ')}</option>
              ))}
            </Select>
          </>
        ) : (
          <p className="text-stone-700">
            {l.vendors ? <Link to={`${ROUTES.vendors}/${l.vendors.id}`} className="text-brand hover:underline">{l.vendors.name}</Link> : <span className="text-stone-400">No vendor</span>}
            {l.orders ? <> · <Link to={`${ROUTES.orders}/${l.orders.id}`} className="text-brand hover:underline">order {l.orders.po_number ?? shortDate(l.orders.order_date)}</Link></> : null}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 lg:justify-end">
        <span className="text-right">
          <span className="font-medium text-stone-900">{money(Number(l.amount) + Number(l.fee_amount))}</span>
          {Number(l.fee_amount) ? <span className="block text-xs text-stone-400">incl. {money(l.fee_amount)} fee</span> : null}
        </span>
        {canEdit ? (
          l.confirmed
            ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(false)}>Undo</Button>
            : <Button size="sm" loading={busy} disabled={!vendor} onClick={() => void save(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>{changed || !l.confirmed ? 'Confirm' : 'Confirmed'}</Button>
        ) : l.confirmed ? <Badge tone="success">Confirmed</Badge> : null}
      </div>
    </li>
  )
}
