import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Search, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { searchOrdersForShare, setFreightShare, type FreightBillDetail, type ShareSearchRow } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { Button, Input } from '@/components/ui'

interface Pick { order_id: string; label: string; amount: string }

/**
 * A shared freight bill (Dana, Oct 21: one pallet from WWD, several vendors): Trevor searches for each order that came
 * on it (PO, Vendor Inv #, WWD Seq # or vendor) and adds it. A blank amount is shared by merchandise cost; a typed one
 * stays. Save once it adds up to the bill.
 */
export function SharedFreightBox({ bill, canEdit, onChange }: { bill: FreightBillDetail; canEdit: boolean; onChange: () => void }) {
  const { organization } = useAuth()
  const start: Pick[] = bill.freight_bill_lines.filter((l) => l.order_id).map((l) => ({
    order_id: l.order_id!, label: [l.vendors?.name ?? l.shipper_name, l.orders?.po_number ? `PO ${l.orders.po_number}` : null].filter(Boolean).join(' · '),
    amount: l.manual_amount ? String(l.amount) : '',
  }))
  const [picks, setPicks] = useState<Pick[]>(start)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<ShareSearchRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const total = Number(bill.total ?? 0)
  const typed = picks.reduce((s, p) => s + (p.amount.trim() ? Number(p.amount) || 0 : 0), 0)
  const open = picks.filter((p) => !p.amount.trim()).length
  const adds = open > 0 ? typed <= total + 0.005 : Math.abs(typed - total) < 0.005
  const dirty = JSON.stringify(picks.map((p) => [p.order_id, p.amount])) !== JSON.stringify(start.map((p) => [p.order_id, p.amount]))

  async function search() {
    if (!organization || q.trim().length < 2) return
    try { setFound(await searchOrdersForShare(organization.id, q.trim())) } catch (err) { toast.error(errorMessage(err)) }
  }
  function add(r: ShareSearchRow) {
    if (picks.some((p) => p.order_id === r.order_id)) return
    setPicks((ps) => [...ps, { order_id: r.order_id, label: [r.vendor_name, r.po_number ? `PO ${r.po_number}` : null].filter(Boolean).join(' · '), amount: '' }])
  }
  async function save() {
    setBusy(true)
    try {
      await setFreightShare(bill.id, picks.map((p) => ({ order_id: p.order_id, amount: p.amount.trim() ? Number(p.amount) : null })))
      toast.success(picks.length ? `Shared across ${picks.length} order${picks.length === 1 ? '' : 's'}` : 'Cleared')
      onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-brand/30 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-900">Share this freight across the orders on the shipment</h2>
      <p className="mt-1 text-xs text-stone-600">Add each order that came on it. A blank amount is shared by merchandise cost, so every vendor carries the same freight %; type an amount to set one.</p>
      {picks.length ? (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {picks.map((p, i) => {
            const line = bill.freight_bill_lines.find((l) => l.order_id === p.order_id)
            return (
              <li key={p.order_id} className="flex flex-wrap items-center gap-2 py-2">
                <Link to={`${ROUTES.orders}/${p.order_id}`} className="min-w-0 flex-1 text-brand hover:underline">{p.label || 'Order'}</Link>
                {canEdit ? <Input aria-label={`Amount for ${p.label}`} inputMode="decimal" value={p.amount} placeholder={line && !line.manual_amount && !dirty ? money(line.amount) : 'shared'} onChange={(e) => setPicks((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className="h-9 w-28" />
                  : <span className="tabular-nums">{line ? money(line.amount) : ''}</span>}
                {canEdit ? <button type="button" onClick={() => setPicks((ps) => ps.filter((_, j) => j !== i))} aria-label={`Take ${p.label} off`} className="rounded p-1 text-stone-500 hover:bg-stone-100"><X className="size-4" aria-hidden="true" /></button> : null}
              </li>
            )
          })}
        </ul>
      ) : <p className="mt-3 text-sm text-stone-500">No orders on it yet.</p>}
      {canEdit ? (
        <>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
            <Input aria-label="Find an order" value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO, Vendor Inv #, WWD Seq # or vendor" className="h-9" />
            <Button size="sm" type="submit" variant="secondary" leftIcon={<Search className="size-4" aria-hidden="true" />}>Find</Button>
          </form>
          {found ? (
            found.length ? (
              <ul className="mt-2 max-h-64 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200 text-sm">
                {found.map((r) => (
                  <li key={r.order_id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-stone-900">{r.vendor_name}</span>
                      <span className="text-stone-600">{r.po_number ? ` · PO ${r.po_number}` : ''}{r.order_date ? ` · ${shortDate(r.order_date)}` : ''}{r.merch_cost ? ` · ${money(r.merch_cost)}` : ''}</span>
                      {r.seqs?.length ? <span className="block text-xs text-stone-500">WWD Seq # {r.seqs.join(', ')}{r.vendor_invoices?.length ? ` · Vendor Inv # ${r.vendor_invoices.join(', ')}` : ''}</span> : null}
                    </span>
                    <Button size="sm" variant="ghost" disabled={picks.some((p) => p.order_id === r.order_id)} onClick={() => add(r)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>{picks.some((p) => p.order_id === r.order_id) ? 'Added' : 'Add'}</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-stone-500">No order found for "{q}".</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className={adds ? 'text-stone-600' : 'font-medium text-red-700'}>
              Bill {money(total)} · typed {money(typed)}{open ? ` · ${money(Math.max(0, total - typed))} shared by cost across ${open}` : ''}{adds ? '' : ' · must add up to the bill'}
            </span>
            <Button size="sm" loading={busy} disabled={!dirty || !adds} onClick={() => void save()}>Save</Button>
          </div>
        </>
      ) : null}
    </section>
  )
}
