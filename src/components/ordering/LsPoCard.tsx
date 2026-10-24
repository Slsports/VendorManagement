import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { setLsPoNumber } from '@/services/ordering'
import { getLsPoForOrder, LS_PO_STATUS, startLsPo } from '@/services/lsPos'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { Order, VendorLink } from '@/types'
import { Button, Input } from '@/components/ui'

/**
 * The LS PO on an order (Dana, Oct 12): once the vendor confirms, Claude drafts it, the person who placed the order
 * approves it, Trevor reviews it and sends it to LS, which makes the PO there once, with all its items (Oct 24: no empty
 * PO first). The number can also be typed here for a PO made by hand.
 */
export function LsPoCard({ order, documents, canEdit, onChange, vendor, focus = false }: { order: Pick<Order, 'id' | 'status' | 'ls_po_number' | 'po_number' | 'ls_order_id' | 'store_codes'>; documents: VendorLink[]; canEdit: boolean; onChange: () => void; vendor?: { id: string; name: string; lightspeed_vendor_id: string | null } | null; focus?: boolean }) {
  const po = useSupabaseQuery(() => getLsPoForOrder(order.id), [order.id])
  const box = useRef<HTMLElement>(null)
  useEffect(() => { if (focus) box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [focus])
  const [value, setValue] = useState(order.ls_po_number ?? '')
  const [busy, setBusy] = useState(false)
  const hasDoc = documents.some((d) => d.kind === 'ls_po')
  const draft = po.data
  async function save() {
    setBusy(true)
    try { await setLsPoNumber(order.id, value); toast.success(value.trim() ? 'LS PO number saved' : 'LS PO number cleared'); onChange() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function start() {
    setBusy(true)
    try { const id = await startLsPo(order.id); toast.success('Claude is drafting the LS PO'); await po.refetch(); void id } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const waiting = draft && draft.status !== 'sent'
  return (
    <section ref={box} className={`rounded-2xl border p-5 ${waiting ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'} ${focus ? 'ring-4 ring-brand/40' : ''}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">LS PO</h2>
      {order.ls_order_id ? <p className="mt-2 text-sm text-stone-900">PO <strong>{order.po_number}</strong> is in Lightspeed.</p> : null}
      {vendor && !vendor.lightspeed_vendor_id && !order.ls_order_id ? (
        <p className="mt-2 text-xs text-stone-500">Before it can go to Lightspeed, find {vendor.name} in Lightspeed on <Link to={`${ROUTES.vendors}/${vendor.id}`} className="font-medium text-brand hover:underline">the vendor page</Link> (Lightspeed box).</p>
      ) : null}
      {draft ? (
        <p className="mt-2 text-sm">
          <Link to={`${ROUTES.lsPos}/${draft.id}`} className="font-medium text-brand hover:underline">Open the LS PO</Link>
          <span className="text-stone-700"> · {LS_PO_STATUS[draft.status].label}{draft.status === 'to_approve' && draft.approver ? ` (${draft.approver.full_name.split(' ')[0]})` : (draft.status === 'to_review' || draft.status === 'ready') && draft.reviewer ? ` (${draft.reviewer.full_name.split(' ')[0]})` : ''}</span>
        </p>
      ) : order.ls_po_number || hasDoc ? null : (
        <p className="mt-2 text-xs text-stone-500">{order.status === 'confirmed' ? 'Confirmed with no LS PO yet.' : 'Claude drafts it once the vendor confirms the order.'}</p>
      )}
      {hasDoc ? <p className="mt-2 text-xs text-stone-500">An LS PO is saved in this order's documents.</p> : null}
      {canEdit && !draft && !order.ls_po_number ? <Button size="sm" variant="secondary" className="mt-2" loading={busy} onClick={() => void start()}>Have Claude draft it</Button> : null}
      {canEdit && (!draft || draft.status === 'sent') ? (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <Input aria-label="LS PO number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="LS PO number" className="h-9" />
          <Button size="sm" type="submit" loading={busy} disabled={value.trim() === (order.ls_po_number ?? '')}>Save</Button>
        </form>
      ) : order.ls_po_number ? <p className="mt-2 text-sm text-stone-900">PO {order.ls_po_number}</p> : null}
    </section>
  )
}
