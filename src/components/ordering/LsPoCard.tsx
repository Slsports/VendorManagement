import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { setLsPoNumber } from '@/services/ordering'
import { getLsPoForOrder, LS_PO_STATUS, startLsPo } from '@/services/lsPos'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { Order, VendorLink } from '@/types'
import { Button, Input, Select } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { createLsPo, listLsShops, poNumberPreview } from '@/services/lightspeed'

/**
 * The LS PO on an order (Dana, Oct 12): once the vendor confirms, Claude drafts it, the person who placed the order
 * approves it, Trevor reviews it and enters it in LS. The number can also be typed here for a PO made by hand.
 */
export function LsPoCard({ order, documents, canEdit, onChange, vendor }: { order: Pick<Order, 'id' | 'status' | 'ls_po_number' | 'po_number' | 'ls_order_id' | 'store_codes'>; documents: VendorLink[]; canEdit: boolean; onChange: () => void; vendor?: { id: string; name: string; lightspeed_vendor_id: string | null } | null }) {
  const po = useSupabaseQuery(() => getLsPoForOrder(order.id), [order.id])
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
    <section className={`rounded-2xl border p-5 ${waiting ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">LS PO</h2>
      <CreateInLs order={order} vendor={vendor ?? null} canEdit={canEdit} onChange={onChange} />
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

const realPo = (p: string | null) => !!p && p.replace(/[^A-Za-z0-9]/g, '').length >= 3 && !/^\s*(n\/?a|none|tbd|pending|na|no po)\s*$/i.test(p)

/**
 * "Create PO in LS" (Dana, Oct 13): the empty PO in Lightspeed for this vendor and store, Reference # = our one PO number
 * ([VENDOR][MMDDYY], e.g. YAKIMA080626). The items go on it later, from the approved LS PO draft.
 */
function CreateInLs({ order, vendor, canEdit, onChange }: { order: Pick<Order, 'id' | 'po_number' | 'ls_order_id' | 'store_codes'>; vendor: { id: string; name: string; lightspeed_vendor_id: string | null } | null; canEdit: boolean; onChange: () => void }) {
  const { organization } = useAuth()
  const preview = useSupabaseQuery(async () => (order.ls_order_id || realPo(order.po_number) ? order.po_number : poNumberPreview(order.id)), [order.id, order.po_number, order.ls_order_id])
  const shops = useSupabaseQuery(async () => (organization ? listLsShops(organization.id) : []), [organization?.id])
  const [shop, setShop] = useState('')
  const [busy, setBusy] = useState(false)
  if (order.ls_order_id) return <p className="mt-2 text-sm text-stone-900">PO <strong>{order.po_number}</strong> is in Lightspeed.</p>
  if (!canEdit) return null
  const chosen = shop || (shops.data ?? []).find((s) => s.code === (order.store_codes?.[0] ?? 'SLS'))?.ls_shop_id || (shops.data ?? [])[0]?.ls_shop_id || ''
  async function create() {
    setBusy(true)
    try {
      const r = await createLsPo(order.id, chosen || null)
      toast.success(`PO ${r.po_number} created in Lightspeed`)
      onChange()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
      {vendor && !vendor.lightspeed_vendor_id ? (
        <p className="text-stone-700">To create the PO in Lightspeed, first find {vendor.name} in Lightspeed on <Link to={`${ROUTES.vendors}/${vendor.id}`} className="font-medium text-brand hover:underline">the vendor page</Link> (Lightspeed box).</p>
      ) : (
        <>
          <p className="text-stone-700">PO number: <strong>{preview.data ?? '…'}</strong></p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select aria-label="Store" value={chosen} onChange={(e) => setShop(e.target.value)} className="h-9 text-sm">
              {(shops.data ?? []).map((s) => <option key={s.ls_shop_id} value={s.ls_shop_id}>{s.name}</option>)}
            </Select>
            <Button size="sm" loading={busy} onClick={() => void create()}>Create PO in LS</Button>
          </div>
          <p className="mt-1 text-xs text-stone-500">Makes the empty PO in Lightspeed with this number in Reference #. The items go on it after the confirmation.</p>
        </>
      )}
    </div>
  )
}
