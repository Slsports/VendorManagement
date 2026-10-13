import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Mail, Paperclip } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listCheckConversation, type ConversationEmail } from '@/services/orderChecks'
import { shareThreadToOrders } from '@/services/mail'
import { splitQuoted } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { FoldSection } from '@/components/shared/FoldSection'
import { Alert, Badge, Button } from '@/components/ui'

/**
 * The emails behind this check (Dana, Oct 13: "I have to be able to see the emails threads for this so I can properly
 * review the email Claude puts together"), oldest first, each without the mail quoted under it. Claude read the same.
 */
export function EmailConversation({ emailId, orderId, canEdit, onShared, note = 'Claude reads this whole conversation before it writes the email, so the draft only asks about what is still open.' }: { emailId: string | null; orderId: string | null; canEdit: boolean; onShared: () => void; note?: string }) {
  const q = useSupabaseQuery(() => listCheckConversation(emailId, orderId), [emailId, orderId])
  const mails = q.data?.emails ?? []
  const priv = q.data?.privateThreads ?? []
  const [sharing, setSharing] = useState(false)
  async function share() {
    setSharing(true)
    try {
      for (const t of priv) await shareThreadToOrders(t.id)
      await q.refetch()
      onShared()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSharing(false)
    }
  }
  if (!q.isLoading && !mails.length) return null
  const threads = [...new Set(mails.map((m) => m.thread_id))]
  return (
    <FoldSection title="The email conversation" defaultOpen className="mb-4"
      summary={q.isLoading ? 'Loading…' : `${mails.length} email${mails.length === 1 ? '' : 's'}`}
      actions={threads.length ? <Link to={`${ROUTES.mail}/${threads[threads.length - 1]}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><Mail className="size-4" aria-hidden="true" />Open in Mail</Link> : null}>
      {priv.length ? (
        <Alert variant="warning" className="mb-3">
          {priv.length === 1 ? 'This conversation is' : 'Some of these conversations are'} in {priv.map((t) => t.owner ? `${t.owner.split(' ')[0]}'s` : 'someone\'s').filter((x, i, a) => a.indexOf(x) === i).join(' and ')} own mailbox, so Claude did not read {priv.length === 1 ? 'it' : 'them'}. It is vendor business: share it to Orders so everyone, and Claude, can use it.
          {canEdit ? <Button size="sm" variant="secondary" className="ml-3" loading={sharing} onClick={() => void share()}>Share to Orders</Button> : null}
        </Alert>
      ) : null}
      {q.error ? <Alert variant="error">{q.error}</Alert> : (
        <ol className="space-y-3">
          {mails.map((m, i) => <ConversationItem key={m.id} m={m} showSubject={i === 0 || stripRe(m.subject) !== stripRe(mails[i - 1]!.subject)} />)}
        </ol>
      )}
      {note ? <p className="mt-3 text-xs text-stone-500">{note}</p> : null}
    </FoldSection>
  )
}

const stripRe = (s: string | null) => (s ?? '').replace(/^\s*((re|fw|fwd):\s*)+/i, '').trim().toLowerCase()

function ConversationItem({ m, showSubject }: { m: ConversationEmail; showSubject: boolean }) {
  const [all, setAll] = useState(false)
  const text = splitQuoted(m.body_text ?? m.snippet ?? '').fresh.trim()
  const long = text.length > 600
  const files = (m.attachments ?? []).map((a) => a.file_name).filter((n) => !/^(image\d*|outlook|logo|signature)/i.test(n))
  const ours = m.direction === 'out'
  return (
    <li className={cn('rounded-xl border p-3 text-sm', ours ? 'border-brand/20 bg-brand/5' : 'border-stone-200 bg-white')}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-stone-500">
        <span className="font-semibold text-stone-800">{m.from_name || m.from_email}</span>
        <Badge tone={ours ? 'info' : 'neutral'}>{ours ? 'Us' : 'Vendor'}</Badge>
        <span>{new Date(m.received_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
      </p>
      {showSubject && m.subject ? <p className="mt-1 text-xs font-medium text-stone-600">{m.subject}</p> : null}
      <p className="mt-1.5 whitespace-pre-line text-stone-800">{long && !all ? `${text.slice(0, 600)}…` : text || '(no text)'}</p>
      {long ? <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs font-medium text-brand hover:underline">{all ? 'Show less' : 'Show all'}</button> : null}
      {files.length ? <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-stone-500"><Paperclip className="size-3.5" aria-hidden="true" />{files.join(' · ')}</p> : null}
    </li>
  )
}

