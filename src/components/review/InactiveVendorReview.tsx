import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { matchLink } from '@/lib/mailSearch'
import { clearPickerCache } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { vendor_id?: string; vendor_name?: string; why?: string; email_id?: string | null; thread_id?: string | null; order_id?: string | null; inactive_reason?: string | null; more?: number }

/**
 * An inactive vendor may be back (Dana, Oct 24): an order in VMS, or mail showing we are ordering or looking into it (a
 * catalog or price list asked for). Make it active again, or keep it inactive; the email or order is one click away.
 */
export function InactiveVendorReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(reactivate: boolean) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('inactive_vendor_answer', { p_item: item.id, p_reactivate: reactivate })
      if (error) throw error
      clearPickerCache()
      toast.success(reactivate ? `${d.vendor_name} is active again` : `${d.vendor_name} stays inactive`)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-stone-700">{d.why}{d.more ? ` (and ${d.more} more since)` : ''}</p>
      {d.inactive_reason ? <p className="text-xs text-stone-500">Made inactive because: {d.inactive_reason}</p> : null}
      <p className="flex flex-wrap gap-x-3 text-sm">
        {d.thread_id ? <Link to={d.email_id ? matchLink(d.thread_id, { email_id: d.email_id }) : `${ROUTES.mail}/${d.thread_id}`} className="font-medium text-brand hover:underline">The email</Link> : null}
        {d.order_id ? <Link to={`${ROUTES.orders}/${d.order_id}`} className="font-medium text-brand hover:underline">The order</Link> : null}
        {d.vendor_id ? <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link> : null}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Make active again</Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>Keep inactive</Button>
        </div>
      ) : null}
    </div>
  )
}
