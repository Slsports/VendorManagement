import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { vendor_id?: string; vendor_name?: string; rep_group_id?: string; rep_group_name?: string; show?: string; booth?: string; booth_mates?: string[] }

/** Same booth, generally the same rep group (Dana, Oct 12): add this vendor to the rep group its booth-mates are with? */
export function BoothRepReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(yes: boolean) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('resolve_booth_rep', { p_item: item.id, p_yes: yes })
      if (error) throw error
      toast.success(yes ? `${d.vendor_name} is now with ${d.rep_group_name}` : 'Left as is')
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
        {d.show}, booth {d.booth}: <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link> shared it with{' '}
        {(d.booth_mates ?? []).join(', ')} ({d.rep_group_id ? <Link to={`${ROUTES.repGroups}/${d.rep_group_id}`} className="text-brand hover:underline">{d.rep_group_name}</Link> : d.rep_group_name}).
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Add to {d.rep_group_name}</Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>No</Button>
        </div>
      ) : null}
    </div>
  )
}
