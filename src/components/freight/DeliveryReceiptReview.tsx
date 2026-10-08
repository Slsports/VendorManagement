import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Mail } from 'lucide-react'
import { fileDeliveryReceipt } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { VendorPicker } from '@/components/vendors/VendorPicker'

interface ReceiptDetails { shipper_name?: string | null; pro_number?: string | null; po_numbers?: string[]; delivered_on?: string | null; thread_id?: string | null; carrier?: string | null }

/**
 * A carrier's delivery receipt Claude could not match to a vendor: what the receipt says, a link to the
 * email, and a vendor picker. Picking one files the email and the PDF to that vendor (and its order by PO).
 */
export function DeliveryReceiptReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as ReceiptDetails
  const [busy, setBusy] = useState(false)
  async function pick(vendorId: string, name: string) {
    if (!item.entity_id) return
    setBusy(true)
    try {
      await fileDeliveryReceipt(item.entity_id, vendorId)
      toast.success(`Filed to ${name}`)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-1 space-y-2 text-amber-900">
      <p>
        {d.carrier ?? 'The carrier'} receipt{d.pro_number ? ` ${d.pro_number}` : ''}
        {d.delivered_on ? `, delivered ${shortDate(d.delivered_on)}` : ''}.
        {' '}Shipper on the receipt: <span className="font-medium">{d.shipper_name || 'could not read it'}</span>
        {d.po_numbers?.length ? <> · PO {d.po_numbers.join(', ')}</> : null}
      </p>
      {d.thread_id ? (
        <Link to={`${ROUTES.mail}/${d.thread_id}`} className="inline-flex items-center gap-1 underline"><Mail className="size-3.5" aria-hidden="true" />Open the email and receipt</Link>
      ) : null}
      {canEdit ? (
        <div className={busy ? 'pointer-events-none opacity-60' : ''}>
          <VendorPicker onPick={(v) => pick(v.id, v.name)} prefill={{ name: d.shipper_name ?? undefined }} placeholder="Which vendor shipped it?" className="sm:w-80" />
        </div>
      ) : null}
    </div>
  )
}
