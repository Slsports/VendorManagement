import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ListTodo, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useViewAs } from '@/hooks/useViewAs'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { listTasks } from '@/services/tasks'
import { dueState, todayLocal } from '@/lib/tasks'
import { ROUTES } from '@/lib/constants'
import { CountCard } from '@/components/dashboard/CountCard'
import { TaskDialog } from './TaskDialog'
import { TaskList } from './TaskList'

/** Dashboard (Dana, Oct 11): how many tasks are on my list, red when one is late; + adds one right there. */
export function TasksCard() {
  const { organization, profile } = useAuth()
  const { personId, isMe, personName } = useViewAs()
  const who = personId ?? null
  const q = useTasksQuery(async () => (organization && profile ? listTasks(organization.id, who ? 'mine' : 'all', who) : []), [organization?.id, profile?.id, who])
  const [adding, setAdding] = useState(false)
  const rows = q.data ?? []
  const today = todayLocal()
  const late = rows.filter((t) => dueState(t.due_date, today) === 'late').length
  const title = isMe ? 'My tasks' : who ? `${personName?.split(' ')[0] ?? 'Their'}'s tasks` : 'Everyone’s tasks'
  return (
    <>
      <CountCard id="tasks" title={<span className="flex items-center gap-2"><ListTodo className="size-4 text-brand" aria-hidden="true" /> {title}{late ? <span className="font-normal text-red-700">{late} late</span> : null}</span>}
        count={rows.length} loading={q.isLoading} error={q.error} alert={late > 0}
        action={<button type="button" onClick={() => setAdding(true)} aria-label="Add a task" title="Add a task" className="rounded-full p-1.5 text-brand hover:bg-brand/10"><Plus className="size-5" aria-hidden="true" /></button>}>
        <TaskList tasks={rows.slice(0, 15)} showWho={!isMe || !who} empty="Nothing on the list. Use + to add a task." />
        <Link to={ROUTES.tasks} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">{rows.length > 15 ? `All ${rows.length} on the Tasks page` : 'Open the Tasks page'}</Link>
      </CountCard>
      {adding ? <TaskDialog onClose={() => setAdding(false)} /> : null}
    </>
  )
}
