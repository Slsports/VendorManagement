import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { vendor_id?: string; vendor_name?: string; label?: string; ours?: string; portal?: string; portal_name?: string }

/** The Worldwide portal says something different from what VMS has (Dana, Oct 16): keep ours or use the portal's. */
export function PortalConflictReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(usePortal: boolean) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('resolve_portal_conflict', { p_item: item.id, p_use_portal: usePortal })
      if (error) throw error
      toast.success(usePortal ? `${d.label ?? 'It'} changed to the portal's` : 'Kept ours')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-stone-700">
        {d.vendor_id ? <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link> : d.vendor_name}
        {' '}· {d.label}
      </p>
      <dl className="grid gap-1 sm:grid-cols-[8rem_1fr]">
        <dt className="text-stone-500">VMS has</dt><dd className="whitespace-pre-line text-stone-900">{d.ours}</dd>
        <dt className="text-stone-500">Portal says</dt><dd className="whitespace-pre-line text-stone-900">{d.portal}{d.portal_name ? <span className="text-stone-500"> ({d.portal_name})</span> : null}</dd>
      </dl>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>Keep ours</Button>
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Use the portal's</Button>
        </div>
      ) : null}
    </div>
  )
}
