import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useHasInAppHistory } from '@/hooks/useHasInAppHistory'
import toast from 'react-hot-toast'
import { CheckCircle2, ClipboardList, ExternalLink, FolderInput, Forward, Paperclip, Reply, ReplyAll, RotateCcw, Send } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { assignEmailThread, fetchEmailHtml, getMailbox, getThread, fetchAttachment, setEmailThreadStatus, setEmailVendor, setThreadView, setWorkingOrder, type ThreadDetail } from '@/services/mail'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { MakeFreightBillDialog } from '@/components/freight/MakeFreightBillDialog'
import { SaveToDocumentsDialog } from '@/components/vendors/SaveToDocumentsDialog'
import { listPeople } from '@/services/reviews'
import { followUpDraft, forwardDraft, gmailThreadUrl, isInlineImage, newVendorPrefill, replyDraft, splitQuoted, threadState, waited } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { ThreadStatusBadge } from '@/components/mail/ThreadStatusBadge'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { ComposeDialog, type ComposeDraft } from '@/components/mail/ComposeDialog'
import { AddOrderDialog } from '@/components/orders/AddOrderDialog'
import { Alert, Button, Spinner } from '@/components/ui'
import { ThreadVendorTags } from '@/components/mail/ThreadVendorTags'
import { VendorPicker as SharedVendorPicker, type NewVendorPrefill } from '@/components/vendors/VendorPicker'

/** One conversation: every message, who owns it, which vendor it is filed to, and where it stands. */
export default function ThreadPage() {
  const { id = '' } = useParams()
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => getThread(id), [id])
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const mailbox = useSupabaseQuery(async () => (organization ? getMailbox(organization.id) : null), [organization?.id])
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const hasHistory = useHasInAppHistory()
  // "Add order from this email" after completing a Working on order (Dana, Oct 8).
  const [addingOrder, setAddingOrder] = useState(() => params.get('addOrder') === '1')

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading the conversation…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Conversation not found'}</Alert>
  const { thread: t, emails } = q.data
  const lastOut = [...emails].reverse().find((e) => e.direction === 'out')
  // The outside party, for "New vendor": who wrote in, or who we wrote to. Mail only among us has none.
  const firstIn = emails.find((e) => e.direction === 'in')
  const party = firstIn ? { email: firstIn.from_email, displayName: firstIn.from_name } : lastOut ? { email: lastOut.to_emails[0] ?? null, displayName: null } : { email: null, displayName: null }

  // Handled: out of the inbox and back to the list you came from (Dana, Oct 8).
  async function markHandledAndLeave() {
    try {
      await setEmailThreadStatus(t.id, 'handled')
      toast.success('Marked handled')
      if (hasHistory) navigate(-1)
      else navigate(ROUTES.mail)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

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
          {t.view === 'offers' ? <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Offers & catalogs</span> : null}
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
          {t.working_by && !t.working_done_at
            ? <Button size="sm" variant="secondary" onClick={() => void act('No longer tracked as an order', () => setWorkingOrder(t.id, 'unflag'))} leftIcon={<ClipboardList className="size-4 text-brand" aria-hidden="true" />}>Working on order ✓</Button>
            : <Button size="sm" variant="ghost" onClick={() => void act('Working on order: it is on your dashboard', () => setWorkingOrder(t.id, 'flag'))} leftIcon={<ClipboardList className="size-4" aria-hidden="true" />}>Working on order</Button>}
          {t.status === 'handled'
            ? <Button size="sm" variant="secondary" onClick={() => void act('Opened again', () => setEmailThreadStatus(t.id, 'waiting_on_us'))} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>Open again</Button>
            : <Button size="sm" variant="secondary" onClick={() => void markHandledAndLeave()} leftIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}>Mark handled</Button>}
          <Button size="sm" variant="ghost" onClick={() => void act(
            t.view === 'offers' ? 'Moved to Needs attention' : 'Moved to Offers & catalogs',
            async () => {
              const moved = await setThreadView(t.id, t.view === 'offers' ? 'attention' : 'offers')
              if (moved) toast(`${moved} more email${moved === 1 ? '' : 's'} from this sender moved too; their new mail will follow.`)
            })}>
            {t.view === 'offers' ? 'Move to Needs attention' : 'Move to Offers & catalogs'}
          </Button>
          <ThreadVendorPicker current={t.vendor} prefill={newVendorPrefill({ ...party, isDomain: false })} onPick={(v) => act(v ? `Filed to ${v.name}` : 'Unfiled', () => setEmailVendor(emails[0]!.id, v?.id ?? null))} />
          {t.vendor ? <Button size="sm" variant="ghost" onClick={() => setAddingOrder(true)}>Add order from this email</Button> : null}
          {lastOut && (threadState(t) === 'no_answer' || threadState(t) === 'waiting')
            ? <Button size="sm" variant={threadState(t) === 'no_answer' ? 'primary' : 'secondary'} onClick={() => setDraft(followUpDraft(t, lastOut))} leftIcon={<Send className="size-4" aria-hidden="true" />}>Follow up</Button>
            : null}
        </section>
      ) : null}

      <ThreadVendorTags threadId={t.id} emailId={(emails.find((e) => e.direction === 'in') ?? emails[0]!).id} filedVendorId={t.vendor?.id ?? null} canEdit={canEdit} />
      {emails.some((e) => e.freight_pct !== null && e.freight_pct !== undefined) ? (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">Freight rate quoted here: <span className="font-semibold">{emails.find((e) => e.freight_pct !== null && e.freight_pct !== undefined)!.freight_pct}%</span>. Check-in offers it for each vendor on this shipment.</p>
      ) : null}
      <ol className="space-y-3">
        {/* Newest first and open; older ones closed to one line (Dana, Oct 8). */}
        {[...emails].reverse().map((e, i) => (
          <Message key={e.id} email={e} startOpen={i === 0} vendor={t.vendor} carrierId={t.carrier_id ?? null}
            onCompose={canEdit && mailbox.data ? (kind) => setDraft(kind === 'forward' ? forwardDraft(t, e, e.attachments.length) : replyDraft(t, e, mailbox.data!, kind === 'all')) : undefined} />
        ))}
      </ol>
      {draft ? <ComposeDialog draft={draft} onClose={() => setDraft(null)} onSent={() => void q.refetch()} /> : null}
      {addingOrder && t.vendor ? <AddOrderDialog vendor={t.vendor} threadId={t.id} onClose={() => { setAddingOrder(false); if (params.has('addOrder')) { params.delete('addOrder'); setParams(params, { replace: true }) } }} /> : null}
    </div>
  )
}

function Message({ email: e, startOpen, vendor, carrierId, onCompose }: { email: ThreadDetail['emails'][number]; startOpen: boolean; vendor: { id: string; name: string } | null; carrierId: string | null; onCompose?: (kind: 'reply' | 'all' | 'forward') => void }) {
  const [open, setOpen] = useState(startOpen)
  const [html, setHtml] = useState<string | null>(null)
  const [loadingHtml, setLoadingHtml] = useState(false)
  const [saving, setSaving] = useState<{ id: string; file_name: string } | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [showPictures, setShowPictures] = useState(false)
  const [billFrom, setBillFrom] = useState<{ id: string; file_name: string } | null>(null)
  const [showQuoted, setShowQuoted] = useState(false)
  const { view, viewer } = useDocumentViewer()
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'

  const chip = (a: ThreadDetail['emails'][number]['attachments'][number]) => (
    <span key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-stone-100 text-xs text-stone-700">
      <button type="button" onClick={() => view({ name: a.file_name, mime: a.mime_type, load: () => fetchAttachment(a.id) })} disabled={!a.gmail_attachment_id} className="inline-flex items-center gap-1 px-2 py-1 hover:text-brand disabled:cursor-default disabled:hover:text-stone-700" title={a.gmail_attachment_id ? 'Open' : 'Not available from Gmail'}>
        <Paperclip className="size-3.5" aria-hidden="true" />{a.file_name}{a.size ? <span className="text-stone-400"> · {Math.max(1, Math.round(a.size / 1024))} KB</span> : null}
      </button>
      {canEdit && vendor && a.gmail_attachment_id && !a.vendor_link_id && !saved.includes(a.id) ? (
        <button type="button" onClick={() => setSaving(a)} className="inline-flex items-center gap-1 border-l border-stone-200 px-2 py-1 text-stone-500 hover:text-brand" title={`Save to ${vendor.name}'s documents`}>
          <FolderInput className="size-3.5" aria-hidden="true" />Save to documents
        </button>
      ) : a.vendor_link_id || saved.includes(a.id) ? <span className="border-l border-stone-200 px-2 py-1 text-emerald-700">saved</span> : null}
      {canEdit && a.gmail_attachment_id && /pdf/i.test(`${a.mime_type ?? ''} ${a.file_name}`) ? (
        <button type="button" onClick={() => setBillFrom(a)} className="border-l border-stone-200 px-2 py-1 text-stone-500 hover:text-brand" title="Make a freight bill from this PDF">Freight bill</button>
      ) : null}
    </span>
  )
  const files = e.attachments.filter((a) => !isInlineImage(a))
  const pictures = e.attachments.filter((a) => isInlineImage(a))
  const body = splitQuoted(e.body_text || e.snippet || '')

  async function showFormatted() {
    setLoadingHtml(true)
    try {
      const h = await fetchEmailHtml(e.id)
      if (!h) toast('This message has no formatted version')
      setHtml(h || null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoadingHtml(false)
    }
  }
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
          {files.length || pictures.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {files.map(chip)}
              {pictures.length ? (
                showPictures ? pictures.map(chip) : (
                  <button type="button" onClick={() => setShowPictures(true)} className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800">+{pictures.length} image{pictures.length === 1 ? '' : 's'}</button>
                )
              ) : null}
            </div>
          ) : null}
          {html
            ? <iframe title="Formatted message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank">${html}`} className="h-[32rem] w-full rounded-lg border border-stone-200 bg-white" />
            : (
              <>
                <div className="whitespace-pre-wrap break-words text-sm text-stone-800">{body.fresh}</div>
                {body.quoted ? (
                  showQuoted
                    ? <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-stone-200 pl-3 text-sm text-stone-500">{body.quoted}</div>
                    : <button type="button" onClick={() => setShowQuoted(true)} className="mt-2 text-xs font-medium text-stone-500 hover:text-brand">Show earlier messages in this email</button>
                ) : null}
              </>
            )}
          {viewer}
          {billFrom ? <MakeFreightBillDialog attachment={billFrom} carrierId={carrierId} onClose={() => setBillFrom(null)} /> : null}
          {saving && vendor ? (
            <SaveToDocumentsDialog attachment={saving} vendor={vendor} subject={e.subject} receivedAt={e.received_at} onClose={() => setSaving(null)} onSaved={() => { setSaved((x) => [...x, saving.id]); setSaving(null) }} />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {onCompose ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => onCompose('reply')} leftIcon={<Reply className="size-4" aria-hidden="true" />}>Reply</Button>
                {e.to_emails.length + e.cc_emails.length > 1 ? <Button size="sm" variant="ghost" onClick={() => onCompose('all')} leftIcon={<ReplyAll className="size-4" aria-hidden="true" />}>Reply all</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => onCompose('forward')} leftIcon={<Forward className="size-4" aria-hidden="true" />}>Forward</Button>
              </>
            ) : null}
            {html ? <Button size="sm" variant="ghost" onClick={() => setHtml(null)}>Plain text</Button> : <Button size="sm" variant="ghost" loading={loadingHtml} onClick={() => void showFormatted()}>Show formatted</Button>}
          </div>
        </div>
      ) : null}
    </li>
  )
}

function ThreadVendorPicker({ current, prefill, onPick }: { current: { id: string; name: string } | null; prefill?: NewVendorPrefill; onPick: (v: { id: string; name: string } | null) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  if (!editing) return <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{current ? 'File to another vendor' : 'File to a vendor'}</Button>
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <SharedVendorPicker autoFocus className="sm:w-64" prefill={prefill} onPick={(v) => { setEditing(false); return onPick(v) }} />
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  )
}
