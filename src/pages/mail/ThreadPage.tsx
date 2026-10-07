import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, ExternalLink, Paperclip, RotateCcw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { assignEmailThread, getMailbox, getThread, listVendorNames, setEmailThreadStatus, setEmailVendor, type ThreadDetail } from '@/services/mail'
import { listPeople } from '@/services/reviews'
import { gmailThreadUrl, waited } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { ThreadStatusBadge } from '@/components/mail/ThreadStatusBadge'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { Alert, Button, Input, Spinner } from '@/components/ui'

/** One conversation: every message, who owns it, which vendor it is filed to, and where it stands. */
export default function ThreadPage() {
  const { id = '' } = useParams()
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => getThread(id), [id])
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const mailbox = useSupabaseQuery(async () => (organization ? getMailbox(organization.id) : null), [organization?.id])

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading the conversation…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Conversation not found'}</Alert>
  const { thread: t, emails } = q.data

  async function act(label: string, fn: () => Promise<void>) {
    try {
      await fn()
      toast.success(label)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink fallback={ROUTES.mail} fallbackLabel="Mail" />
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{t.subject || '(no subject)'}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
          <ThreadStatusBadge thread={t} />
          {t.vendor ? <Link to={`${ROUTES.vendors}/${t.vendor.id}`} className="font-medium text-brand hover:underline">{t.vendor.name}</Link> : <span className="text-stone-500">Not filed to a vendor</span>}
          <span>· {emails.length} message{emails.length === 1 ? '' : 's'}</span>
          {mailbox.data ? <a href={gmailThreadUrl(mailbox.data, t.gmail_thread_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-900">· Open in Gmail <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
        </div>
      </header>

      {canEdit ? (
        <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            Owner
            <AssigneeSelect value={t.owner_id} people={people.data ?? []} label="Owner" className="h-9 w-48" onChange={(p) => act(p ? `Handed to ${(people.data ?? []).find((x) => x.id === p)?.full_name ?? 'them'}` : 'Owner cleared', () => assignEmailThread(t.id, p))} />
          </label>
          {t.status === 'handled'
            ? <Button size="sm" variant="secondary" onClick={() => void act('Opened again', () => setEmailThreadStatus(t.id, 'waiting_on_us'))} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>Open again</Button>
            : <Button size="sm" variant="secondary" onClick={() => void act('Marked handled', () => setEmailThreadStatus(t.id, 'handled'))} leftIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}>Mark handled</Button>}
          <VendorPicker current={t.vendor} onPick={(v) => act(v ? `Filed to ${v.name}` : 'Unfiled', () => setEmailVendor(emails[0]!.id, v?.id ?? null))} />
        </section>
      ) : null}

      <ol className="space-y-3">
        {emails.map((e, i) => <Message key={e.id} email={e} startOpen={i === emails.length - 1 || emails.length <= 3} />)}
      </ol>
    </div>
  )
}

function Message({ email: e, startOpen }: { email: ThreadDetail['emails'][number]; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <li className={cn('rounded-2xl border bg-white', e.direction === 'out' ? 'border-brand/30' : 'border-stone-200')}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-left" aria-expanded={open}>
        <span className="min-w-0">
          <span className="font-medium text-stone-900">{e.from_name || e.from_email}</span>
          {e.from_name ? <span className="ml-1 text-xs text-stone-500">{e.from_email}</span> : null}
          {e.direction === 'out' ? <span className="ml-2 text-xs font-medium text-brand">sent</span> : null}
          {!open ? <span className="block truncate text-sm text-stone-500">{e.snippet}</span> : null}
        </span>
        <span className="shrink-0 text-xs text-stone-500" title={new Date(e.received_at).toLocaleString()}>{new Date(e.received_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {waited(e.received_at)} ago</span>
      </button>
      {open ? (
        <div className="border-t border-stone-100 px-4 py-3">
          <p className="mb-2 text-xs text-stone-500">To {e.to_emails.join(', ') || '—'}{e.cc_emails.length ? ` · Cc ${e.cc_emails.join(', ')}` : ''}</p>
          <div className="whitespace-pre-wrap break-words text-sm text-stone-800">{e.body_text || e.snippet}</div>
          {e.attachments.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {e.attachments.map((a) => (
                <li key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 text-xs text-stone-700">
                  <Paperclip className="size-3.5" aria-hidden="true" />{a.file_name}{a.size ? <span className="text-stone-400"> · {Math.max(1, Math.round(a.size / 1024))} KB</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function VendorPicker({ current, onPick }: { current: { id: string; name: string } | null; onPick: (v: { id: string; name: string } | null) => void | Promise<void> }) {
  const { organization } = useAuth()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const vendors = useSupabaseQuery(async () => (editing && organization ? listVendorNames(organization.id) : []), [editing, organization?.id])
  const picked = (vendors.data ?? []).find((v) => v.name.toLowerCase() === name.trim().toLowerCase())
  if (!editing) return <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{current ? 'File to another vendor' : 'File to a vendor'}</Button>
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input list="thread-vendors" value={name} onChange={(e) => setName(e.target.value)} placeholder={vendors.isLoading ? 'Loading vendors…' : 'Type a vendor name'} aria-label="Vendor" className="h-9 sm:w-64" autoFocus />
      <datalist id="thread-vendors">{(vendors.data ?? []).map((v) => <option key={v.id} value={v.name} />)}</datalist>
      <Button size="sm" disabled={!picked} onClick={() => { void onPick(picked!); setEditing(false) }}>File it</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  )
}
