import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileText, Send, Sparkles, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { deleteDraft, getDraft, listDrafts, sendEmail, type DraftRow } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { ROUTES } from '@/lib/constants'
import { SortHeader } from '@/components/shared/SortHeader'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Alert, Button, Spinner } from '@/components/ui'

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Mail › Drafts (Dana, Oct 12): emails saved before sending, by you or prepared by Claude for you to look over. Click one
 * to finish it and send it; sending removes it from Drafts (and from Gmail Drafts when it had a copy there).
 */
export function DraftsList() {
  const { organization, profile } = useAuth()
  const q = useSupabaseQuery(async () => (organization && profile ? listDrafts(organization.id, profile.id) : []), [organization?.id, profile?.id])
  const [open, setOpen] = useState<DraftRow | null>(null)
  // ?draft=<id> (a task's "Open the email to send", Dana Oct 23): that draft opens right away
  const [params, setParams] = useSearchParams()
  const linked = params.get('draft')
  useEffect(() => {
    if (!linked) return
    let gone = false
    void getDraft(linked).then((d) => {
      if (gone) return
      if (d) setOpen(d)
      else toast('That email was already sent or deleted. Look in Sent.')
      const next = new URLSearchParams(params)
      next.delete('draft')
      setParams(next, { replace: true })
    }).catch((e) => toast.error(errorMessage(e)))
    return () => { gone = true }
  }, [linked, params, setParams])
  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    to: (r) => r.to_emails[0] ?? '', subject: (r) => r.subject, vendor: (r) => r.vendor?.name, updated: (r) => r.updated_at,
  }, { param: 'draft_sort', descFirst: ['updated'] })

  const [sending, setSending] = useState<string | null>(null)
  // emails prepared in bulk (Oct 13): routing letters and contact confirmations, each sent all at once
  const groups = [
    { key: 'routing', label: 'routing letter', rows: rows.filter((d) => d.routing_send_id), note: 'with the letter attached' },
    { key: 'confirm', label: 'contact confirmation', rows: rows.filter((d) => d.confirmation_id), note: 'each with its form link' },
  ].filter((g) => g.rows.length)

  /** Send every email of a group, one at a time, a few seconds apart (Dana looks a few over first). */
  async function sendAll(g: (typeof groups)[number]) {
    const list = g.rows
    if (!window.confirm(`Send ${list.length} ${g.label} email${list.length === 1 ? '' : 's'} now? Each goes from orders@, ${g.note}.`)) return
    setSending(g.key)
    const t = toast.loading(`Sending 0 of ${list.length}…`)
    let ok = 0
    const failed: string[] = []
    for (const d of list) {
      try {
        const res = await sendEmail({ to: d.to_emails, cc: d.cc_emails, subject: d.subject, body: d.body, vendor_id: d.vendor_id, draft_id: d.id, vendor_link_ids: d.vendor_link_ids, routing_send_id: d.routing_send_id, attach_routing_letter: !d.routing_send_id && d.attach_routing_letter, confirmation_id: d.confirmation_id, signature: d.signature ?? undefined })
        if (res.needs_choice) failed.push(d.to_emails.join(', '))
        else ok++
      } catch (e) {
        failed.push(`${d.to_emails.join(', ')} (${errorMessage(e)})`)
      }
      toast.loading(`Sending ${ok + failed.length} of ${list.length}…`, { id: t })
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (failed.length) toast.error(`${ok} sent; not sent: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}`, { id: t, duration: 10000 })
    else toast.success(`${ok} sent`, { id: t })
    setSending(null)
    await q.refetch()
  }

  async function remove(d: DraftRow) {
    if (!window.confirm(`Delete the draft "${d.subject || '(no subject)'}"?`)) return
    try { await deleteDraft(d.id); toast.success('Draft deleted'); await q.refetch() } catch (e) { toast.error(errorMessage(e)) }
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading drafts…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  return (
    <>
      {groups.map((g) => (
        <div key={g.key} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-white px-4 py-3">
          <p className="text-sm text-stone-700"><span className="font-semibold">{g.rows.length} {g.label} email{g.rows.length === 1 ? '' : 's'}</span> ready. Open a few to check them, then send them all.</p>
          <Button size="sm" loading={sending === g.key} disabled={!!sending} onClick={() => void sendAll(g)} leftIcon={<Send className="size-4" aria-hidden="true" />}>Send all {g.rows.length}</Button>
        </div>
      ))}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-12 text-center">
          <FileText className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">No drafts. Click <span className="font-medium">Save draft</span> while writing an email to keep it here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <SortHeader label="To" sortKey="to" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Saved" sortKey="updated" sort={sort} onSort={toggle} className="px-3 py-2" />
                <th scope="col" className="px-3 py-2"><span className="sr-only">Delete</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((d) => (
                <tr key={d.id} onClick={() => setOpen(d)} className="cursor-pointer align-top hover:bg-stone-50">
                  <td className="max-w-56 truncate px-3 py-2 text-stone-800">{d.to_emails.join(', ') || '—'}</td>
                  <td className="min-w-56 px-3 py-2">
                    <span className="font-medium text-stone-900">{d.subject || '(no subject)'}</span>
                    {!d.created_by ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700"><Sparkles className="size-3" aria-hidden="true" />Prepared by Claude</span> : null}
                    {d.note ? <span className="block text-xs text-stone-500">{d.note}</span> : null}
                    {/* what Claude prepared it from, one click (Dana, Oct 21): the email it came from, the order */}
                    {!d.created_by && (d.thread_id || d.order_id) ? (
                      <span className="flex flex-wrap gap-x-3 text-xs" onClick={(e) => e.stopPropagation()}>
                        {d.thread_id ? <Link to={`${ROUTES.mail}/${d.thread_id}`} className="text-brand hover:underline">The email it came from</Link> : null}
                        {d.order_id ? <Link to={`${ROUTES.orders}/${d.order_id}`} className="text-brand hover:underline">The order</Link> : null}
                      </span>
                    ) : null}
                    <span className="block truncate text-xs text-stone-500">{d.body.replace(/\s+/g, ' ').slice(0, 140)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{d.vendor?.name ?? ''}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{when(d.updated_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={(e) => { e.stopPropagation(); void remove(d) }} aria-label={`Delete draft ${d.subject}`} title="Delete" className="rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-700"><Trash2 className="size-4" aria-hidden="true" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? (
        <ComposeDialog
          draft={{ draft_id: open.id, order_id: open.order_id, vendor_link_ids: open.vendor_link_ids, to: open.to_emails, cc: open.cc_emails, subject: open.subject, body: open.body, thread_id: open.thread_id, reply_to_email_id: open.reply_to_email_id, forward_email_id: open.forward_email_id, vendor_id: open.vendor_id, mailbox_id: open.mailbox_id, note: open.note ?? undefined, signature: open.signature, routing_send_id: open.routing_send_id, confirmation_id: open.confirmation_id, attach_routing_letter: open.attach_routing_letter }}
          onClose={() => { setOpen(null); void q.refetch() }}
          onSent={() => void q.refetch()} />
      ) : null}
    </>
  )
}
