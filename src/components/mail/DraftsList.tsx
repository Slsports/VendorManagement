import { useState } from 'react'
import toast from 'react-hot-toast'
import { FileText, Sparkles, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { deleteDraft, listDrafts, type DraftRow } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { SortHeader } from '@/components/shared/SortHeader'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Alert, Spinner } from '@/components/ui'

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Mail › Drafts (Dana, Oct 12): emails saved before sending, by you or prepared by Claude for you to look over. Click one
 * to finish it and send it; sending removes it from Drafts (and from Gmail Drafts when it had a copy there).
 */
export function DraftsList() {
  const { organization, profile } = useAuth()
  const q = useSupabaseQuery(async () => (organization && profile ? listDrafts(organization.id, profile.id) : []), [organization?.id, profile?.id])
  const [open, setOpen] = useState<DraftRow | null>(null)
  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    to: (r) => r.to_emails[0] ?? '', subject: (r) => r.subject, vendor: (r) => r.vendor?.name, updated: (r) => r.updated_at,
  }, { param: 'draft_sort', descFirst: ['updated'] })

  async function remove(d: DraftRow) {
    if (!window.confirm(`Delete the draft "${d.subject || '(no subject)'}"?`)) return
    try { await deleteDraft(d.id); toast.success('Draft deleted'); await q.refetch() } catch (e) { toast.error(errorMessage(e)) }
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading drafts…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  return (
    <>
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
          draft={{ draft_id: open.id, to: open.to_emails, cc: open.cc_emails, subject: open.subject, body: open.body, thread_id: open.thread_id, reply_to_email_id: open.reply_to_email_id, forward_email_id: open.forward_email_id, vendor_id: open.vendor_id, mailbox_id: open.mailbox_id, note: open.note ?? undefined }}
          onClose={() => { setOpen(null); void q.refetch() }}
          onSent={() => void q.refetch()} />
      ) : null}
    </>
  )
}
