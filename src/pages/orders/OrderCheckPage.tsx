import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, ClipboardCheck, FileText, RefreshCw, Send, Trash2, Undo2, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { useTableSort } from '@/hooks/useTableSort'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { addUsualCharge, checkIssues, checkNewItems, checkRows, editCheckRow, makeOrderFromCheck, saveFinalOrder, getOrderCheck, listCheckDocuments, orderCheckAction, runOrderChecks, type CheckAction, type CheckRow, type OrderCheckRow } from '@/services/orderChecks'
import { listOrders } from '@/services/orders'
import { listPeople } from '@/services/reviews'
import { downloadVendorFile } from '@/services/lines'
import { CHECK_KIND_LABEL, CHECK_TITLE, checkStatusText, priceIn } from '@/lib/orderChecks'
import { buildFinalOrder, finalOrderEmail, isFieldRow, priceFlag, rowHandled, rowQtys, type ReadLine, type RowEdit } from '@/lib/finalOrder'
import { listCheckItemChanges } from '@/services/itemChanges'
import { ItemChangeList } from '@/components/review/ItemChangeList'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { money as formatCurrency } from '@/lib/freight'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { EmailConversation } from '@/components/orders/EmailConversation'
import { ConfirmationPoLine } from '@/components/orders/ConfirmationPoLine'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'
import { Modal } from '@/components/shared/Modal'

const COLUMNS = {
  what: (r: CheckRow) => r.what,
  ours: (r: CheckRow) => r.ours,
  theirs: (r: CheckRow) => r.theirs,
  ok: (r: CheckRow) => r.ok,
  our_cost: (r: CheckRow) => r.our_cost ?? null,
  their_price: (r: CheckRow) => r.their_price ?? null,
}

/**
 * One confirmation or invoice checked against the order (Dana, Oct 10): the summary, every difference, the
 * documents side by side, and the draft email to the vendor. Whoever placed the order looks at it (or whoever
 * it is handed to), sends the email after any edits, or marks it looked at.
 */
export default function OrderCheckPage() {
  const { id = '' } = useParams()
  const q = useSupabaseQuery(() => getOrderCheck(id), [id])
  const { refetch } = q
  useLiveTable('order_checks', `id=eq.${id}`, () => { void refetch() })
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
  /** "This is a usual charge for this vendor" (Dana, Oct 15), open on a row. */
  const [usual, setUsual] = useState<{ what: string; price: string; per: string } | null>(null)
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const against = useSupabaseQuery(() => listCheckDocuments(c.against_ids), [c.against_ids.join(',')])
  const rows = checkRows(c)
  const issues = checkIssues(c)
  const newItems = checkNewItems(c)
  const readLines = ((c.reading as { lines?: unknown[] } | null)?.lines ?? []).length
  const { sorted, sort, toggle } = useTableSort(rows, COLUMNS)
  const st = checkStatusText(c)
  const working = c.status === 'reading' || c.status === 'comparing'
  // the final confirmed order (Dana, Oct 16): change a quantity, remove an item, or tick it OK, then send it back
  const [edits, setEdits] = useState<Record<string, RowEdit>>(() => (c.row_edits ?? {}) as Record<string, RowEdit>)
  const readingLines = ((c.reading as { lines?: ReadLine[] } | null)?.lines ?? [])
  const finalMode = c.kind === 'confirmation' && rows.some((r) => !isFieldRow(r))
  const editable = finalMode && canEdit && c.status === 'to_review'
  const hasPrices = rows.some((r) => r.our_cost != null || r.their_price != null)
  // items the vendor says are unavailable (Dana, Oct 18): decided ones change the final order and its email
  const unavailable = useSupabaseQuery(() => listCheckItemChanges(c.id), [c.id])
  const final = finalMode ? buildFinalOrder(rows, edits, readingLines, newItems, unavailable.data ?? []) : null
  const firstName = /^Hi ([^,\n]+),/.exec(c.draft_body ?? '')?.[1]?.trim() ?? null
  const finalEmail = final ? finalOrderEmail({ firstName: firstName && firstName.toLowerCase() !== 'there' ? firstName : null, docNumber: c.doc_number, po: c.order?.po_number ?? c.po_number, items: final.items, changes: final.changes }) : null

  async function edit(what: string, e: RowEdit | null) {
    const before = edits
    setEdits((x) => { const n = { ...x }; if (e && Object.keys(e).length) n[what] = e; else delete n[what]; return n })
    try {
      setEdits(await editCheckRow(c.id, what, e))
    } catch (err) {
      setEdits(before)
      toast.error(errorMessage(err))
    }
  }

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

  /** "This is our order" (Dana, Oct 15): the confirmation's lines become the order; its invoices are checked against it. */
  async function saveAsOrder() {
    if (!window.confirm(c.order ? "Replace the order's lines with this confirmation's lines?" : 'Make the order from this confirmation?')) return
    setBusy(true)
    try {
      const orderId = await makeOrderFromCheck(c.id)
      toast.success('Saved as our order')
      navigate(`${ROUTES.orders}/${orderId}`)
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
          Couldn&apos;t read this paper. Open it below to check it by eye, or try again.
          {canEdit ? <Button size="sm" variant="secondary" className="ml-3" loading={busy} onClick={() => void checkNow()} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Try again</Button> : null}
          {c.read_note ? <details className="mt-2 text-xs"><summary className="cursor-pointer">What Claude sent back</summary><p className="mt-1 break-words">{c.read_note}</p></details> : null}
        </Alert>
      ) : null}
      {c.status === 'needs_order' || (c.status === 'to_review' && !c.order_id) ? <PickOrder c={c} canEdit={canEdit} busy={busy} onPick={(orderId) => act('Order picked; Claude compares it next', 'set_order', { order: orderId }, () => void checkNow())} /> : null}
      {c.report_id && c.report_ticked === false && !working ? (
        <Alert variant="warning" className="mb-4">
          <p>Claude compared this with the sales report closest before the confirmation, because no report is ticked <strong>Used to place the order</strong>. Is it the one you ordered from?</p>
          {canEdit ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" loading={busy} onClick={() => act('Ticked: used to place the order', 'tick_report')}>Yes, we ordered from this report</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => act('Claude compares again', 'recheck', {}, () => void checkNow())} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>I ticked another one: check again</Button>
            </div>
          ) : null}
          <p className="mt-2 text-xs">To use a different report, tick it in {c.vendor ? <Link to={`${ROUTES.vendors}/${c.vendor.id}`} className="font-medium underline">{c.vendor.name} › Sales reports</Link> : 'the vendor\'s Sales reports folder'}, then click <strong>check again</strong>.</p>
        </Alert>
      ) : null}
      {/* the PO on their confirmation against ours (Dana, Oct 20) */}
      <ConfirmationPoLine c={c} onChanged={() => void refetch()} />

      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        <DocCard title={`This ${CHECK_KIND_LABEL[c.kind].toLowerCase()}`} docs={c.document ? [c.document] : []} onOpen={open} />
        <DocCard title={`Compared with: ${c.against ?? (working ? '…' : 'nothing yet')}`} docs={against.data ?? []} onOpen={open}
          order={c.order && !c.against?.startsWith('Sales report') && c.kind === 'confirmation' ? c.order : null} />
      </section>

      {c.summary ? (
        <section className={cn('mb-4 rounded-2xl border p-5', c.result === 'match' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600">Summary</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-stone-900">{c.summary}</p>
          {/* the line-by-line table below shows each item with its name (Dana, Oct 16: the list repeated it) */}
          {issues.length && !rows.length ? (
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
                <SortHeader label={c.kind === 'invoice' ? 'Confirmation' : c.against?.startsWith('Sales report') ? 'Sales report' : 'We ordered'} sortKey="ours" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label={c.kind === 'invoice' ? 'Invoice' : 'Confirmation'} sortKey="theirs" sort={sort} onSort={toggle} className="px-3 py-2" />
                {hasPrices ? <SortHeader label={c.against?.startsWith('Sales report') ? 'Last cost (ours)' : 'Our cost'} sortKey="our_cost" sort={sort} onSort={toggle} className="px-3 py-2" /> : null}
                {hasPrices ? <SortHeader label="Their price" sortKey="their_price" sort={sort} onSort={toggle} className="px-3 py-2" /> : null}
                <SortHeader label="OK" sortKey="ok" sort={sort} onSort={toggle} className="px-3 py-2" />
                {finalMode ? <th className="px-3 py-2">Final</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((r, i) => {
                const item = finalMode && !isFieldRow(r)
                const e = edits[r.what]
                const q = item ? rowQtys(r, e) : null
                const handled = item && !r.ok && rowHandled(r, e)
                const flag = item ? priceFlag(r, readingLines) : null
                return (
                <tr key={i} className={cn(e?.removed ? 'bg-stone-50 text-stone-400 line-through' : handled ? 'bg-green-50/70' : r.ok ? '' : 'bg-red-50/60')}>
                  <td className="px-3 py-2 font-medium text-stone-900">{r.what}{r.note ? <span className="block text-xs font-normal text-stone-500">{r.note}</span> : null}
                    {flag ? (
                      <span className="mt-1 block text-xs font-normal text-amber-700">
                        Their price is {Math.round((flag.theirs / flag.ours - 1) * 100)}% above what we paid last time.
                        {editable && !e?.removed ? <label className="ml-2 inline-flex items-center gap-1 text-stone-700"><input type="checkbox" checked={!!e?.askPrice} onChange={(ev) => void edit(r.what, { ...(e ?? {}), askPrice: ev.target.checked || undefined })} className="size-3.5 accent-brand" /> Ask about price</label> : e?.askPrice ? ' Asked in the email.' : null}
                      </span>
                    ) : null}

      {/* summary, then the line-by-line table, then the emails (Dana, Oct 20) */}
      <EmailConversation emailId={c.email?.id ?? null} orderId={c.order?.id ?? null} canEdit={canEdit} onShared={() => void act('Shared to Orders; Claude compares again', 'recheck', {}, () => void checkNow())} />
                    {!r.ok && canEdit && c.vendor && c.status === 'to_review' ? <button type="button" onClick={() => setUsual({ what: r.what, price: priceIn(r.theirs)?.toString() ?? '', per: 'each' })} className="mt-1 block text-xs font-normal text-brand hover:underline">This is a usual charge for this vendor</button> : null}</td>
                  <td className="px-3 py-2 text-stone-700">{r.ours ?? '—'}</td>
                  <td className="px-3 py-2 text-stone-700">{r.theirs ?? '—'}</td>
                  {hasPrices ? <td className="px-3 py-2 text-stone-500">{r.our_cost != null ? formatCurrency(r.our_cost) : ''}</td> : null}
                  {hasPrices ? <td className={cn('px-3 py-2', flag ? 'font-medium text-amber-700' : 'text-stone-700')}>{r.their_price != null ? formatCurrency(r.their_price) : ''}</td> : null}
                  <td className="px-3 py-2">{r.ok || (e?.ok && !e.removed) ? <Check className="size-4 text-green-600" aria-label="Matches" /> : <X className="size-4 text-red-600" aria-label="Different" />}</td>
                  {finalMode ? (
                    <td className="px-3 py-2 no-underline">
                      {item && q ? (editable ? (
                        <div className="flex items-center gap-1" style={{ textDecoration: 'none' }}>
                          {e?.removed ? (
                            <Button size="sm" variant="ghost" onClick={() => void edit(r.what, null)} leftIcon={<Undo2 className="size-3.5" aria-hidden="true" />}>Put back</Button>
                          ) : (
                            <>
                              <Input type="number" min={0} inputMode="numeric" aria-label={`Final quantity for ${r.what}`} className="h-8 w-20 text-sm"
                                defaultValue={q.final} key={`${r.what}:${q.final}`}
                                onBlur={(ev) => { const v = ev.target.value === '' ? null : Number(ev.target.value); if (v !== q.final) void edit(r.what, v === null ? null : { qty: v }) }} />
                              {!r.ok ? <button type="button" onClick={() => void edit(r.what, e?.ok ? null : { ok: true })} title="OK as the confirmation has it" aria-label={`OK: ${r.what}`} className={cn('rounded-md p-1.5 hover:bg-green-100', e?.ok ? 'bg-green-100 text-green-700' : 'text-stone-400')}><Check className="size-4" aria-hidden="true" /></button> : null}
                              <button type="button" onClick={() => void edit(r.what, { removed: true })} title="Remove from the order" aria-label={`Remove ${r.what}`} className="rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" aria-hidden="true" /></button>
                            </>
                          )}
                        </div>
                      ) : <span className="text-stone-700">{e?.removed ? 'Removed' : q.final}</span>) : null}
                    </td>
                  ) : null}
                </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {(unavailable.data ?? []).some((u) => u.read_as !== 'backordered') ? (
        <div className="mb-4">
          <ItemChangeList title="Unavailable items" changeIds={(unavailable.data ?? []).map((u) => u.id)} canEdit={canEdit} onDone={() => void unavailable.refetch()} />
        </div>
      ) : null}
      {(unavailable.data ?? []).some((u) => u.read_as === 'backordered') ? (
        <p className="mb-4 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-700">
          {(unavailable.data ?? []).filter((u) => u.read_as === 'backordered').length} backordered (still coming){c.order_id ? <>: listed on <Link to={`${ROUTES.orders}/${c.order_id}`} className="text-brand hover:underline">the order</Link></> : ''}.
        </p>
      ) : null}

      {newItems.length ? (
        <section className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-800">New items to double check</h2>
          <p className="mt-1 text-xs text-sky-900">On the confirmation but not on our order or sales report: picked at the show. Not counted as issues.</p>
          <ul className="mt-2 space-y-1 text-sm text-stone-800">
            {newItems.map((x, i) => <li key={i}>{x.what}{x.qty != null ? ` · ${x.qty}` : ''}{x.price != null ? ` at ${formatCurrency(x.price)}` : ''}</li>)}
          </ul>
        </section>
      ) : null}

      {finalEmail && c.status === 'to_review' ? (
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Final order email to the vendor</h2>
          <p className="mt-1 text-xs text-stone-500">Built from the table: change a <strong>Final</strong> quantity, tick <strong>OK</strong> or remove an item and it updates. You can still edit it before sending.</p>
          <p className="mt-2 whitespace-pre-line rounded-xl bg-stone-50 p-3 text-sm text-stone-800">{finalEmail}</p>
        </section>
      ) : c.draft_body && c.status === 'to_review' ? (
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Email Claude drafted to the vendor</h2>
          <p className="mt-2 text-xs text-stone-500">To {c.draft_to.join(', ') || '(no address on file: add one)'} · {c.draft_subject}</p>
          <p className="mt-2 whitespace-pre-line rounded-xl bg-stone-50 p-3 text-sm text-stone-800">{c.draft_body}</p>
        </section>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {c.status === 'to_review' && (finalMode || issues.length) ? <Button loading={busy} onClick={() => setComposing(true)} leftIcon={<Send className="size-4" aria-hidden="true" />}>{finalMode ? 'Review & send final order' : 'Review & send email'}</Button> : null}
          {c.status === 'to_review' ? <Button variant={issues.length ? 'secondary' : 'primary'} loading={busy} onClick={() => void act(issues.length ? 'Marked done, no email' : 'Looked at', 'done', {}, leave)} leftIcon={<Check className="size-4" aria-hidden="true" />}>{issues.length ? 'Done, no email needed' : 'Looks good, done'}</Button> : null}
          {c.kind === 'confirmation' && (c.status === 'to_review' || c.status === 'needs_order') && readLines > 0 ? (
            <Button variant="secondary" loading={busy} onClick={() => void saveAsOrder()} leftIcon={<ClipboardCheck className="size-4" aria-hidden="true" />}>This is our order</Button>
          ) : null}
          {c.status === 'to_review' || c.status === 'failed' ? <Button variant="ghost" loading={busy} onClick={() => void act('Comparing again', 'recheck', {}, () => void checkNow())} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Check again</Button> : null}
          {c.status !== 'done' && c.status !== 'dismissed' ? <Button variant="ghost" loading={busy} onClick={() => void act('Set aside', 'dismiss', {}, leave)}>Not a {CHECK_KIND_LABEL[c.kind].toLowerCase()}: set aside</Button> : null}
          {c.status === 'done' || c.status === 'dismissed' ? <Button variant="secondary" loading={busy} onClick={() => void act('Back on the list', 'reopen')}>Reopen</Button> : null}
        </div>
      ) : null}

      {usual && c.vendor ? (
        <Modal title={`A usual charge for ${c.vendor.name}`} submitLabel="Save and check again" busy={busy} onClose={() => setUsual(null)}
          onSubmit={async () => {
            if (!usual.what.trim()) { toast.error('Say what the charge is'); return }
            try {
              await addUsualCharge(c.vendor!.id, usual.what.trim(), usual.price.trim() ? Number(usual.price.replace(/[^0-9.]/g, '')) : null, usual.per)
              setUsual(null)
              await act('Saved; Claude checks it again', 'recheck', {}, () => void checkNow())
            } catch (err) {
              toast.error(errorMessage(err))
            }
          }}>
          <p className="mb-3 text-sm text-stone-600">At this price it won't be flagged on {c.vendor.name}'s confirmations and invoices again. Change it on the vendor's <strong>Edit</strong> page.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Charge" htmlFor="uc-what" className="sm:col-span-3"><Input id="uc-what" value={usual.what} onChange={(e) => setUsual({ ...usual, what: e.target.value })} placeholder="Tags" autoFocus /></FormField>
            <FormField label="Price" htmlFor="uc-price"><Input id="uc-price" value={usual.price} onChange={(e) => setUsual({ ...usual, price: e.target.value })} placeholder="0.15" inputMode="decimal" /></FormField>
            <FormField label="Per" htmlFor="uc-per"><Input id="uc-per" value={usual.per} onChange={(e) => setUsual({ ...usual, per: e.target.value })} placeholder="each" /></FormField>
          </div>
        </Modal>
      ) : null}
      {composing ? (
        <ComposeDialog
          draft={{ to: c.draft_to, subject: finalEmail ? `Our final order${c.doc_number ? ` for your confirmation ${c.doc_number}` : ''}${(c.order?.po_number ?? c.po_number) ? ` / PO ${c.order?.po_number ?? c.po_number}` : ''}` : c.draft_subject ?? `${CHECK_KIND_LABEL[c.kind]} ${c.doc_number ?? ''}${c.po_number ? ` / PO ${c.po_number}` : ''}`.trim(), body: finalEmail ?? c.draft_body ?? '', thread_id: c.email?.thread_id ?? null, reply_to_email_id: c.email?.id ?? null, vendor_id: c.vendor?.id ?? null, note: 'Edit anything before sending. Your signature is added when it sends.' }}
          onClose={() => setComposing(false)}
          onSent={(threadId) => {
            setComposing(false)
            // the final order as sent becomes the order's lines, so the invoice is checked against it
            void (async () => {
              if (final?.items.length) {
                try { await saveFinalOrder(c.id, final.items) } catch (err) { toast.error(`Sent, but the order lines were not saved: ${errorMessage(err)}`) }
              }
              await act(final ? 'Final order sent; the order now has these lines' : 'Sent, and marked done', 'sent', { thread: threadId }, leave)
            })()
          }}
        />
      ) : null}
      {viewer}
    </div>
  )
}

/**
 * A box of documents. On the "Compared with" side it also links to our order in VMS: an order typed in an email has no
 * file, its lines are the order (Dana, Oct 15: "I can't click on anything to see the comparison").
 */
function DocCard({ title, docs, onOpen, order }: { title: string; docs: { id: string; label: string; file_name: string | null; storage_path: string | null; mime_type: string | null; url: string | null }[]; onOpen: (d: (typeof docs)[number]) => void; order?: { id: string } | null }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      {order ? (
        <Link to={`${ROUTES.orders}/${order.id}`} className="mt-2 flex items-center gap-2 text-sm font-medium text-stone-900 hover:text-brand">
          <FileText className="size-4 shrink-0 text-stone-400" aria-hidden="true" />Our order in VMS (what we ordered, line by line)
        </Link>
      ) : null}
      {docs.length ? (
        <ul className="mt-2 space-y-1">
          {docs.map((d) => (
            <li key={d.id}><button type="button" onClick={() => onOpen(d)} className="flex items-center gap-2 text-left text-sm font-medium text-stone-900 hover:text-brand"><FileText className="size-4 shrink-0 text-stone-400" aria-hidden="true" />{d.file_name ?? d.label}</button></li>
          ))}
        </ul>
      ) : order ? null : <p className="mt-2 text-sm text-stone-500">No document; compared with the order record.</p>}
    </div>
  )
}

/** "Which order is this for?": the vendor's orders, newest first. */
function PickOrder({ c, canEdit, busy, onPick }: { c: OrderCheckRow; canEdit: boolean; busy: boolean; onPick: (orderId: string) => void }) {
  const { organization } = useAuth()
  const orders = useSupabaseQuery(async () => (organization && c.vendor ? listOrders(organization.id, { vendorId: c.vendor.id, limit: 60 }) : []), [organization?.id, c.vendor?.id])
  // Claude's best guess is picked in advance (Dana, Oct 14): one click on Use this order
  const [pick, setPick] = useState(c.suggested_order_id ?? '')
  return (
    <Alert variant="warning" className="mb-4">
      <p>{c.status === 'needs_order'
        ? <>No order found for this {CHECK_KIND_LABEL[c.kind].toLowerCase()}{c.po_number ? ` (it says PO ${c.po_number})` : ''}, and no sales report to compare it with. Pick the order:</>
        : <>No order in VMS for this {CHECK_KIND_LABEL[c.kind].toLowerCase()}, so Claude compared it with the sales report. If there is an order, pick it:</>}</p>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 max-w-md text-sm" aria-label="Order">
            <option value="">{orders.isLoading ? 'Loading orders…' : c.vendor ? 'Choose an order' : 'File the vendor first'}</option>
            {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{[o.order_date ? new Date(`${o.order_date}T12:00:00`).toLocaleDateString() : 'No date', o.po_number ? `PO ${o.po_number}` : null, o.est_cost !== null ? formatCurrency(o.est_cost) : null, o.description?.slice(0, 40), o.id === c.suggested_order_id ? "(Claude's best guess)" : null].filter(Boolean).join(' · ')}</option>)}
          </Select>
          <Button size="sm" disabled={!pick} loading={busy} onClick={() => onPick(pick)}>Use this order</Button>
        </div>
      ) : null}
    </Alert>
  )
}
