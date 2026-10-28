import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CircleCheck, Mail } from 'lucide-react'
import { getDraft, type DraftRow } from '@/services/mail'
import type { OrderCheckRow } from '@/services/orderChecks'
import { poNorm, poState } from '@/lib/poCheck'
import { matchLink } from '@/lib/mailSearch'
import { poAskForCheck, poAskLine } from '@/services/poAsks'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Alert, Button } from '@/components/ui'
import { ComposeDialog } from '@/components/mail/ComposeDialog'

/**
 * The PO on their confirmation, at the top of the review (Dana, Oct 20): ours, in our naming, missing, someone else's,
 * or a number that doesn't fit our naming. The email asking them to use our PO opens right here (no extra clicking).
 */
export function ConfirmationPoLine({ c, onChanged }: { c: OrderCheckRow; onChanged: () => void }) {
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [loading, setLoading] = useState(false)
  // what we asked them and what they answered (Dana, Oct 24)
  const ask = useSupabaseQuery(() => poAskForCheck(c.id), [c.id])
  if (c.kind !== 'confirmation') return null
  const theirs = c.po_number ?? (c.reading as { po_number?: string | null } | null)?.po_number ?? null
  const ours = c.order?.po_number ?? null
  const { state, example } = poState(theirs, ours, c.vendor, c.order?.order_date)

  async function openDraft() {
    if (!c.po_draft_id) return
    setLoading(true)
    try {
      const d = await getDraft(c.po_draft_id)
      if (d) setDraft(d)
      else toast('That email was already sent or deleted. Look in Mail › Sent.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (state === 'ours' || state === 'fits') {
    return (
      <p className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
        {state === 'ours' ? <>PO matches ours: <span className="font-semibold">{ours}</span>{theirs && poNorm(theirs) !== poNorm(ours) ? <> (they wrote {theirs})</> : null}</> : <>Their PO <span className="font-semibold">{theirs}</span> fits our naming. Pick the order above to check it against ours.</>}
      </p>
    )
  }
  const problem = state === 'missing' ? 'No PO on their confirmation.'
    : state === 'not_ours' ? <>Their PO <span className="font-semibold">"{theirs}"</span> isn't ours. Ours is <span className="font-semibold">{ours}</span>.</>
    : <>Their PO <span className="font-semibold">"{theirs}"</span> doesn't fit our naming: letters for the vendor, then the order date{example ? <>, like <span className="font-semibold">{example}</span></> : null}.</>
  return (
    <>
      <Alert variant="warning" className="mb-4">
        <p>{problem}</p>
        <div className="mt-2 text-sm">
          {ask.data && ask.data.status !== 'drafted' ? (
            <>
              <p>{poAskLine(ask.data)}</p>
              <p className="mt-1 flex flex-wrap gap-x-3">
                {ask.data.ask_email ? <Link to={matchLink(ask.data.ask_email.thread_id, { email_id: ask.data.ask_email_id! })} className="font-medium underline">Our email</Link> : null}
                {ask.data.answer_email ? <Link to={matchLink(ask.data.answer_email.thread_id, { email_id: ask.data.answer_email_id! })} className="font-medium underline">Their answer</Link> : null}
                {ask.data.thanks_draft_id ? <Link to={`${ROUTES.mail}?view=drafts&draft=${ask.data.thanks_draft_id}`} className="font-medium underline">The thank-you (Drafts)</Link> : null}
              </p>
            </>
          ) : c.po_draft_id ? (
            <Button size="sm" loading={loading} onClick={() => void openDraft()} leftIcon={<Mail className="size-4" aria-hidden="true" />}>{state === 'missing' ? 'Open the email asking them to add our PO' : 'Open the email asking them to use our PO'}</Button>
          ) : c.order && !ours ? (
            <>The order has no PO. Type ours on <Link to={`${ROUTES.orders}/${c.order.id}`} className="font-medium underline">the order</Link>; the email asking them to use it is then ready here.</>
          ) : !c.order ? (
            <>Pick the order above first. The email asking them to use our PO is then ready here.</>
          ) : (
            <>The email asking them to use our PO is being made; it shows here in a minute.</>
          )}
        </div>
      </Alert>
      {draft ? (
        <ComposeDialog
          draft={{ draft_id: draft.id, order_id: draft.order_id, vendor_link_ids: draft.vendor_link_ids, to: draft.to_emails, cc: draft.cc_emails, subject: draft.subject, body: draft.body, thread_id: draft.thread_id, reply_to_email_id: draft.reply_to_email_id, forward_email_id: draft.forward_email_id, vendor_id: draft.vendor_id, mailbox_id: draft.mailbox_id, note: draft.note ?? undefined, signature: draft.signature, routing_send_id: draft.routing_send_id, confirmation_id: draft.confirmation_id }}
          onClose={() => { setDraft(null); onChanged() }}
          onSent={() => { toast.success('Sent'); onChanged() }} />
      ) : null}
    </>
  )
}
