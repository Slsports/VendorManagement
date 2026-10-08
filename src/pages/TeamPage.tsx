import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { teamOverview, type TeamRow } from '@/services/reviews'
import { LATE_MS, waited } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Spinner } from '@/components/ui'

/**
 * Admins keep tabs while the staff learns (Dana, Oct 8): one row per person with what waits on them and
 * for how long. Each number opens that list in the person's view (the "Showing" switch follows).
 */
export default function TeamPage() {
  const { organization, role } = useAuth()
  const { setChoice } = useViewAs()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (organization && role === 'admin' ? teamOverview(organization.id) : []), [organization?.id, role])
  const [now] = useState(() => Date.now())
  if (role !== 'admin') return <Alert variant="error">The Team page is for admins.</Alert>

  const late = (since: string | null) => !!since && now - new Date(since).getTime() > LATE_MS
  const open = (r: TeamRow, to: string) => { setChoice(r.profile_id); navigate(to) }
  const Cell = ({ r, n, since, to, label }: { r: TeamRow; n: number; since?: string | null; to: string; label: string }) => (
    <td className="px-3 py-2">
      {n ? (
        <button type="button" onClick={() => open(r, to)} aria-label={`${label}: ${n} for ${r.full_name}`}
          className={cn('rounded-lg px-2 py-1 text-left hover:bg-stone-100', late(since ?? null) ? 'font-semibold text-red-700' : 'text-stone-900')}>
          <span className="text-base">{n}</span>
          {since ? <span className="block text-xs font-normal">{late(since) ? 'oldest ' : ''}{waited(since)}</span> : null}
        </button>
      ) : <span className="px-2 text-stone-300">0</span>}
    </td>
  )

  return (
    <div>
      <PageHeader title="Team" description="What waits on each person. Red: something has waited more than 3 days. Click a number to see that list in their view." />
      {q.error ? <Alert variant="error">{q.error}</Alert> : null}
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div> : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Needs an answer</th>
                <th className="px-3 py-2">No answer yet</th>
                <th className="px-3 py-2">Review items</th>
                <th className="px-3 py-2">Working on</th>
                <th className="px-3 py-2">Vendors</th>
                <th className="px-3 py-2">Last email sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(q.data ?? []).map((r) => (
                <tr key={r.profile_id} className="align-top">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => open(r, ROUTES.dashboard)} className="flex items-center gap-2 font-medium text-stone-900 hover:text-brand">
                      <Users className="size-4 text-stone-400" aria-hidden="true" />{r.full_name}
                    </button>
                    <span className="ml-6 text-xs capitalize text-stone-500">{r.role}</span>
                  </td>
                  <Cell r={r} n={r.needs} since={r.needs_oldest} to={`${ROUTES.mail}?status=needs`} label="Needs an answer" />
                  <Cell r={r} n={r.no_answer} since={r.no_answer_oldest} to={`${ROUTES.mail}?status=no_answer`} label="No answer yet" />
                  <Cell r={r} n={r.reviews} since={r.reviews_oldest} to={ROUTES.review} label="Review items" />
                  <td className="px-3 py-2">
                    {r.working ? (
                      <button type="button" onClick={() => open(r, ROUTES.workingOrders)} className="rounded-lg px-2 py-1 text-left hover:bg-stone-100">
                        <span className="text-base text-stone-900">{r.working}</span>
                        {r.working_needs ? <span className="block text-xs text-amber-700">{r.working_needs} need an answer</span> : null}
                      </button>
                    ) : <span className="px-2 text-stone-300">0</span>}
                  </td>
                  <Cell r={r} n={r.vendors} to={ROUTES.vendors} label="Vendors" />
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{r.last_sent ? `${waited(r.last_sent)} ago` : <span className="text-stone-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-stone-500">“Last email sent” counts mail sent from VMS. Use the Showing switch at the top to go back to your own view.</p>
    </div>
  )
}
