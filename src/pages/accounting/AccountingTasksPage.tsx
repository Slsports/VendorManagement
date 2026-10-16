import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { listAccountingTasks } from '@/services/tasks'
import { ROUTES } from '@/lib/constants'
import { todayLocal } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { TaskList } from '@/components/tasks/TaskList'
import { TaskDialog } from '@/components/tasks/TaskDialog'
import { Alert, Button, Spinner } from '@/components/ui'

/** Accounting tasks (Dana, Oct 16): the bookkeeping to-dos, each with its procedure. Only people with the tick see them. */
export default function AccountingTasksPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'done' ? 'done' : 'open'
  const [adding, setAdding] = useState(false)
  const q = useTasksQuery(async () => (organization ? listAccountingTasks(organization.id, { view }) : []), [organization?.id, view])
  const rows = q.data ?? []
  const today = todayLocal()
  const late = rows.filter((t) => !t.done_at && t.due_date && t.due_date < today)

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Accounting tasks" description="Renewals, filings, payments and follow-ups. Click a task to go to its work; its procedure opens from the task."
        actions={<Button onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add task</Button>} />
      {adding ? <TaskDialog area="accounting" onClose={() => setAdding(false)} /> : null}
      <nav aria-label="Task view" className="mb-4">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {[{ v: 'open', label: 'Open' }, { v: 'done', label: 'Done' }].map((t) => (
            <li key={t.v}>
              <button type="button" onClick={() => { const next = new URLSearchParams(params); if (t.v === 'open') next.delete('view'); else next.set('view', t.v); setParams(next, { replace: true }) }}
                aria-current={view === t.v ? 'page' : undefined}
                className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', view === t.v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {view === 'open' && late.length ? <Alert variant="warning" className="mb-4">{late.length} overdue.</Alert> : null}
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : (
          <div className="rounded-2xl border border-stone-200 bg-white px-4 py-2">
            <TaskList tasks={rows} showWho={false} empty={view === 'done' ? 'Nothing finished yet.' : 'Nothing on the list. Renewals and proof-of-insurance sends appear here on their own.'} />
          </div>
        )}
    </div>
  )
}
