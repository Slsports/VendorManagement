import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CircleCheck, Mail } from 'lucide-react'
import { getDraft, type DraftRow } from '@/services/mail'
import type { OrderCheckRow } from '@/services/orderChecks'
import { poNorm, poState } from '@/lib/poCheck'
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
          {c.po_draft_id ? (
            <Button size="sm" loading={loading} onClick={() => void openDraft()} leftIcon={<Mail className="size-4" aria-hidden="true" />}>Open the email asking them to use our PO</Button>
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
          draft={{ draft_id: draft.id, to: draft.to_emails, cc: draft.cc_emails, subject: draft.subject, body: draft.body, thread_id: draft.thread_id, reply_to_email_id: draft.reply_to_email_id, forward_email_id: draft.forward_email_id, vendor_id: draft.vendor_id, mailbox_id: draft.mailbox_id, note: draft.note ?? undefined, signature: draft.signature, routing_send_id: draft.routing_send_id, confirmation_id: draft.confirmation_id }}
          onClose={() => { setDraft(null); onChanged() }}
          onSent={() => { toast.success('Sent'); onChanged() }} />
      ) : null}
    </>
  )
}
