import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { listCreditRequests } from '@/services/creditRequests'
import { ROUTES } from '@/lib/constants'
import { Badge } from '@/components/ui'

const money = (n: number | null) => (n == null ? '' : ` · $${Number(n).toFixed(2)}`)
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString() : '')

/**
 * The credits we asked this vendor for (Dana, Oct 27): who asked, when, for what, and where each stands (waiting on the
 * vendor, Received, On Edenred), with the email one click away. Open ones first.
 */
export function CreditRequestsInFolder({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listCreditRequests(vendorId), [vendorId])
  useLiveTable('credit_requests', `vendor_id=eq.${vendorId}`, () => { void q.refetch() })
  const rows = (q.data ?? []).filter((r) => r.status !== 'closed')
  if (!rows.length) return null
  const open = rows.filter((r) => r.status === 'open')
  const rest = rows.filter((r) => r.status !== 'open').slice(0, 10)
  return (
    <div className="mt-3 rounded-lg bg-amber-50/60 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Credits we asked for</p>
      <ul className="mt-1 space-y-1 text-sm">
        {[...open, ...rest].map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 text-stone-800">
            <span>{day(r.requested_on)} · {r.requester?.full_name?.split(' ')[0] ?? 'Someone'} asked: {r.what}{r.invoice_number ? ` (invoice ${r.invoice_number})` : ''}{money(r.amount)}</span>
            {r.status === 'open' ? <Badge tone="warning">Waiting on the vendor</Badge> : null}
            {r.status === 'received' ? <Badge tone="success">Received {day(r.received_on)}</Badge> : null}
            {r.status === 'on_edenred' ? <Badge tone="info">On Edenred {day(r.on_edenred_on)}</Badge> : null}
            {r.email?.thread_id ? <Link to={`${ROUTES.mail}/${r.email.thread_id}`} className="inline-flex items-center gap-0.5 text-brand hover:underline"><Mail className="inline size-3" aria-hidden="true" />the email</Link> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
