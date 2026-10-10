import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, FileText, RefreshCw, Send, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { checkIssues, checkRows, getOrderCheck, listCheckDocuments, orderCheckAction, runOrderChecks, type CheckAction, type CheckRow, type OrderCheckRow } from '@/services/orderChecks'
import { listOrders } from '@/services/orders'
import { listPeople } from '@/services/reviews'
import { downloadVendorFile } from '@/services/lines'
import { CHECK_KIND_LABEL, CHECK_TITLE, checkStatusText } from '@/lib/orderChecks'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { money as formatCurrency } from '@/lib/freight'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Alert, Badge, Button, Select, Spinner } from '@/components/ui'

const COLUMNS = {
  what: (r: CheckRow) => r.what,
  ours: (r: CheckRow) => r.ours,
  theirs: (r: CheckRow) => r.theirs,
  ok: (r: CheckRow) => r.ok,
}

/**
 * One confirmation or invoice checked against the order (Dana, Oct 10): the summary, every difference, the
 * documents side by side, and the draft email to the vendor. Whoever placed the order looks at it (or whoever
 * it is handed to), sends the email after any edits, or marks it looked at.
 */
export default function OrderCheckPage() {
  const { id = '' } = useParams()
  const q = useSupabaseQuery(() => getOrderCheck(id), [id])
  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Not found'}</Alert>
  return <CheckView c={q.data} refetch={q.refetch} />
}

function CheckView({ c, refetch }: { c: OrderCheckRow; refetch: () => Promise<unknown> }) {
  const { organization, role } = useAuth()
  const navigate = useNavigate()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const { view, viewer } = useDocumentViewer()
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const against = useSupabaseQuery(() => listCheckDocuments(c.against_ids), [c.against_ids.join(',')])
  const rows = checkRows(c)
  const issues = checkIssues(c)
  const { sorted, sort, toggle } = useTableSort(rows, COLUMNS)
  const st = checkStatusText(c)
  const working = c.status === 'reading' || c.status === 'comparing'

  async function act(label: string, action: CheckAction, opts: Parameters<typeof orderCheckAction>[2] = {}, after?: () => void) {
    setBusy(true)
    try {
      await orderCheckAction(c.id, action, opts)
      toast.success(label)
      if (after) after()
      else await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function checkNow() {
    setBusy(true)
    const t = toast.loading('Claude is reading and comparing… (about a minute)')
    try {
      if (c.status === 'failed') await orderCheckAction(c.id, 'recheck')
      await runOrderChecks(c.id)
      // reading and comparing are two steps; run the second one too when the first found the order
      const next = await getOrderCheck(c.id)
      if (next.status === 'comparing') await runOrderChecks(c.id)
      toast.success('Checked', { id: t })
    } catch (err) {
      toast.error(errorMessage(err), { id: t })
    } finally {
      setBusy(false)
      await refetch()
    }
  }

  function open(d: { label: string; file_name: string | null; storage_path: string | null; mime_type: string | null; url: string | null }) {
    if (d.storage_path) view({ name: d.file_name ?? d.label, mime: d.mime_type, load: () => downloadVendorFile(d.storage_path!) })
    else if (d.url) window.open(d.url, '_blank', 'noopener')
  }

  const leave = () => navigate(-1)
  return (
    <div className="mx-auto max-w-5xl pb-16">
      <BackLink fallback={ROUTES.dashboard} fallbackLabel="Dashboard" />
      <PageHeader eyebrow={CHECK_TITLE[c.kind]} title={c.vendor?.name ?? 'Vendor not filed'}
        description={[c.doc_number ? `${CHECK_KIND_LABEL[c.kind]} ${c.doc_number}` : null, c.doc_date ? new Date(`${c.doc_date}T12:00:00`).toLocaleDateString() : null, c.doc_total !== null ? formatCurrency(c.doc_total) : null, c.po_number ? `PO ${c.po_number}` : null].filter(Boolean).join(' · ') || undefined} />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3">
        <Badge tone={st.tone}>{st.text}</Badge>
        {c.order ? <Link to={`${ROUTES.orders}/${c.order.id}`} className="text-sm font-medium text-brand hover:underline">Order{c.order.po_number ? ` PO ${c.order.po_number}` : ''}{c.order.order_date ? ` · ${new Date(`${c.order.order_date}T12:00:00`).toLocaleDateString()}` : ''}{c.order.est_cost !== null ? ` · ${formatCurrency(c.order.est_cost)}` : ''}</Link> : null}
        {canEdit ? (
          <span className="ml-auto flex items-center gap-2 text-sm text-stone-600">
            Looked at by
            <AssigneeSelect value={c.assigned_to} people={people.data ?? []} label="Who looks at this" className="h-9 text-sm" onChange={(p) => act(p ? 'Handed over' : 'Unassigned', 'assign', { profile: p })} />
          </span>
        ) : c.assignee ? <span className="ml-auto text-sm text-stone-600">Looked at by {c.assignee.full_name}</span> : null}
      </div>

      {working ? (
        <Alert variant="info" className="mb-4">
          Claude is {c.status === 'reading' ? 'reading the document' : 'comparing it with the order'}. This page fills in when it is done.
          {canEdit ? <Button size="sm" variant="secondary" className="ml-3" loading={busy} onClick={() => void checkNow()} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Check now</Button> : null}
        </Alert>
      ) : null}
      {c.status === 'failed' ? (
        <Alert variant="error" className="mb-4">
          {c.read_note ?? 'Claude could not read this document.'}
          {canEdit ? <Button size="sm" variant="secondary" className="ml-3" loading={busy} onClick={() => void checkNow()} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Try again</Button> : null}
        </Alert>
      ) : null}
      {c.status === 'needs_order' ? <PickOrder c={c} canEdit={canEdit} busy={busy} onPick={(orderId) => act('Order picked; Claude compares it next', 'set_order', { order: orderId }, () => void checkNow())} /> : null}

      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        <DocCard title={`This ${CHECK_KIND_LABEL[c.kind].toLowerCase()}`} docs={c.document ? [c.document] : []} onOpen={open} />
        <DocCard title={`Compared with: ${c.against ?? (working ? '…' : 'nothing yet')}`} docs={against.data ?? []} onOpen={open} />
      </section>

      {c.summary ? (
        <section className={cn('mb-4 rounded-2xl border p-5', c.result === 'match' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600">Summary</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-stone-900">{c.summary}</p>
          {issues.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-900">{issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
          ) : null}
        </section>
      ) : null}

      {rows.length ? (
        <section className="mb-4 overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500">
              <tr>
                <SortHeader label="What" sortKey="what" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label={c.kind === 'invoice' ? 'Confirmation' : 'We ordered'} sortKey="ours" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label={c.kind === 'invoice' ? 'Invoice' : 'Confirmation'} sortKey="theirs" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="OK" sortKey="ok" sort={sort} onSort={toggle} className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((r, i) => (
                <tr key={i} className={r.ok ? '' : 'bg-red-50/60'}>
                  <td className="px-3 py-2 font-medium text-stone-900">{r.what}{r.note ? <span className="block text-xs font-normal text-stone-500">{r.note}</span> : null}</td>
                  <td className="px-3 py-2 text-stone-700">{r.ours ?? '—'}</td>
                  <td className="px-3 py-2 text-stone-700">{r.theirs ?? '—'}</td>
                  <td className="px-3 py-2">{r.ok ? <Check className="size-4 text-green-600" aria-label="Matches" /> : <X className="size-4 text-red-600" aria-label="Different" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {c.draft_body && c.status === 'to_review' ? (
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Email Claude drafted to the vendor</h2>
          <p className="mt-2 text-xs text-stone-500">To {c.draft_to.join(', ') || '(no address on file: add one)'} · {c.draft_subject}</p>
          <p className="mt-2 whitespace-pre-line rounded-xl bg-stone-50 p-3 text-sm text-stone-800">{c.draft_body}</p>
        </section>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {c.status === 'to_review' && issues.length ? <Button loading={busy} onClick={() => setComposing(true)} leftIcon={<Send className="size-4" aria-hidden="true" />}>Review &amp; send email</Button> : null}
          {c.status === 'to_review' ? <Button variant={issues.length ? 'secondary' : 'primary'} loading={busy} onClick={() => void act(issues.length ? 'Marked done, no email' : 'Looked at', 'done', {}, leave)} leftIcon={<Check className="size-4" aria-hidden="true" />}>{issues.length ? 'Done, no email needed' : 'Looks good, done'}</Button> : null}
          {c.status === 'to_review' || c.status === 'failed' ? <Button variant="ghost" loading={busy} onClick={() => void act('Comparing again', 'recheck', {}, () => void checkNow())} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Check again</Button> : null}
          {c.status !== 'done' && c.status !== 'dismissed' ? <Button variant="ghost" loading={busy} onClick={() => void act('Set aside', 'dismiss', {}, leave)}>Not a {CHECK_KIND_LABEL[c.kind].toLowerCase()}: set aside</Button> : null}
          {c.status === 'done' || c.status === 'dismissed' ? <Button variant="secondary" loading={busy} onClick={() => void act('Back on the list', 'reopen')}>Reopen</Button> : null}
        </div>
      ) : null}

      {composing ? (
        <ComposeDialog
          draft={{ to: c.draft_to, subject: c.draft_subject ?? `${CHECK_KIND_LABEL[c.kind]} ${c.doc_number ?? ''}${c.po_number ? ` / PO ${c.po_number}` : ''}`.trim(), body: c.draft_body ?? '', thread_id: c.email?.thread_id ?? null, reply_to_email_id: c.email?.id ?? null, vendor_id: c.vendor?.id ?? null, note: 'Edit anything before sending. Your signature is added when it sends.' }}
          onClose={() => setComposing(false)}
          onSent={(threadId) => { setComposing(false); void act('Sent, and marked done', 'sent', { thread: threadId }, leave) }}
        />
      ) : null}
      {viewer}
    </div>
  )
}

function DocCard({ title, docs, onOpen }: { title: string; docs: { id: string; label: string; file_name: string | null; storage_path: string | null; mime_type: string | null; url: string | null }[]; onOpen: (d: (typeof docs)[number]) => void }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      {docs.length ? (
        <ul className="mt-2 space-y-1">
          {docs.map((d) => (
            <li key={d.id}><button type="button" onClick={() => onOpen(d)} className="flex items-center gap-2 text-left text-sm font-medium text-stone-900 hover:text-brand"><FileText className="size-4 shrink-0 text-stone-400" aria-hidden="true" />{d.file_name ?? d.label}</button></li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-stone-500">No document; compared with the order record.</p>}
    </div>
  )
}

/** "Which order is this for?": the vendor's orders, newest first. */
function PickOrder({ c, canEdit, busy, onPick }: { c: OrderCheckRow; canEdit: boolean; busy: boolean; onPick: (orderId: string) => void }) {
  const { organization } = useAuth()
  const orders = useSupabaseQuery(async () => (organization && c.vendor ? listOrders(organization.id, { vendorId: c.vendor.id, limit: 60 }) : []), [organization?.id, c.vendor?.id])
  const [pick, setPick] = useState('')
  return (
    <Alert variant="warning" className="mb-4">
      <p>Claude could not tell which order this {CHECK_KIND_LABEL[c.kind].toLowerCase()} is for{c.po_number ? ` (it says PO ${c.po_number})` : ''}. Pick it:</p>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 max-w-md text-sm" aria-label="Order">
            <option value="">{orders.isLoading ? 'Loading orders…' : c.vendor ? 'Choose an order' : 'File the vendor first'}</option>
            {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{[o.order_date ? new Date(`${o.order_date}T12:00:00`).toLocaleDateString() : 'No date', o.po_number ? `PO ${o.po_number}` : null, o.est_cost !== null ? formatCurrency(o.est_cost) : null, o.description?.slice(0, 40)].filter(Boolean).join(' · ')}</option>)}
          </Select>
          <Button size="sm" disabled={!pick} loading={busy} onClick={() => onPick(pick)}>Use this order</Button>
        </div>
      ) : null}
    </Alert>
  )
}
