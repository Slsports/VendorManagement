import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { line_name?: string; vendor_id?: string; vendor_name?: string; shows?: string; from?: string }

/** A Worldwide show list line Claude thinks may be one of our vendors (Dana, Oct 12): Yes ties the show to the vendor. */
export function ShowLineReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(yes: boolean) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('resolve_show_line', { p_item: item.id, p_yes: yes })
      if (error) throw error
      toast.success(yes ? (d.from === 'wwd_portal' ? `The portal details are on ${d.vendor_name}'s page` : `The shows are on ${d.vendor_name}'s page`) : 'Not the same')
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
        {d.from === 'wwd_portal' ? 'Worldwide portal' : 'Show list'}: <span className="font-medium">{d.line_name}</span>{d.shows ? <span className="text-stone-500"> ({d.shows})</span> : null}. Our vendor:{' '}
        {d.vendor_id ? <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link> : d.vendor_name}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Yes, same vendor</Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>No</Button>
        </div>
      ) : null}
    </div>
  )
}
