import { useState } from 'react'
import toast from 'react-hot-toast'
import { setOrderAddons, vendorOrderAddresses } from '@/services/addOns'
import { ADDONS_LABELS, askAddOnsEmail, type AddOnOrder } from '@/lib/addOns'
import { errorMessage } from '@/lib/utils'
import { ComposeDialog, type ComposeDraft } from '@/components/mail/ComposeDialog'
import { Button, Select } from '@/components/ui'

/**
 * The order's add-on choice (Dana, Oct 16: per order, not per vendor). "Ask the rep" drafts the one-line question from
 * orders@; the answer sets the choice. Shown only while the order has not shipped.
 */
export function AddOnsChoice({ order, vendor, canEdit, onChanged }: { order: AddOnOrder; vendor: { id: string; name: string }; canEdit: boolean; onChanged: () => void }) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const open = ['open', 'awaiting_confirmation', 'confirmed'].includes(order.status)
  async function change(v: string) {
    setBusy(true)
    try { await setOrderAddons(order.id, (v || null) as 'yes' | 'no' | 'ask' | null); onChanged() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function ask() {
    try {
      const to = await vendorOrderAddresses(vendor.id)
      const m = askAddOnsEmail(order)
      setDraft({ to, subject: m.subject, body: m.body, vendor_id: vendor.id })
    } catch (e) { toast.error(errorMessage(e)) }
  }
  if (!open) return <span className="text-sm text-stone-600">{order.addons ? ADDONS_LABELS[order.addons] : '—'}{order.status !== 'open' ? ' (shipped)' : ''}</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {canEdit ? (
        <Select value={order.addons ?? ''} onChange={(e) => void change(e.target.value)} disabled={busy} aria-label="Can this order take add-ons?" className="h-8 w-44 text-sm">
          <option value="">Not set</option>
          <option value="yes">{ADDONS_LABELS.yes}</option>
          <option value="no">{ADDONS_LABELS.no}</option>
          <option value="ask">{ADDONS_LABELS.ask}</option>
        </Select>
      ) : <span className="text-sm text-stone-900">{order.addons ? ADDONS_LABELS[order.addons] : 'Not set'}</span>}
      {canEdit && order.addons !== 'no' ? <Button size="sm" variant="ghost" onClick={ask}>Ask the rep</Button> : null}
      {draft ? <ComposeDialog draft={draft} onClose={() => setDraft(null)} onSent={() => { setDraft(null); void setOrderAddons(order.id, 'ask', true).then(onChanged) }} /> : null}
    </span>
  )
}
