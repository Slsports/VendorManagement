import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Mail, Palette, X } from 'lucide-react'
import { setArtStatus } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { thread_id?: string; from?: string; snippet?: string | null; note?: string | null; received_at?: string }

/** Claude was not sure a vendor is waiting on us to approve artwork (Dana, Oct 10). Yes puts it on her card. */
export function ArtApprovalReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(isArt: boolean) {
    if (!d.thread_id) return
    setBusy(true)
    try {
      await setArtStatus(d.thread_id, isArt ? 'waiting' : 'none')
      toast.success(isArt ? 'On the Artwork approvals card' : 'Not artwork')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <div className="mt-1 space-y-2 text-amber-900">
      <p><span className="font-medium">{d.from ?? 'Someone'}</span>{d.received_at ? <span className="text-amber-700"> · {new Date(d.received_at).toLocaleDateString()}</span> : null}</p>
      {d.snippet ? <p className="line-clamp-3 text-amber-800">{d.snippet}</p> : null}
      {d.note ? <p className="text-xs text-amber-700">Claude: {d.note}</p> : null}
      {d.thread_id ? <Link to={`${ROUTES.mail}/${d.thread_id}`} className="inline-flex items-center gap-1 underline"><Mail className="size-3.5" aria-hidden="true" />Open the email</Link> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<Palette className="size-4" aria-hidden="true" />}>Yes, artwork to approve</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void answer(false)} leftIcon={<X className="size-4" aria-hidden="true" />}>Not artwork</Button>
        </div>
      ) : null}
    </div>
  )
}
