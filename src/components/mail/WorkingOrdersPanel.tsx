import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { listWorkingOrders } from '@/services/mail'
import { workingStatus } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'

/** Dashboard card: the orders being worked on (Dana, Oct 8), how many, and how many need an answer. */
export function WorkingOrdersPanel() {
  const { organization } = useAuth()
  const { personId, isMe, personName } = useViewAs()
  const q = useSupabaseQuery(async () => (organization ? listWorkingOrders(organization.id, personId) : []), [organization?.id, personId])
  const rows = q.data ?? []
  const needs = rows.filter((t) => workingStatus(t) === 'needs').length
  const whose = isMe ? "I'm" : personId ? `${personName?.split(' ')[0] ?? 'They'} is` : 'everyone is'
  return (
    <Link to={ROUTES.workingOrders} className="block rounded-2xl border border-stone-200 bg-white p-5 shadow-sm hover:border-brand">
      <h2 className="text-sm font-semibold text-stone-900">Orders {whose} working on</h2>
      <div className="mt-4 flex items-start gap-3 rounded-xl bg-stone-50 p-4">
        <ClipboardList className={needs ? 'mt-0.5 size-5 shrink-0 text-amber-500' : 'mt-0.5 size-5 shrink-0 text-stone-400'} aria-hidden="true" />
        <p className="text-sm text-stone-600">
          {q.isLoading ? 'Checking…' : q.error ? q.error : rows.length
            ? <><span className="text-2xl font-semibold text-stone-900">{rows.length}</span> in progress{needs ? <>, <span className="font-semibold text-amber-700">{needs} need{needs === 1 ? 's' : ''} an answer</span></> : null}.</>
            : 'None yet. Flag a conversation with "Working on order" while an order goes back and forth.'}
        </p>
      </div>
    </Link>
  )
}
