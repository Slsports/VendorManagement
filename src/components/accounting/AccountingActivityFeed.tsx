import { useState } from 'react'
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { contactActivityFeed, policyActivityFeed, type AccountingFeedItem } from '@/services/accountingActivity'
import { downloadDocument } from '@/services/accountingDocuments'
import { shortDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui'

const FIRST = 12
const MORE = 30

/**
 * Activity feed on a policy or an accounting company page (Dana, Nov 13: "if vms closes it … I will still be able to see
 * whats happening in the activity feed"): emails in and out, papers filed, tasks made and closed and why, premiums and
 * autopays, newest first, each line opening what happened. Dated by when the thing happened, never by when VMS caught up.
 */
export function AccountingActivityFeed({ organizationId, policyId, contactId, className }: { organizationId: string; policyId?: string; contactId?: string; className?: string }) {
  const [limit, setLimit] = useState(FIRST)
  const q = useSupabaseQuery(() => (policyId ? policyActivityFeed(policyId, limit) : contactId ? contactActivityFeed(organizationId, contactId, limit) : Promise.resolve([])), [organizationId, policyId, contactId, limit])
  const { view, viewer } = useDocumentViewer()
  const rows = q.data ?? []

  function line(r: AccountingFeedItem) {
    const body = (
      <>
        <span className="mr-2 font-medium tabular-nums text-stone-900">{shortDate(r.at)}</span>
        <span className="text-stone-700 group-hover:text-brand group-hover:underline">{r.text}</span>
      </>
    )
    if (r.doc) {
      const d = r.doc
      return <button type="button" className="group min-w-0 flex-1 text-left" onClick={() => view({ name: d.file_name, mime: d.mime_type, load: () => downloadDocument(d.storage_path) })}>{body}</button>
    }
    if (r.to) return <Link to={r.to} className="group min-w-0 flex-1">{body}</Link>
    return <span className="min-w-0 flex-1">{body}</span>
  }

  return (
    <section aria-label="Activity feed" className={cn('rounded-2xl border border-stone-200 bg-white px-5 py-4', className)}>
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        <History className="size-4 text-brand" aria-hidden="true" /> Activity feed
      </h2>
      {q.error ? <p className="mt-2 text-sm text-red-700">Could not load the activity.</p>
        : q.isLoading && !rows.length ? <p className="mt-2 text-sm text-stone-500">Loading…</p>
          : !rows.length ? <p className="mt-2 text-sm text-stone-500">Nothing yet. Emails, papers, payments and tasks show here as they happen.</p>
            : (
              <ul className="mt-2 max-h-[32rem] space-y-1.5 overflow-y-auto pr-1 text-sm">
                {rows.map((r) => (
                  <li key={r.key} className="flex gap-2">
                    <span aria-hidden="true" className="text-stone-400">•</span>
                    {line(r)}
                  </li>
                ))}
              </ul>
            )}
      {rows.length >= limit ? <Button size="sm" variant="ghost" className="mt-2" loading={q.isLoading} onClick={() => setLimit(limit + MORE)}>Show more</Button> : null}
      {viewer}
    </section>
  )
}
