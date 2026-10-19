import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { listBillcomDue, listBillcomWaiting } from '@/services/billcom'
import { ROUTES } from '@/lib/constants'
import { money } from '@/lib/freight'
import { CountCard } from './CountCard'

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

/**
 * Bill.com on the dashboard (Dana, Oct 19; only for people who see Accounting): bills due within 7 days (or overdue)
 * from Bill.com, and invoices VMS sent to Bill.com's inbox that are not bills there yet. Each line opens Bill.com.
 */
export function BillcomCard() {
  const { organization, role } = useAuth()
  const due = useSupabaseQuery(async () => (organization ? listBillcomDue(organization.id, 7) : []), [organization?.id])
  const waiting = useSupabaseQuery(async () => (organization ? listBillcomWaiting(organization.id) : []), [organization?.id])
  useLiveTable('billcom_bills', null, () => { void due.refetch(); void waiting.refetch() })
  useLiveTable('billcom_forwards', null, () => { void waiting.refetch() })
  const bills = due.data ?? []
  const total = bills.reduce((s, b) => s + Number(b.due_amount ?? b.amount ?? 0), 0)
  const url = organization?.billcom_url || 'https://app.bill.com'
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  return (
    <CountCard title="Bill.com" count={due.data ? bills.length : null} loading={due.isLoading} error={due.error ?? waiting.error ?? undefined}>
      <p className="text-sm text-stone-600">{bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'} due within 7 days, ${money(total)}.` : 'Nothing due within 7 days.'}</p>
      {bills.length ? (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {bills.slice(0, 6).map((b) => (
            <li key={b.bill_id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate"><span className="font-medium text-stone-900">{b.vendor_name ?? 'Vendor'}</span>{b.invoice_number ? <span className="text-stone-500"> · {b.invoice_number}</span> : null}</span>
              <span className={`shrink-0 text-xs ${b.due_date && b.due_date < today ? 'font-semibold text-red-700' : 'text-stone-600'}`}>{money(Number(b.due_amount ?? b.amount ?? 0))} · {b.due_date && b.due_date < today ? 'overdue ' : ''}{day(b.due_date)}</span>
            </li>
          ))}
          {bills.length > 6 ? <li className="py-1 text-xs text-stone-500">and {bills.length - 6} more in Bill.com</li> : null}
        </ul>
      ) : null}
      <p className="mt-3 text-sm text-stone-600">{waiting.data?.length ? `${waiting.data.length} sent to Bill.com's inbox, not entered yet:` : 'Nothing sent to Bill.com is waiting to be entered.'}</p>
      {waiting.data?.length ? (
        <ul className="mt-1 divide-y divide-stone-100 text-sm">
          {waiting.data.slice(0, 5).map((w) => (
            <li key={w.email_id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{w.thread_id ? <Link to={`${ROUTES.mail}/${w.thread_id}`} className="font-medium text-stone-900 hover:text-brand">{w.vendor_name ?? 'Vendor'}</Link> : <span className="font-medium text-stone-900">{w.vendor_name ?? 'Vendor'}</span>}{w.file_name ? <span className="text-stone-500"> · {w.file_name}</span> : null}</span>
              <span className="shrink-0 text-xs text-stone-500">{w.doc_total != null ? `${money(Number(w.doc_total))} · ` : ''}sent {new Date(w.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Open Bill.com<ExternalLink className="size-3.5" aria-hidden="true" /></a>
        {role === 'admin' ? <Link to={ROUTES.billcomSettings} className="text-stone-500 hover:text-brand hover:underline">Settings</Link> : null}
      </div>
    </CountCard>
  )
}
