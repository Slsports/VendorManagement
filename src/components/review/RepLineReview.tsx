import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { clearPickerCache } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { rep_group_id?: string; rep_group_name?: string; vendor_id?: string; vendor_name?: string; current_rep_group_name?: string; line_name?: string }

/**
 * A rep's mail names a line we could not add on our own (Dana, Oct 12): a vendor with another rep group (move it or keep
 * it), or a brand that is not one of our vendors (add it, with this rep group, or skip).
 */
export function RepLineReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(action: 'move' | 'keep' | 'add_vendor' | 'skip', label: string) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('resolve_rep_line', { p_item: item.id, p_action: action })
      if (error) throw error
      if (action === 'add_vendor') clearPickerCache()
      toast.success(label)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const group = d.rep_group_id ? <Link to={`${ROUTES.repGroups}/${d.rep_group_id}`} className="font-medium text-brand hover:underline">{d.rep_group_name}</Link> : d.rep_group_name
  return (
    <div className="mt-2 space-y-2">
      <p className="text-stone-700">
        {d.vendor_id
          ? <>Mail from {group} talks about <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link>, which is with {d.current_rep_group_name}.</>
          : <>Mail from {group} says they rep <span className="font-medium">{d.line_name}</span>, which is not one of our vendors.</>}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {d.vendor_id ? (
            <>
              <Button size="sm" loading={busy} onClick={() => void answer('move', `${d.vendor_name} is now with ${d.rep_group_name}`)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Move to {d.rep_group_name}</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('keep', `${d.vendor_name} stays with ${d.current_rep_group_name}`)} leftIcon={<X className="size-4" aria-hidden="true" />}>Keep with {d.current_rep_group_name}</Button>
            </>
          ) : (
            <>
              <Button size="sm" loading={busy} onClick={() => void answer('add_vendor', `${d.line_name} added as a vendor with ${d.rep_group_name}`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add as a vendor</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('skip', 'Skipped')} leftIcon={<X className="size-4" aria-hidden="true" />}>Skip</Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
