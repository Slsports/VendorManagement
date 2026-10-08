import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { freightForDashboard, listCarriers } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { FREIGHT_STATUS, money, shortDate } from '@/lib/freight'
import { Badge } from '@/components/ui'

/** Dashboard, for the carrier owner (Trevor) and anyone who also sees freight (Dana): bills to match and to pay. */
export function FreightForYouPanel() {
  const { organization, profile } = useAuth()
  const carriers = useSupabaseQuery(async () => (organization ? listCarriers(organization.id) : []), [organization?.id])
  const shown = !!profile && (profile.sees_freight || (carriers.data ?? []).some((c) => c.owner_id === profile.id))
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const q = useSupabaseQuery(async () => (organization && shown ? freightForDashboard(organization.id) : { toMatch: [], toPay: [] }), [organization?.id, shown])
  if (!shown) return null
  const toMatch = q.data?.toMatch ?? []
  const toPay = q.data?.toPay ?? []
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm lg:col-span-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Freight bills</h2>
        <Link to={ROUTES.freight} className="text-sm font-medium text-brand hover:underline">Open Freight bills</Link>
      </div>
      {q.isLoading ? <p className="mt-4 text-sm text-stone-500">Checking…</p> : q.error ? <p className="mt-4 text-sm text-red-700">{q.error}</p> : (
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">To match ({toMatch.length})</h3>
            {toMatch.length === 0 ? <p className="mt-2 text-sm text-stone-500">All matched.</p> : (
              <ul className="mt-1 divide-y divide-stone-100">
                {toMatch.slice(0, 6).map((b) => (
                  <li key={b.id}><Link to={`${ROUTES.freight}/${b.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-brand">
                    <span className="min-w-0 truncate">{b.carriers?.name ?? 'Carrier'}{b.invoice_number ? ` #${b.invoice_number}` : ''} <span className="text-stone-400">{shortDate(b.invoice_date)}</span></span>
                    <Badge tone={FREIGHT_STATUS[b.status].tone}>{FREIGHT_STATUS[b.status].label}</Badge>
                  </Link></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">To pay ({toPay.length})</h3>
            {toPay.length === 0 ? <p className="mt-2 flex items-center gap-2 text-sm text-stone-500"><Receipt className="size-4" aria-hidden="true" /> Nothing to pay.</p> : (
              <ul className="mt-1 divide-y divide-stone-100">
                {toPay.slice(0, 6).map((b) => (
                  <li key={b.id}><Link to={`${ROUTES.freight}/${b.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-brand">
                    <span className="min-w-0 truncate">{b.carriers?.name ?? 'Carrier'}{b.invoice_number ? ` #${b.invoice_number}` : ''}</span>
                    <span className="shrink-0 text-right">
                      <span className="font-medium text-stone-900">{money(b.total)}</span>
                      <span className={`ml-2 text-xs ${b.due_date && b.due_date < today ? 'font-semibold text-red-700' : 'text-stone-500'}`}>{b.due_date ? `due ${shortDate(b.due_date)}` : 'no due date'}</span>
                    </span>
                  </Link></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
