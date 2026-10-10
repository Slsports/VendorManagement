import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Mail, MessageCircleReply } from 'lucide-react'
import { answerMailReply } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Details { thread_id?: string; from?: string; subject?: string | null; snippet?: string | null; note?: string | null; received_at?: string }

/**
 * Claude was not 100% sure whether an email needs an answer (Dana, Oct 8). The person decides; three
 * "No answer needed" about one sender and that sender's unsure emails are handled on their own.
 */
export function MailReplyReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(needs: boolean) {
    setBusy(true)
    try {
      await answerMailReply(item.id, needs)
      toast.success(needs ? 'Kept in Needs an answer' : 'Marked handled')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <div className="mt-1 space-y-2 text-amber-900">
      <p>
        <span className="font-medium">{d.from ?? 'Someone'}</span>
        {d.received_at ? <span className="text-amber-700"> · {new Date(d.received_at).toLocaleDateString()}</span> : null}
      </p>
      {d.snippet ? <p className="line-clamp-3 text-amber-800">{d.snippet}</p> : null}
      {d.note ? <p className="text-xs text-amber-700">Claude: {d.note}</p> : null}
      {d.thread_id ? <Link to={`${ROUTES.mail}/${d.thread_id}`} className="inline-flex items-center gap-1 underline"><Mail className="size-3.5" aria-hidden="true" />Open the email</Link> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" loading={busy} onClick={() => void answer(true)} leftIcon={<MessageCircleReply className="size-4" aria-hidden="true" />}>Needs an answer</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void answer(false)} leftIcon={<Check className="size-4" aria-hidden="true" />}>No answer needed</Button>
        </div>
      ) : null}
    </div>
  )
}
