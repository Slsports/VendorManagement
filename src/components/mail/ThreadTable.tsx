import { Link } from 'react-router-dom'
import { Paperclip } from 'lucide-react'
import { useTableSort } from '@/hooks/useTableSort'
import { threadState } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import type { ThreadRow } from '@/services/mail'
import { SortHeader } from '@/components/shared/SortHeader'
import { ThreadStatusBadge } from './ThreadStatusBadge'

const STATE_ORDER = { needs: 0, no_answer: 1, waiting: 2, handled: 3 }

/** Mail threads as a sortable table: who, what, vendor, owner, where it stands, when. */
export function ThreadTable({ rows, showVendor = true, sortParam }: { rows: ThreadRow[]; showVendor?: boolean; sortParam?: string }) {
  const { sorted, sort, toggle } = useTableSort(rows, {
    from: (t) => t.last?.from_name || t.last?.from_email,
    subject: (t) => t.subject,
    vendor: (t) => t.vendor?.name,
    owner: (t) => t.owner?.full_name,
    status: (t) => STATE_ORDER[threadState(t)],
    when: (t) => t.last_message_at,
  }, { param: sortParam, descFirst: ['when'] })

  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <SortHeader label="From" sortKey="from" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={toggle} className="px-3 py-2" />
            {showVendor ? <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" /> : null}
            <SortHeader label="Owner" sortKey="owner" sort={sort} onSort={toggle} className="hidden px-3 py-2 lg:table-cell" />
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Last" sortKey="when" sort={sort} onSort={toggle} className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((t) => (
            <tr key={t.id} className="align-top hover:bg-stone-50">
              <td className="max-w-[12rem] px-3 py-2">
                <span className="block truncate font-medium text-stone-900">{t.last?.direction === 'out' ? 'We wrote last' : t.last?.from_name || t.last?.from_email || '—'}</span>
                {t.message_count > 1 ? <span className="text-xs text-stone-500">{t.message_count} messages</span> : null}
              </td>
              <td className="max-w-md px-3 py-2">
                <Link to={`${ROUTES.mail}/${t.id}`} className="font-medium text-stone-900 hover:text-brand">{t.subject || '(no subject)'}</Link>
                {t.last?.has_attachments ? <Paperclip className="ml-1 inline size-3.5 text-stone-400" aria-label="Has attachments" /> : null}
                {t.last?.snippet ? <span className="block truncate text-xs text-stone-500">{t.last.snippet}</span> : null}
              </td>
              {showVendor ? (
                <td className="hidden px-3 py-2 md:table-cell">
                  {t.vendor ? <Link to={`${ROUTES.vendors}/${t.vendor.id}`} className="text-stone-700 hover:text-brand">{t.vendor.name}</Link> : <span className="text-xs text-stone-400">Not filed</span>}
                </td>
              ) : null}
              <td className="hidden whitespace-nowrap px-3 py-2 text-stone-600 lg:table-cell">{t.owner?.full_name ?? <span className="text-xs text-stone-400">Nobody</span>}</td>
              <td className="whitespace-nowrap px-3 py-2"><ThreadStatusBadge thread={t} /></td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-600">{t.last_message_at ? new Date(t.last_message_at).toLocaleDateString() : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
