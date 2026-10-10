import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, Hammer, RotateCcw, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { listWorkingOrders, setWorkingOrder, type WorkingRow } from '@/services/mail'
import { senderLabel, waited, workingStatus, WORKING_STATUS_LABELS } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

const ORDER = { needs: 0, working: 1, waiting: 2, completed: 3 } as const

/**
 * Every conversation flagged "Working on order" (Dana, Oct 8), with where it stands: Needs an answer,
 * Working, Waiting on rep, Completed. Completing one offers to add the order from that email.
 */
export default function WorkingOrdersPage() {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const { personId, isMe, personName } = useViewAs()
  const [showDone, setShowDone] = useState(false)
  const q = useSupabaseQuery(async () => (organization ? listWorkingOrders(organization.id, personId, showDone) : []), [organization?.id, personId, showDone])
  const rows = [...(q.data ?? [])].sort((a, b) => ORDER[workingStatus(a)] - ORDER[workingStatus(b)] || (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
  const [busy, setBusy] = useState<string | null>(null)

  async function act(t: WorkingRow, action: 'working' | 'complete' | 'reopen' | 'unflag') {
    setBusy(t.id)
    try {
      await setWorkingOrder(t.id, action)
      if (action === 'complete') {
        toast((tt) => (
          <span className="flex flex-wrap items-center gap-3 text-sm">
            Completed.
            <Link to={`${ROUTES.mail}/${t.id}?addOrder=1`} onClick={() => toast.dismiss(tt.id)} className="font-semibold text-brand hover:underline">Add order from this email</Link>
          </span>
        ), { duration: 8000 })
      } else toast.success(action === 'working' ? 'Set to Working' : action === 'reopen' ? 'Back in progress' : 'No longer flagged')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const title = isMe ? "Orders I'm working on" : personId ? `Orders ${personName ?? 'they'} is working on` : 'Orders everyone is working on'
  return (
    <div className="mx-auto max-w-5xl">
      <BackLink fallback={ROUTES.dashboard} fallbackLabel="Dashboard" />
      <PageHeader title={title} description="Conversations flagged “Working on order”. The status follows the mail: the rep wrote last → Needs an answer; we wrote last → Waiting on rep." />
      <label className="mb-4 flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-4 rounded border-stone-300" /> Show completed
      </label>
      {q.error ? <Alert variant="error">{q.error}</Alert> : null}
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div> : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 px-6 py-12 text-center text-sm text-stone-600">Nothing here. Open a conversation with a vendor and click “Working on order”.</p>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {rows.map((t) => {
            const st = workingStatus(t)
            const s = WORKING_STATUS_LABELS[st]
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <span className="font-medium text-stone-900">{t.vendor?.name ?? senderLabel(t.last)}</span>
                    {!isMe && t.working_person ? <span className="text-xs text-stone-500">· {t.working_person.full_name}</span> : null}
                  </div>
                  <Link to={`${ROUTES.mail}/${t.id}`} className="mt-0.5 block truncate text-sm text-stone-800 hover:text-brand">{t.subject || '(no subject)'}</Link>
                  <p className="truncate text-xs text-stone-500">
                    {t.last?.direction === 'out' ? 'We wrote last' : t.last?.from_name || t.last?.from_email}{t.last_message_at ? ` · ${waited(t.last_message_at)} ago` : ''}{t.last?.snippet ? ` · ${t.last.snippet}` : ''}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {st === 'completed' ? (
                      <Button size="sm" variant="ghost" loading={busy === t.id} onClick={() => void act(t, 'reopen')} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>Reopen</Button>
                    ) : (
                      <>
                        {st !== 'working' ? <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void act(t, 'working')} leftIcon={<Hammer className="size-4" aria-hidden="true" />}>Working</Button> : null}
                        <Button size="sm" variant="secondary" loading={busy === t.id} onClick={() => void act(t, 'complete')} leftIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}>Completed</Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void act(t, 'unflag')} aria-label="Stop tracking" title="Stop tracking"><X className="size-4" aria-hidden="true" /></Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
