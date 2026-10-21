import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { answerWwdCard, listWwdInvoices } from '@/services/wwd'
import { wwdInvoiceFiles, type WwdInvoiceFile } from '@/services/freight'
import { downloadVendorFile } from '@/services/lines'
import { vendorOrderSummary } from '@/services/orders'
import { ROUTES } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button, Select } from '@/components/ui'

interface Details { order_id?: string; vms?: number | null; edenred?: number; free_shipping?: boolean | null; invoice_po?: string; order_po?: string; seq?: string; vendor_id?: string; amount?: number; po_number?: string | null; vendor_invoice_number?: string | null; lines?: string[] | null }

/**
 * The Edenred cards (Dana, Oct 21): freight that differs from Edenred's, a WWD invoice whose PO is not its order's, and
 * a credit with no invoice to show on.
 */
export function WwdCardReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(false)
  const orders = useSupabaseQuery(async () => (moving && d.vendor_id ? (await vendorOrderSummary(d.vendor_id)).orders : []), [moving, d.vendor_id])
  const invoices = useSupabaseQuery(async () => (item.kind === 'wwd_credit_for' && d.vendor_id ? listWwdInvoices({ vendorId: d.vendor_id }, 100) : []), [item.kind, d.vendor_id])
  // where it came from, one click (Dana, Oct 21): the WWD invoice PDFs. Freight: the order's invoices Edenred's freight is from.
  const sources = useSupabaseQuery(async (): Promise<(WwdInvoiceFile & { freight?: number | null })[]> => {
    if (item.kind === 'wwd_freight_differs') {
      if (!d.order_id) return []
      const inv = (await listWwdInvoices({ orderId: d.order_id })).filter((i) => i.kind === 'invoice' && i.lines_loaded_at)
      const files = await wwdInvoiceFiles(inv.map((i) => i.id))
      return inv.map((i) => ({ ...(files.get(i.id) ?? { id: i.id, seq: i.seq, file: null }), freight: i.edenred_freight }))
    }
    return item.entity_id ? [...(await wwdInvoiceFiles([item.entity_id])).values()] : []
  }, [item.kind, item.entity_id, d.order_id])
  const { view, viewer } = useDocumentViewer()
  const pdf = (f: WwdInvoiceFile, text = `WWD Seq # ${f.seq}`) => (f.file
    ? <button key={f.id} type="button" onClick={() => view({ name: f.file!.file_name ?? `WWD Seq ${f.seq}.pdf`, mime: f.file!.mime_type, load: () => downloadVendorFile(f.file!.storage_path) })} className="font-medium text-brand hover:underline" title="Open the invoice PDF">{text}</button>
    : <span key={f.id}>{text} <span className="text-xs text-stone-500">(no PDF on file)</span></span>)
  const own = sources.data?.[0] ?? null

  async function answer(action: string, target?: string | null, said = 'Done') {
    setBusy(true)
    try {
      await answerWwdCard(item.id, action, target)
      toast.success(said)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const orderLink = d.order_id ? <Link to={`${ROUTES.orders}/${d.order_id}`} className="font-medium text-brand hover:underline">Open the order</Link> : null

  if (item.kind === 'wwd_freight_differs') {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-stone-700">Freight in VMS: <strong>{d.vms != null ? money(d.vms) : 'none'}</strong>{d.free_shipping ? ' (marked ships free)' : ''} · in Edenred: <strong>{money(d.edenred ?? 0)}</strong>. {orderLink}</p>
        {sources.data?.length ? (
          <p className="text-xs text-stone-600">From {sources.data.map((f, n) => <span key={f.id}>{n ? ' · ' : ''}{pdf(f)}{f.freight ? ` (freight ${money(f.freight)})` : ''}</span>)}</p>
        ) : null}
        {viewer}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={() => void answer('use_edenred', null, 'Edenred\'s freight is on the order')}>Use Edenred's {money(d.edenred ?? 0)}</Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('keep', null, 'Kept')}>Keep {d.vms != null ? money(d.vms) : 'none'}</Button>
          </div>
        ) : null}
      </div>
    )
  }

  if (item.kind === 'wwd_po_mismatch') {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-stone-700">The WWD invoice ({own ? pdf(own) : `WWD Seq # ${d.seq}`}) says PO <strong>{d.invoice_po}</strong>; the order it is tied to is PO <strong>{d.order_po}</strong>. {orderLink}</p>
        {viewer}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={busy} onClick={() => void answer('keep', null, 'Kept on this order')}>Right order, keep it</Button>
            {moving ? (
              <Select aria-label="Move to order" className="h-9 w-72" defaultValue="" onChange={(e) => { if (e.target.value) void answer('move', e.target.value, 'Moved to that order') }}>
                <option value="">{orders.isLoading ? 'Loading orders…' : 'Pick the right order'}</option>
                {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{shortDate(o.order_date)} · {money(o.final_cost ?? o.est_cost)}{o.po_number ? ` · ${o.po_number}` : ''}</option>)}
              </Select>
            ) : <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMoving(true)}>Move to another order</Button>}
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('untie', null, 'Untied')}>Untie it</Button>
          </div>
        ) : null}
      </div>
    )
  }

  // a credit: which invoice is it for?
  const before = (invoices.data ?? []).filter((i) => i.kind === 'invoice')
  return (
    <div className="mt-2 space-y-2">
      <p className="text-stone-700">{d.vendor_invoice_number ? `Credit ${d.vendor_invoice_number}` : 'Credit'}{d.po_number ? `, PO ${d.po_number}` : ', no PO'}{d.lines?.length ? `: ${d.lines.filter(Boolean).slice(0, 3).join('; ')}` : ''}{own ? <> · {pdf(own)}</> : null}</p>
      {viewer}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="The invoice it is for" className="h-9 w-80" defaultValue="" onChange={(e) => { if (e.target.value) void answer('pick', e.target.value, 'The credit shows on that invoice') }}>
            <option value="">{invoices.isLoading ? 'Loading invoices…' : 'Pick the invoice it is for'}</option>
            {before.map((i) => <option key={i.id} value={i.id}>{shortDate(i.wwd_date)} · WWD Seq # {i.seq}{i.vendor_invoice_number ? ` · Vendor Inv # ${i.vendor_invoice_number}` : ''} · {money(i.amount)}{i.po_number ? ` · ${i.po_number}` : ''}</option>)}
          </Select>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('none', null, 'Left on its own')}>Not for one invoice</Button>
        </div>
      ) : null}
    </div>
  )
}
