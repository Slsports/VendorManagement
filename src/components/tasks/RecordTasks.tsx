import { useState } from 'react'
import { ListTodo, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { listTasksAbout } from '@/services/tasks'
import { Button } from '@/components/ui'
import { TaskDialog, type TaskPreset } from './TaskDialog'
import { TaskList } from './TaskList'
import { FoldSection } from '@/components/shared/FoldSection'

/**
 * "+ Task" on a vendor, order or email page, with the open tasks already about it. Without the button (the email
 * page has its own in the action bar) it shows only when there are tasks.
 */
export function RecordTasks({ preset, className, button = true, fold = false }: { preset: TaskPreset; className?: string; button?: boolean; fold?: boolean }) {
  const { organization } = useAuth()
  const about = { vendor_id: preset.order || preset.thread ? null : preset.vendor?.id, order_id: preset.order?.id, thread_id: preset.thread?.id }
  const key = about.thread_id ?? about.order_id ?? about.vendor_id ?? null
  const q = useTasksQuery(async () => (organization && key ? listTasksAbout(organization.id, about) : []), [organization?.id, key])
  const [adding, setAdding] = useState(false)
  const rows = q.data ?? []
  if (!button && !rows.length) return null
  const add = button ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Task</Button> : null
  const dialog = adding ? <TaskDialog preset={preset} onClose={() => setAdding(false)} /> : null
  // on the vendor page it starts closed with the count (Dana, Oct 12)
  if (fold) return (
    <>
      <FoldSection title="Tasks" summary={q.isLoading ? null : rows.length ? `${rows.length} open` : 'None'} actions={add} className={className}>
        {rows.length ? <TaskList tasks={rows} /> : <p className="text-sm text-stone-500">No open tasks.</p>}
      </FoldSection>
      {dialog}
    </>
  )
  return (
    <section aria-label="Tasks" className={className}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><ListTodo className="size-4 text-brand" aria-hidden="true" /> Tasks{rows.length ? ` (${rows.length})` : ''}</h2>
        {add}
      </div>
      {rows.length ? <div className="mt-1"><TaskList tasks={rows} /></div> : null}
      {dialog}
    </section>
  )
}
