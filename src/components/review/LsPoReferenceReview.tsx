import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { matchLink } from '@/lib/mailSearch'
import { setLsPoReference } from '@/services/lightspeed'
import { keepLsPoReference } from '@/services/poAsks'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'

interface Details { order_id?: string; from?: string; to?: string; email_id?: string | null; thread_id?: string | null; vendor_name?: string }

/**
 * The vendor said it was too late to use our PO, and the PO is already in Lightspeed with ours in Reference # (Dana,
 * Oct 24: a change in LS goes to Dana to approve). Change it in Lightspeed, or keep ours there.
 */
export function LsPoReferenceReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  // only Dana changes a PO in Lightspeed
  const { role } = useAuth()
  async function answer(change: boolean) {
    setBusy(true)
    try {
      if (change) await setLsPoReference(item.id)
      else await keepLsPoReference(item.id)
      toast.success(change ? `Reference # is now ${d.to} in Lightspeed` : `Kept ${d.from} in Lightspeed`)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-stone-700">{d.vendor_name} said it was too late to change their PO to ours, so the order now uses their PO {d.to}. The PO in Lightspeed still has ours, {d.from}, in Reference #.</p>
      <p className="flex flex-wrap gap-x-3 text-sm">
        {d.thread_id ? <Link to={d.email_id ? matchLink(d.thread_id, { email_id: d.email_id }) : `${ROUTES.mail}/${d.thread_id}`} className="font-medium text-brand hover:underline">Their answer</Link> : null}
        {d.order_id ? <Link to={`${ROUTES.orders}/${d.order_id}`} className="font-medium text-brand hover:underline">The order</Link> : null}
      </p>
      {canEdit && role === 'admin' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Change it to {d.to} in Lightspeed</Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>Keep {d.from}</Button>
        </div>
      ) : null}
    </div>
  )
}
