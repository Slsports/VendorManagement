import { useEffect, useRef, useState, useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useHasInAppHistory } from '@/hooks/useHasInAppHistory'
import toast from 'react-hot-toast'
import { Bell, BellOff, Check, CheckCircle2, ClipboardList, ListTodo, Palette, ExternalLink, Trash2, FolderInput, Forward, Paperclip, Reply, ReplyAll, RotateCcw, Send } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { assignEmailThread, fetchEmailHtml, getMyWatch, stopWatching, watchForReply, fileAttachmentToVendor, getMailbox, getThread, fetchAttachment, listMailboxes, shareThreadToOrders, setArtStatus, setEmailThreadStatus, setEmailVendor, setThreadView, setWorkingOrder, trashThreads, type ThreadDetail } from '@/services/mail'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { MakeFreightBillDialog } from '@/components/freight/MakeFreightBillDialog'
import { SaveToDocumentsDialog } from '@/components/vendors/SaveToDocumentsDialog'
import { MoveDocumentDialog } from '@/components/vendors/MoveDocumentDialog'
import { listPeople } from '@/services/reviews'
import { followUpDraft, forwardDraft, gmailThreadUrl, isInlineImage, splitLinks, isOurAddress, mailWithUrl, newVendorPrefill, replyDraft, splitQuoted, threadState, waited } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { folderLabel, folderOf } from '@/lib/documents'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { ThreadStatusBadge } from '@/components/mail/ThreadStatusBadge'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { ComposeDialog, type ComposeDraft } from '@/components/mail/ComposeDialog'
import { AddOrderDialog } from '@/components/orders/AddOrderDialog'
import { Alert, Button, Spinner } from '@/components/ui'
import { ThreadVendorTags } from '@/components/mail/ThreadVendorTags'
import { AccountingContactLine } from '@/components/accounting/AccountingContactLine'
import { fileAttachmentNow, listDocumentsFor } from '@/services/accountingDocuments'
import { folderLabel as accountingFolderLabel, folderSearch } from '@/lib/accountingDocuments'
import { RecordTasks } from '@/components/tasks/RecordTasks'
import { TaskDialog } from '@/components/tasks/TaskDialog'
import { VendorPicker as SharedVendorPicker, type NewVendorPrefill } from '@/components/vendors/VendorPicker'
import { clearSnooze, mySnoozes } from '@/services/snooze'
import { SnoozeButton } from '@/components/shared/SnoozeButton'

/** One conversation: every message, who owns it, which vendor it is filed to, and where it stands. */
export default function ThreadPage() {
  const { id = '' } = useParams()
  const { organization, role, profile } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => getThread(id), [id])
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const orders = useSupabaseQuery(async () => (organization ? getMailbox(organization.id) : null), [organization?.id])
  // Someone's own mailbox or the old Gmail (Dana, Oct 11): its address for Gmail and replies, and who may answer from it.
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = q.data?.thread.mailbox_id ? (boxes.data ?? []).find((b) => b.id === q.data!.thread.mailbox_id) ?? null : null
  const mailbox = { data: box ? (box.kind !== 'legacy' ? box.address : orders.data) : orders.data }
  const mayAnswer = !box || box.kind !== 'personal' || box.owner_id === profile?.id
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const hasHistory = useHasInAppHistory()
  // "Add order from this email" after completing a Working on order (Dana, Oct 8).
  const [addingOrder, setAddingOrder] = useState(() => params.get('addOrder') === '1')
  const [addingTask, setAddingTask] = useState(false)
  // Snooze (Dana, Oct 9): whether I snoozed this; opening it clears "Back from snooze".
  const snoozeQ = useSupabaseQuery(async () => (profile ? mySnoozes(profile.id, 'thread') : null), [profile?.id, id])
  const myUntil = snoozeQ.data?.hidden.get(id) ?? null
  const cameBack = !!snoozeQ.data?.back.has(id)
  useEffect(() => {
    if (cameBack && profile) void clearSnooze(profile.id, 'thread', id).catch(() => {})
  }, [cameBack, profile, id])
  // Tell me when they reply (Dana, Oct 19): the outside person on this email, and my watch on them
  const watchParty = useMemo(() => {
    const es = q.data?.emails ?? []
    const lastIn = [...es].reverse().find((e) => e.direction === 'in' && e.from_email && !isOurAddress(e.from_email))
    if (lastIn) return { email: lastIn.from_email!, name: lastIn.from_name }
    const lastOutTo = [...es].reverse().find((e) => e.direction === 'out')?.to_emails.find((a) => !isOurAddress(a))
    return lastOutTo ? { email: lastOutTo, name: null } : null
  }, [q.data])
  const watchQ = useSupabaseQuery(async () => (watchParty ? getMyWatch(watchParty.email) : null), [watchParty?.email])
  // "Go to it" from a reply task (Dana, Oct 14): the reply to the latest email they sent is open, ready to write
  const wantsReply = params.get('do') === 'reply'
  // a line in a vendor's Recent Activity (Dana, Oct 20): that email open and in view
  const focusEmail = params.get('email')
  const autoReply = useMemo(() => {
    if (!wantsReply || !q.data || !mailbox.data || !mayAnswer || !canEdit) return null
    const latest = [...q.data.emails].reverse().find((e) => e.direction === 'in') ?? q.data.emails[q.data.emails.length - 1]
    return latest ? replyDraft(q.data.thread, latest, mailbox.data, false) : null
  }, [wantsReply, q.data, mailbox.data, mayAnswer, canEdit])
  const shownDraft = draft ?? autoReply
  const closeDraft = () => {
    setDraft(null)
    if (params.has('do')) { const next = new URLSearchParams(params); next.delete('do'); setParams(next, { replace: true }) }
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading the conversation…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Conversation not found'}</Alert>
  const { thread: t, emails } = q.data
  const lastOut = [...emails].reverse().find((e) => e.direction === 'out')
  // The outside party, for "New vendor": who wrote in, or who we wrote to. Mail only among us has none.
  const firstIn = emails.find((e) => e.direction === 'in')
  const taskPreset = { thread: { id: t.id, name: t.subject || '(no subject)' }, vendor: t.vendor ? { id: t.vendor.id, name: t.vendor.name } : null }
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

  async function deleteAndLeave() {
    if (!window.confirm("Delete this conversation? It goes to Gmail's Trash for 30 days; Restore is under Mail → Deleted.")) return
    try {
      await trashThreads([t.id])
      toast.success('Deleted')
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
          {t.view === 'offers' ? <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Promotions</span> : null}
          {t.vendor ? <Link to={`${ROUTES.vendors}/${t.vendor.id}`} className="font-medium text-brand hover:underline">{t.vendor.name}</Link> : <span className="text-stone-500">Not filed to a vendor</span>}
          <span>· {emails.length} message{emails.length === 1 ? '' : 's'}</span>
          {box ? (
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${t.shared_at ? 'bg-emerald-50 text-emerald-800' : 'bg-violet-50 text-violet-800'}`}>
              {box.kind === 'legacy' ? 'Old Gmail' : box.owner_id === profile?.id ? 'My mail' : box.label}{t.shared_at ? ' · shared to Orders' : ' · private'}
            </span>
          ) : null}
          {box && canEdit ? (
            <button type="button" onClick={() => void act(t.shared_at ? 'Back to private' : 'Shared to Orders: everyone sees it now', () => shareThreadToOrders(t.id, !t.shared_at))} className="text-xs font-medium text-brand hover:underline">
              {t.shared_at ? 'Take back out of Orders' : 'Share to Orders'}
            </button>
          ) : null}
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
            t.view === 'offers' ? 'Moved to Primary' : 'Moved to Promotions',
            async () => {
              const moved = await setThreadView(t.id, t.view === 'offers' ? 'attention' : 'offers')
              if (moved === -1) toast('Only this conversation moved: Dana already decided where this sender\'s mail goes.')
              else if (moved) toast(`${moved} more email${moved === 1 ? '' : 's'} from the same address moved too; new mail like it will follow.`)
            })}>
            {t.view === 'offers' ? 'Move to Primary' : 'Move to Promotions'}
          </Button>
          <ThreadVendorPicker current={t.vendor} prefill={newVendorPrefill({ ...party, isDomain: false })} onPick={(v) => act(v ? `Filed to ${v.name}` : 'Unfiled', () => setEmailVendor(emails[0]!.id, v?.id ?? null))} />
          {t.vendor ? <Button size="sm" variant="ghost" onClick={() => setAddingOrder(true)}>Add order from this email</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => setAddingTask(true)} leftIcon={<ListTodo className="size-4" aria-hidden="true" />}>Task</Button>
          {watchParty && !watchQ.data ? (
            <Button size="sm" variant="ghost" onClick={() => void act(`VMS will tell you when ${watchParty.name || watchParty.email} replies`, async () => { await watchForReply(t.id, watchParty.email, watchParty.name); await watchQ.refetch() })} leftIcon={<Bell className="size-4" aria-hidden="true" />}>Tell me when they reply</Button>
          ) : null}
          {!t.art_status ? <Button size="sm" variant="ghost" onClick={() => void act('On the Artwork approvals card', () => setArtStatus(t.id, 'waiting'))} leftIcon={<Palette className="size-4" aria-hidden="true" />}>Artwork to approve</Button> : null}
          <SnoozeButton kind="thread" ids={[t.id]} until={myUntil} onDone={async () => {
            await snoozeQ.refetch()
            if (hasHistory) navigate(-1)
            else navigate(ROUTES.mail)
          }} />
          <Button size="sm" variant="ghost" onClick={() => void deleteAndLeave()} className="text-red-700 hover:bg-red-50" leftIcon={<Trash2 className="size-4" aria-hidden="true" />}>Delete</Button>
          {lastOut && (threadState(t) === 'no_answer' || threadState(t) === 'waiting')
            ? <Button size="sm" variant={threadState(t) === 'no_answer' ? 'primary' : 'secondary'} onClick={() => setDraft(followUpDraft(t, lastOut))} leftIcon={<Send className="size-4" aria-hidden="true" />}>Follow up</Button>
            : null}
        </section>
      ) : null}

      {/* Artwork approvals (Dana, Oct 10) */}
      {t.art_status ? (
        <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${t.art_status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900'}`}>
          <Palette className="size-4" aria-hidden="true" />
          <span className="font-medium">{t.art_status === 'approved' ? 'Artwork approved' : t.art_status === 'needs_changes' ? 'Changes to send: you have changes to send the vendor' : t.art_status === 'changes_sent' ? 'Changes sent: waiting on the vendor\'s new proof' : `Artwork waiting on your approval${t.art_since ? ` since ${new Date(t.art_since).toLocaleDateString()}` : ''}`}</span>
          {t.art_note ? <span className="text-xs opacity-80">{t.art_note}</span> : null}
          {t.art_status === 'approved' ? <span className="text-xs">Save the final proof: Save to documents › Proofs, then Mark approved.</span> : null}
          {canEdit ? (
            <span className="ml-auto flex flex-wrap gap-2">
              {t.art_status !== 'approved' ? <Button size="sm" onClick={() => void act('Artwork approved', () => setArtStatus(t.id, 'approved'))} leftIcon={<Check className="size-4" aria-hidden="true" />}>Approved</Button> : null}
              {t.art_status === 'waiting' ? <Button size="sm" variant="secondary" onClick={() => void act('Marked: needs changes', () => setArtStatus(t.id, 'needs_changes'))}>Needs changes</Button> : null}
              {t.art_status === 'needs_changes' ? <Button size="sm" variant="secondary" onClick={() => void act('Marked: changes sent', () => setArtStatus(t.id, 'changes_sent'))} leftIcon={<Send className="size-4" aria-hidden="true" />}>Changes sent</Button> : null}
              {t.art_status !== 'waiting' ? <Button size="sm" variant="ghost" onClick={() => void act('Back on the Artwork approvals card', () => setArtStatus(t.id, 'waiting'))}>Waiting on approval again</Button> : null}
              <Button size="sm" variant="ghost" onClick={() => void act('Not an artwork approval', () => setArtStatus(t.id, 'none'))}>Not artwork</Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {watchQ.data ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Bell className="size-4" aria-hidden="true" />
          <span>Watching for a reply from <span className="font-medium">{watchQ.data.name || watchQ.data.address}</span>. You'll get a reminder as soon as they write.</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void act('Stopped watching', async () => { await stopWatching(watchQ.data!.id); await watchQ.refetch() })} leftIcon={<BellOff className="size-4" aria-hidden="true" />}>Stop watching</Button>
        </div>
      ) : null}
      <RecordTasks button={false} className="mb-4 rounded-2xl border border-stone-200 bg-white px-4 py-3" preset={taskPreset} />
      {addingTask ? <TaskDialog preset={taskPreset} onClose={() => setAddingTask(false)} /> : null}
      {box?.kind === 'accounting' && organization ? <AccountingContactLine threadId={t.id} organizationId={organization.id} /> : null}
      <ThreadVendorTags threadId={t.id} emailId={(emails.find((e) => e.direction === 'in') ?? emails[0]!).id} filedVendorId={t.vendor?.id ?? null} canEdit={canEdit} />
      {emails.some((e) => e.freight_pct !== null && e.freight_pct !== undefined) ? (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">Freight rate quoted here: <span className="font-semibold">{emails.find((e) => e.freight_pct !== null && e.freight_pct !== undefined)!.freight_pct}%</span>. Check-in offers it for each vendor on this shipment.</p>
      ) : null}
      <ol className="space-y-3">
        {/* Newest first and open; older ones closed to one line (Dana, Oct 8). */}
        {[...emails].reverse().map((e, i) => (
          <Message key={e.id} email={e} startOpen={i === 0 || e.id === focusEmail} focus={e.id === focusEmail} vendor={t.vendor} carrierId={t.carrier_id ?? null} accounting={box?.kind === 'accounting'}
            onCompose={canEdit && mayAnswer && mailbox.data ? (kind) => setDraft(kind === 'forward' ? forwardDraft(t, e, e.attachments.length) : replyDraft(t, e, mailbox.data!, kind === 'all')) : undefined}
            onEmailAddress={canEdit ? (address) => setDraft({ to: [address], subject: '', body: '', vendor_id: t.vendor?.id ?? null }) : undefined} />
        ))}
      </ol>
      {shownDraft ? <ComposeDialog draft={shownDraft} onClose={closeDraft} onSent={() => {
        // Replied: back to the inbox you came from (Dana, Oct 9); a forward or a new message stays here.
        if (!shownDraft.reply_to_email_id) { void q.refetch(); return }
        if (hasHistory) navigate(-1)
        else navigate(ROUTES.mail)
      }} /> : null}
      {addingOrder && t.vendor ? <AddOrderDialog vendor={t.vendor} threadId={t.id} onClose={() => { setAddingOrder(false); if (params.has('addOrder')) { params.delete('addOrder'); setParams(params, { replace: true }) } }} /> : null}
    </div>
  )
}

function Message({ email: e, startOpen, focus = false, vendor, carrierId, accounting = false, onCompose, onEmailAddress }: { email: ThreadDetail['emails'][number]; startOpen: boolean; focus?: boolean; vendor: { id: string; name: string } | null; carrierId: string | null; accounting?: boolean; onCompose?: (kind: 'reply' | 'all' | 'forward') => void; onEmailAddress?: (address: string) => void }) {
  const [open, setOpen] = useState(startOpen)
  const itemRef = useRef<HTMLLIElement>(null)
  useEffect(() => { if (focus) itemRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [focus])
  // Accounting mail (Dana, Oct 16): where each file was filed, or why it was left here, and "File in Accounting".
  const [filingId, setFilingId] = useState<string | null>(null)
  const [filedNow, setFiledNow] = useState<Record<string, string>>({})
  const docIds = e.attachments.map((a) => filedNow[a.id] ?? a.accounting_document_id).filter((x): x is string => !!x)
  const accountingDocs = useSupabaseQuery(() => (accounting && docIds.length ? listDocumentsFor({ ids: docIds }) : Promise.resolve([])), [accounting, docIds.join(',')])
  async function fileInAccounting(a: Attachment) {
    setFilingId(a.id)
    try {
      const r = await fileAttachmentNow(a.id)
      const hit = r.results.find((x) => x.attachment_id === a.id)
      if (hit?.document_id) { setFiledNow((x) => ({ ...x, [a.id]: hit.document_id! })); toast.success('Filed in Accounting') }
      else toast.error(hit?.error ?? hit?.skip ?? 'Could not file it')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setFilingId(null)
    }
  }
  const [html, setHtml] = useState<string | null>(null)
  const [loadingHtml, setLoadingHtml] = useState(false)
  const [saving, setSaving] = useState<{ id: string; file_name: string } | null>(null)
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [movingFile, setMovingFile] = useState<Attachment | null>(null)
  const [showPictures, setShowPictures] = useState(false)
  const [billFrom, setBillFrom] = useState<{ id: string; file_name: string } | null>(null)
  const [showQuoted, setShowQuoted] = useState(false)
  const { view, viewer } = useDocumentViewer()
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'

  // Where a file was saved (Dana, Oct 10): "Saved to Confirmations › 2026" instead of a Save button.
  const savedTo = (a: Attachment) => saved[a.id] ?? (a.link ? `${folderLabel(folderOf(a.link.kind))}${a.link.doc_year ? ` › ${a.link.doc_year}` : ''}` : a.vendor_link_id ? 'documents' : null)
  const openFile = (a: Attachment) => view({ name: a.file_name, mime: a.mime_type, load: () => fetchAttachment(a.id) })
  const chip = (a: Attachment) => {
    const where = savedTo(a)
    const picture = isPicture(a)
    return (
      <span key={a.id} className={cn('inline-flex rounded-lg bg-stone-100 text-xs text-stone-700', picture ? 'flex-col items-stretch overflow-hidden' : 'items-center gap-1')}>
        {picture && a.gmail_attachment_id ? <AttachmentThumb attachment={a} onOpen={() => openFile(a)} /> : null}
        <span className="inline-flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => openFile(a)} disabled={!a.gmail_attachment_id} className="inline-flex max-w-56 items-center gap-1 px-2 py-1 hover:text-brand disabled:cursor-default disabled:hover:text-stone-700" title={a.gmail_attachment_id ? 'Open' : 'Not available from Gmail'}>
            <Paperclip className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{a.file_name}</span>{a.size ? <span className="shrink-0 text-stone-400"> · {Math.max(1, Math.round(a.size / 1024))} KB</span> : null}
          </button>
          {where ? (canEdit && a.vendor_link_id && a.link
            ? <button type="button" onClick={() => setMovingFile(a)} className="border-l border-stone-200 px-2 py-1 text-emerald-700 hover:text-brand hover:underline" title="Wrong folder? Move it">Saved to {where}</button>
            : <span className="border-l border-stone-200 px-2 py-1 text-emerald-700">Saved to {where}</span>)
            : canEdit && vendor && a.gmail_attachment_id ? (
              <button type="button" onClick={() => setSaving(a)} className="inline-flex items-center gap-1 border-l border-stone-200 px-2 py-1 text-stone-500 hover:text-brand" title={`Save to ${vendor.name}'s documents`}>
                <FolderInput className="size-3.5" aria-hidden="true" />Save to documents
              </button>
            ) : null}
          {canEdit && a.gmail_attachment_id && /pdf/i.test(`${a.mime_type ?? ''} ${a.file_name}`) ? (
            <button type="button" onClick={() => setBillFrom(a)} className="border-l border-stone-200 px-2 py-1 text-stone-500 hover:text-brand" title="Make a freight bill from this PDF">Freight bill</button>
          ) : null}
          {accounting ? (() => {
            const docId = filedNow[a.id] ?? a.accounting_document_id
            const doc = docId ? (accountingDocs.data ?? []).find((d) => d.id === docId) : null
            if (docId) return <Link to={`${ROUTES.accountingDocuments}${doc ? folderSearch(doc) : ''}`} className="border-l border-stone-200 px-2 py-1 text-emerald-700 hover:text-brand hover:underline" title={doc ? doc.file_name : 'Filed in Accounting'}>Filed: {doc ? accountingFolderLabel(doc) : 'Accounting'}</Link>
            return (
              <span className="inline-flex items-center border-l border-stone-200">
                {a.accounting_skip ? <span className="px-2 py-1 text-stone-400" title="The filing step left this file in the email">Left here: {a.accounting_skip}</span> : null}
                {a.gmail_attachment_id ? <button type="button" onClick={() => fileInAccounting(a)} disabled={filingId === a.id} className="inline-flex items-center gap-1 px-2 py-1 text-stone-500 hover:text-brand disabled:opacity-60" title="Read it, name it and file it in the Accounting folders"><FolderInput className="size-3.5" aria-hidden="true" />{filingId === a.id ? 'Filing…' : 'File in Accounting'}</button> : null}
              </span>
            )
          })() : null}
        </span>
      </span>
    )
  }
  const files = e.attachments.filter((a) => !isInlineImage(a))
  const pictures = e.attachments.filter((a) => isInlineImage(a))
  // pictures VMS left for you (Dana, Oct 15: vendors marked "Ask before saving pictures", like Nationwide): one click saves them
  const waiting = e.attachments.filter((a) => !a.vendor_link_id && !saved[a.id] && a.gmail_attachment_id && a.picture_kind && a.picture_kind !== 'logo')
  const [savingPictures, setSavingPictures] = useState(false)
  async function savePictures() {
    if (!vendor) return
    setSavingPictures(true)
    try {
      for (const a of waiting) {
        await fileAttachmentToVendor(a.id, vendor.id, a.picture_kind === 'proof' ? 'proof' : 'image')
        setSaved((x) => ({ ...x, [a.id]: a.picture_kind === 'proof' ? 'Proofs' : 'Images' }))
      }
      toast.success(`Saved to ${vendor.name}'s Images`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingPictures(false)
    }
  }
  const body = splitQuoted(e.body_text || e.snippet || '')
  // Pictures in the message (price photos, signature logos): open it formatted, each picture in its place.
  const triedFormatted = useRef(false)
  useEffect(() => {
    // formatted is the default for every email (Dana, Oct 11); plain text shows while it loads, or when there is none
    if (!open || triedFormatted.current) return
    triedFormatted.current = true
    void showFormatted(true)
  })

  async function showFormatted(quiet = false) {
    setLoadingHtml(true)
    try {
      const h = await fetchEmailHtml(e.id)
      if (!h && !quiet) toast('This message has no formatted version')
      setHtml(h || null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoadingHtml(false)
    }
  }
  return (
    <li ref={itemRef} className={cn('scroll-mt-4 rounded-2xl border bg-white', e.direction === 'out' ? 'border-brand/30' : 'border-stone-200', focus && 'ring-2 ring-brand/40')}>
      {/* The whole header opens and closes the email; the sender's name opens all mail with them (Dana, Oct 10). */}
      <div className="relative flex w-full flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-left">
        <button type="button" onClick={() => setOpen((v) => !v)} className="absolute inset-0 rounded-2xl" aria-expanded={open} aria-label={open ? 'Close this email' : 'Open this email'} />
        <span className="pointer-events-none min-w-0">
          {e.from_email && !isOurAddress(e.from_email) ? (
            <Link to={mailWithUrl(ROUTES.mailWith, e.from_email)} title={`All mail with ${e.from_email}`} className="pointer-events-auto relative font-medium text-stone-900 underline-offset-2 hover:text-brand hover:underline">{e.from_name || e.from_email}</Link>
          ) : <span className="font-medium text-stone-900">{e.from_name || e.from_email}</span>}
          {e.from_name ? <span className="ml-1 text-xs text-stone-500">{e.from_email}</span> : null}
          {e.direction === 'out' ? <span className="ml-2 text-xs font-medium text-brand">sent</span> : null}
          {e.forwarded_from ? <span className="ml-2 text-xs text-stone-500">forwarded from {e.forwarded_name ? `${e.forwarded_name} ` : ''}&lt;{e.forwarded_from}&gt;</span> : null}
          {!open ? <span className="block truncate text-sm text-stone-500">{e.snippet}</span> : null}
        </span>
        <span className="pointer-events-none shrink-0 text-xs text-stone-500" title={new Date(e.received_at).toLocaleString()}>{new Date(e.received_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {waited(e.received_at)} ago</span>
      </div>
      {open ? (
        <div className="border-t border-stone-100 px-4 py-3">
          <p className="mb-2 text-xs text-stone-500">To <AddressLinks list={e.to_emails} />{e.cc_emails.length ? <> · Cc <AddressLinks list={e.cc_emails} /></> : null}</p>
          {canEdit && vendor && waiting.length ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {waiting.length} picture{waiting.length === 1 ? '' : 's'} not saved ({vendor.name}'s pictures wait for you).
              <Button size="sm" variant="secondary" loading={savingPictures} onClick={() => void savePictures()}>Save pictures to Images</Button>
            </div>
          ) : null}
          {files.length || pictures.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {e.billcom_sent_at ? <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700" title="Forwarded to Bill.com's inbox with its attachments">Sent to Bill.com {new Date(e.billcom_sent_at).toLocaleDateString()}</span> : null}
              {files.map(chip)}
              {pictures.length ? (
                showPictures ? pictures.map(chip) : (
                  <button type="button" onClick={() => setShowPictures(true)} className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800">+{pictures.length} image{pictures.length === 1 ? '' : 's'}</button>
                )
              ) : null}
            </div>
          ) : null}
          {html
            ? <iframe title="Formatted message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank"><style>img{max-width:100%;height:auto}</style>${html}`} className="h-[40rem] w-full resize-y rounded-lg border border-stone-200 bg-white" />
            : (
              <>
                <div className="whitespace-pre-wrap break-words text-sm text-stone-800"><LinkedText text={body.fresh} onEmail={onEmailAddress} /></div>
                {body.quoted ? (
                  showQuoted
                    ? <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-stone-200 pl-3 text-sm text-stone-500"><LinkedText text={body.quoted} onEmail={onEmailAddress} /></div>
                    : <button type="button" onClick={() => setShowQuoted(true)} className="mt-2 text-xs font-medium text-stone-500 hover:text-brand">Show earlier messages in this email</button>
                ) : null}
              </>
            )}
          {viewer}
          {movingFile?.vendor_link_id && movingFile.link ? (
            <MoveDocumentDialog link={{ id: movingFile.vendor_link_id, label: movingFile.file_name, kind: movingFile.link.kind, doc_year: movingFile.link.doc_year }} onClose={() => setMovingFile(null)}
              onMoved={(f, year) => { setSaved((x) => ({ ...x, [movingFile.id]: `${folderLabel(f)} › ${year}` })); setMovingFile(null) }} />
          ) : null}
          {billFrom ? <MakeFreightBillDialog attachment={billFrom} carrierId={carrierId} onClose={() => setBillFrom(null)} /> : null}
          {saving && vendor ? (
            <SaveToDocumentsDialog attachment={saving} vendor={vendor} subject={e.subject} receivedAt={e.received_at} onClose={() => setSaving(null)} onSaved={(where) => { setSaved((x) => ({ ...x, [saving.id]: where })); setSaving(null) }} />
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

/** To / Cc addresses: outside ones open all mail with that person. */
function AddressLinks({ list }: { list: string[] }) {
  if (!list.length) return <>—</>
  return <>{list.map((a, i) => (
    <span key={a}>{i ? ', ' : ''}{isOurAddress(a) ? a : <Link to={mailWithUrl(ROUTES.mailWith, a)} title={`All mail with ${a}`} className="hover:text-brand hover:underline">{a}</Link>}</span>
  ))}</>
}

type Attachment = ThreadDetail['emails'][number]['attachments'][number]
const isPicture = (a: { file_name: string; mime_type: string | null }) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.mime_type ?? '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.file_name)

/** A small preview of a picture attachment (Dana, Oct 10: "so I don't have to open it before saving"). Loaded when shown. */
function AttachmentThumb({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url: string | null = null
    let live = true
    fetchAttachment(attachment.id).then((blob) => {
      if (!live) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [attachment.id])
  if (failed) return null
  return (
    <button type="button" onClick={onOpen} className="block h-28 w-44 bg-stone-200" title={`Open ${attachment.file_name}`} aria-label={`Open ${attachment.file_name}`}>
      {src ? <img src={src} alt={attachment.file_name} className="size-full object-contain" /> : <span className="block size-full animate-pulse" />}
    </button>
  )
}

/** Plain-text mail with live links: web addresses open in a new tab, email addresses start a new email. */
function LinkedText({ text, onEmail }: { text: string; onEmail?: (address: string) => void }) {
  return <>{splitLinks(text).map((p, i) => p.kind === 'text' ? <span key={i}>{p.text}</span>
    : p.kind === 'url' ? <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" className="text-brand underline-offset-2 hover:underline">{p.text}</a>
    : onEmail ? <button key={i} type="button" onClick={() => onEmail(p.text)} className="text-brand underline-offset-2 hover:underline">{p.text}</button>
    : <a key={i} href={p.href} className="text-brand underline-offset-2 hover:underline">{p.text}</a>)}</>
}
