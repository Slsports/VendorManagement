import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorActivity } from '@/services/mail'
import { shortDate } from '@/lib/utils'

/**
 * Recent Activity (Dana, Oct 20): the vendor's last 5 emails, newest first, each a date and one sentence Claude wrote;
 * a line opens that email. One not read yet shows its subject until its sentence is ready.
 */
export function VendorRecentActivity({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listVendorActivity(vendorId, 5), [vendorId])
  const rows = q.data ?? []
  if (q.isLoading || q.error || !rows.length) return null
  return (
    <section aria-label="Recent activity" className="mb-6 rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
        <History className="size-4 text-brand" aria-hidden="true" /> Recent activity
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.email_id} className="flex gap-2">
            <span aria-hidden="true" className="text-stone-400">•</span>
            <Link to={`/mail/${r.thread_id}?email=${r.email_id}`} className="group min-w-0 flex-1">
              <span className="mr-2 font-medium tabular-nums text-stone-900">{shortDate(r.received_at)}</span>
              {r.line
                ? <span className="text-stone-700 group-hover:text-brand group-hover:underline">{r.line}</span>
                : <span className="text-stone-500 group-hover:text-brand group-hover:underline">{r.direction === 'in' ? `${r.from_name || r.from_email || 'They'} wrote` : 'We wrote'}: {r.subject || '(no subject)'}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
