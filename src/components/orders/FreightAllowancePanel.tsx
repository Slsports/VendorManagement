import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeDollarSign } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { freightAllowancesDue } from '@/services/wwd'
import { allowanceState } from '@/lib/wwdAllowance'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'

/** Dashboard (Dana, Oct 9): unpaid orders whose vendor credits the freight if paid by a date, soonest first. */
export function FreightAllowancePanel() {
  const { organization } = useAuth()
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const q = useSupabaseQuery(async () => (organization ? freightAllowancesDue(organization.id) : []), [organization?.id])
  const rows = q.data ?? []
  if (!rows.length) return null
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><BadgeDollarSign className="size-4 text-amber-500" aria-hidden="true" /> Pay on time for the freight back</h2>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {rows.slice(0, 6).map((o) => {
          const s = allowanceState({ freight_allowance_pay_by: o.freight_allowance_pay_by, freight_allowance_received: null, paid_date: null }, today)
          return (
            <li key={o.id}>
              <Link to={`${ROUTES.orders}/${o.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand">
                <span className="min-w-0 truncate">{o.vendor?.name ?? 'Order'} <span className="text-stone-500">· {o.freight_allowance !== null ? `${money(o.freight_allowance)} back` : 'freight back'}</span></span>
                <span className={`shrink-0 text-xs ${s.tone === 'danger' ? 'font-semibold text-red-700' : s.tone === 'warning' ? 'text-amber-700' : 'text-stone-500'}`}>{o.freight_allowance_pay_by ? `pay by ${shortDate(o.freight_allowance_pay_by)}` : 'no date'}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      {rows.length > 6 ? <p className="mt-1 text-xs text-stone-500">and {rows.length - 6} more</p> : null}
    </div>
  )
}
