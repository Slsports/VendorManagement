import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { answerVendorAlias } from '@/services/repAgency'
import { clearPickerCache } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { vendor_id?: string; vendor_name?: string; alias?: string; why?: string }

/**
 * A name saved on a vendor that may not belong there (Dana, Oct 21: TOYOLOGY on Blokees is the rep agency). Remove it
 * (VMS then re-checks the old mail that named the vendor only by it) or keep it.
 */
export function VendorAliasReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(remove: boolean) {
    setBusy(true)
    try {
      await answerVendorAlias(item.id, remove)
      clearPickerCache()
      toast.success(remove ? `"${d.alias}" removed from ${d.vendor_name}. VMS re-checks the old mail for it in a minute.` : `"${d.alias}" stays on ${d.vendor_name}`)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {d.why ? <p className="text-stone-700">{d.why}</p> : null}
      <p className="text-stone-700">
        {d.vendor_id ? <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link> : d.vendor_name}
        {d.alias ? <> · <Link to={`${ROUTES.mail}?q=${encodeURIComponent(d.alias)}`} className="font-medium text-brand hover:underline">the mail that says "{d.alias}"</Link></> : null}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Remove "{d.alias}"</Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>Keep it</Button>
        </div>
      ) : null}
    </div>
  )
}
