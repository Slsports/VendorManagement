import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, ClipboardList, Mail, MessageCircleReply, PackageSearch } from 'lucide-react'
import { answerMailReply } from '@/services/mail'
import { supabase } from '@/lib/supabase'
import { FlagDialog } from '@/components/ordering/FlagButtons'
import { FLAG_PROMPT, type OrderingStage } from '@/services/ordering'
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
  // Dana, Oct 11: from the card, flag the email's vendor "Check if we need it" or "Remind me to order" (the Ordering card).
  const [orderFor, setOrderFor] = useState<{ vendor: { id: string; name: string; assigned_buyer_id: string | null }; stage: OrderingStage } | null>(null)
  async function flag(stage: OrderingStage) {
    if (!d.thread_id) return
    const { data, error } = await supabase.from('email_threads').select('vendor:vendors!email_threads_vendor_id_fkey(id, name, assigned_buyer_id)').eq('id', d.thread_id).maybeSingle()
    const vendor = (data?.vendor ?? null) as unknown as { id: string; name: string; assigned_buyer_id: string | null } | null
    if (error) return toast.error(errorMessage(error))
    if (!vendor) return toast.error('File this email to a vendor first (Open the email › File to a vendor).')
    setOrderFor({ vendor, stage })
  }
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
          {d.thread_id ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void flag('check')} leftIcon={<PackageSearch className="size-4" aria-hidden="true" />}>{FLAG_PROMPT.check.button}</Button> : null}
          {d.thread_id ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void flag('to_order')} leftIcon={<ClipboardList className="size-4" aria-hidden="true" />}>{FLAG_PROMPT.to_order.button}</Button> : null}
        </div>
      ) : null}
      {orderFor ? <FlagDialog vendor={orderFor.vendor} stage={orderFor.stage} threadId={d.thread_id} assignedBuyerId={orderFor.vendor.assigned_buyer_id} onClose={() => setOrderFor(null)} /> : null}
    </div>
  )
}
