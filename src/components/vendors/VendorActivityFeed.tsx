import { useState } from 'react'
import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { vendorActivityFeed } from '@/services/vendorActivity'
import { downloadVendorFile } from '@/services/lines'
import type { FeedItem } from '@/lib/vendorActivity'
import { shortDate } from '@/lib/utils'
import { Button } from '@/components/ui'

const FIRST = 12
const MORE = 30

/**
 * Activity feed (Dana, Nov 3), upper right of every vendor page under Tasks: everything done with this vendor, newest
 * first, a date and one line each (who wrote and about what, the invoice for which PO, the order received or entered to
 * LS and by whom). Each line opens what happened: the email, the file, the order, the task.
 */
export function VendorActivityFeed({ organizationId, vendorId, onNote }: { organizationId: string; vendorId: string; onNote?: () => void }) {
  const [limit, setLimit] = useState(FIRST)
  const q = useSupabaseQuery(() => vendorActivityFeed(organizationId, vendorId, limit), [organizationId, vendorId, limit])
  const { view, viewer } = useDocumentViewer()
  const rows = q.data ?? []

  function line(r: FeedItem) {
    const body = (
      <>
        <span className="mr-2 font-medium tabular-nums text-stone-900">{shortDate(r.at)}</span>
        <span className="text-stone-700 group-hover:text-brand group-hover:underline">{r.text}</span>
      </>
    )
    if (r.doc?.storage_path) {
      const d = r.doc
      return <button type="button" className="group min-w-0 flex-1 text-left" onClick={() => view({ name: d.file_name ?? d.label, mime: d.mime_type, load: () => downloadVendorFile(d.storage_path!) })}>{body}</button>
    }
    if (r.kind === 'note' && onNote) return <button type="button" className="group min-w-0 flex-1 text-left" onClick={onNote}>{body}</button>
    if (r.to) return <Link to={r.to} className="group min-w-0 flex-1">{body}</Link>
    return <span className="min-w-0 flex-1">{body}</span>
  }

  return (
    <section aria-label="Activity feed" className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        <History className="size-4 text-brand" aria-hidden="true" /> Activity feed
      </h2>
      {q.error ? <p className="mt-2 text-sm text-red-700">Could not load the activity.</p>
        : q.isLoading && !rows.length ? <p className="mt-2 text-sm text-stone-500">Loading…</p>
          : !rows.length ? <p className="mt-2 text-sm text-stone-500">Nothing yet. Emails, papers, orders and tasks for this vendor show here.</p>
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
