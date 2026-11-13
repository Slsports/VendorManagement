import { useState } from 'react'
import toast from 'react-hot-toast'
import { Truck } from 'lucide-react'
import { openFreightEmail } from '@/services/templates'
import { getDraft, draftFilesOf, type DraftRow } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Button } from '@/components/ui'

/**
 * One click to the order's Freight email (Dana, Nov 13: "1 click to pull up a draft and edit, or not and send"): its
 * terms 1-4, this order's form link and our routing letter attached. Made when there is none; the same draft otherwise.
 */
export function FreightEmailButton({ orderId, size = 'sm', variant = 'secondary', label = 'Freight email', onSent }: {
  orderId: string; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' | 'ghost'; label?: string; onSent?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<DraftRow | null>(null)
  async function open() {
    setBusy(true)
    try {
      const id = await openFreightEmail(orderId)
      const d = await getDraft(id)
      if (d) setDraft(d)
      else toast.error('The freight email could not be opened. Try again.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button type="button" size={size} variant={variant} loading={busy} onClick={() => void open()} leftIcon={<Truck className="size-4" aria-hidden="true" />}>{label}</Button>
      {draft ? (
        <ComposeDialog
          draft={{ draft_id: draft.id, order_id: draft.order_id, vendor_link_ids: draft.vendor_link_ids, saved_files: draftFilesOf(draft.files), to: draft.to_emails, cc: draft.cc_emails, subject: draft.subject, body: draft.body, thread_id: draft.thread_id, reply_to_email_id: draft.reply_to_email_id, forward_email_id: draft.forward_email_id, vendor_id: draft.vendor_id, mailbox_id: draft.mailbox_id, note: draft.note ?? undefined, signature: draft.signature, routing_send_id: draft.routing_send_id, confirmation_id: draft.confirmation_id, attach_routing_letter: draft.attach_routing_letter }}
          onClose={() => setDraft(null)}
          onSent={() => { toast.success('Freight email sent'); setDraft(null); onSent?.() }} />
      ) : null}
    </>
  )
}
