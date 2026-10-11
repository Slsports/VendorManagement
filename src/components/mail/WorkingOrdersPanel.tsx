import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { listWorkingOrders } from '@/services/mail'
import { senderLabel, workingStatus } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { CountCard } from '@/components/dashboard/CountCard'

/** Dashboard card: the orders being worked on (Dana, Oct 8), how many, and how many need an answer. */
export function WorkingOrdersPanel() {
  const { organization } = useAuth()
  const { personId, isMe, personName } = useViewAs()
  const q = useSupabaseQuery(async () => (organization ? listWorkingOrders(organization.id, personId) : []), [organization?.id, personId])
  const rows = q.data ?? []
  const needs = rows.filter((t) => workingStatus(t) === 'needs').length
  const whose = isMe ? "I'm" : personId ? `${personName?.split(' ')[0] ?? 'They'} is` : 'everyone is'
  return (
    <CountCard title={`Orders ${whose} working on`} count={rows.length} loading={q.isLoading} error={q.error}>
      <Link to={ROUTES.workingOrders} className="text-sm font-medium text-brand hover:underline">Open the list</Link>
      {rows.length === 0 ? <p className="mt-2 text-sm text-stone-600">None yet. Flag a conversation with "Working on order" while an order goes back and forth.</p> : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {rows.slice(0, 8).map((t) => (
            <li key={t.id}>
              <Link to={`${ROUTES.mail}/${t.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand">
                <span className="min-w-0 truncate"><span className="font-medium text-stone-900">{t.vendor?.name ?? senderLabel(t.last)}</span> · {t.subject || '(no subject)'}</span>
                {workingStatus(t) === 'needs' ? <span className="shrink-0 text-xs font-semibold text-amber-700">needs an answer</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {needs ? <p className="mt-1 text-xs text-amber-700">{needs} need{needs === 1 ? 's' : ''} an answer</p> : null}
    </CountCard>
  )
}
