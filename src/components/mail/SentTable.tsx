import { useNavigate } from 'react-router-dom'
import { Paperclip } from 'lucide-react'
import { useTableSort } from '@/hooks/useTableSort'
import type { SentRow } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { SortHeader } from '@/components/shared/SortHeader'

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Sent mail (Dana, Oct 12): one row per email we sent, newest first; click to open the conversation. */
export function SentTable({ rows, showVendor = true, sortParam = 'sent_sort' }: { rows: SentRow[]; showVendor?: boolean; sortParam?: string }) {
  const navigate = useNavigate()
  const { sorted, sort, toggle } = useTableSort(rows, {
    to: (r) => r.to_emails[0] ?? '', vendor: (r) => r.vendor_name, subject: (r) => r.subject, sent: (r) => r.sent_at, by: (r) => r.sent_by_name,
  }, { param: sortParam, descFirst: ['sent'] })
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <SortHeader label="To" sortKey="to" sort={sort} onSort={toggle} className="px-3 py-2" />
            {showVendor ? <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2" /> : null}
            <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Sent" sortKey="sent" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="By" sortKey="by" sort={sort} onSort={toggle} className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((r) => (
            <tr key={r.id} onClick={() => navigate(`${ROUTES.mail}/${r.thread_id}`)} className="cursor-pointer align-top hover:bg-stone-50">
              <td className="max-w-56 px-3 py-2 text-stone-800">
                <span className="block truncate">{r.to_emails.join(', ') || '—'}</span>
                {r.cc_emails.length ? <span className="block truncate text-xs text-stone-500">cc {r.cc_emails.join(', ')}</span> : null}
              </td>
              {showVendor ? <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.vendor_name ?? ''}</td> : null}
              <td className="min-w-56 px-3 py-2">
                <a href={`${ROUTES.mail}/${r.thread_id}`} onClick={(e) => { e.preventDefault(); navigate(`${ROUTES.mail}/${r.thread_id}`) }} className="font-medium text-stone-900 hover:text-brand">
                  {r.subject || '(no subject)'}{r.has_attachments ? <Paperclip className="ml-1 inline size-3.5 text-stone-400" aria-label="Has attachments" /> : null}
                </a>
                {r.snippet ? <span className="block truncate text-xs text-stone-500">{r.snippet}</span> : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-600">{when(r.sent_at)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-600">{r.sent_by_name?.split(' ')[0] ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
