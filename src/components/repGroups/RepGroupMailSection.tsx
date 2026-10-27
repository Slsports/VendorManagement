import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listRepGroupThreads } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { FoldSection } from '@/components/shared/FoldSection'
import { Badge } from '@/components/ui'

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const STATUS: Record<string, string> = { waiting_on_us: 'Waiting on us', waiting_on_vendor: 'Waiting on them', handled: 'Handled' }

/**
 * Every conversation with this rep group's people, in one place (Dana, Oct 27): their mail to us and ours to them,
 * newest first, each with the vendors it was filed to. A rep who reps several companies writes about one or two of
 * them; the conversation opens here and also shows under those vendors.
 */
export function RepGroupMailSection({ organizationId, repGroupId }: { organizationId: string; repGroupId: string }) {
  const q = useSupabaseQuery(() => listRepGroupThreads(organizationId, repGroupId), [organizationId, repGroupId])
  const rows = q.data ?? []
  const summary = q.isLoading ? null : rows.length ? `${rows.length} conversation${rows.length === 1 ? '' : 's'}` : 'None'
  return (
    <FoldSection title="Mail" summary={summary} className="mb-6">
      {q.error ? <p className="text-sm text-red-700">{q.error}</p> : rows.length === 0 ? <p className="text-sm text-stone-500">No conversations with this rep group yet.</p> : (
        <ul className="divide-y divide-stone-100 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <Link to={`${ROUTES.mail}/${t.id}`} className="font-medium text-stone-900 hover:text-brand">{t.subject || '(no subject)'}</Link>
                <span className="block text-xs text-stone-500">
                  {when(t.last_message_at)} · {t.message_count} email{t.message_count === 1 ? '' : 's'}
                  {t.tagged.length ? <> · filed to {t.tagged.map((v, i) => <span key={v.id}>{i ? ', ' : ''}<Link to={`${ROUTES.vendors}/${v.id}`} className="text-brand hover:underline">{v.name}</Link></span>)}</> : <> · <span className="text-amber-700">not filed to a vendor yet</span></>}
                </span>
              </span>
              <Badge tone={t.status === 'waiting_on_us' ? 'warning' : 'neutral'}>{STATUS[t.status] ?? t.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </FoldSection>
  )
}
