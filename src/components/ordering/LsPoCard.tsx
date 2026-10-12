import { useState } from 'react'
import toast from 'react-hot-toast'
import { setLsPoNumber } from '@/services/ordering'
import { errorMessage } from '@/lib/utils'
import type { Order, VendorLink } from '@/types'
import { Button, Input } from '@/components/ui'

/**
 * The LS PO (Dana, Oct 12): made in LS after the vendor confirms, so it matches what they ship. Until its number is
 * typed here (or the LS PO is saved to the order), a confirmed order shows "LS PO needed".
 */
export function LsPoCard({ order, documents, canEdit, onChange }: { order: Pick<Order, 'id' | 'status' | 'ls_po_number'>; documents: VendorLink[]; canEdit: boolean; onChange: () => void }) {
  const [value, setValue] = useState(order.ls_po_number ?? '')
  const [busy, setBusy] = useState(false)
  const hasDoc = documents.some((d) => d.kind === 'ls_po')
  const needed = order.status === 'confirmed' && !order.ls_po_number && !hasDoc
  async function save() {
    setBusy(true)
    try { await setLsPoNumber(order.id, value); toast.success(value.trim() ? 'LS PO number saved' : 'LS PO number cleared'); onChange() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <section className={`rounded-2xl border p-5 ${needed ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">LS PO</h2>
      {needed ? <p className="mt-2 text-sm font-medium text-amber-900">LS PO needed: the vendor confirmed, so make the PO in LS and type its number here.</p>
        : order.status !== 'confirmed' && !order.ls_po_number && !hasDoc ? <p className="mt-2 text-xs text-stone-500">Made in LS once the vendor confirms the order.</p> : null}
      {hasDoc ? <p className="mt-2 text-xs text-stone-500">An LS PO is saved in this order's documents.</p> : null}
      {canEdit ? (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <Input aria-label="LS PO number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="LS PO number" className="h-9" />
          <Button size="sm" type="submit" loading={busy} disabled={value.trim() === (order.ls_po_number ?? '')}>Save</Button>
        </form>
      ) : order.ls_po_number ? <p className="mt-2 text-sm text-stone-900">{order.ls_po_number}</p> : null}
    </section>
  )
}
