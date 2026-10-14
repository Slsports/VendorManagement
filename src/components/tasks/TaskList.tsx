import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Circle, CircleCheck, Repeat } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { completeTask, reopenTask, type TaskRow } from '@/services/tasks'
import { aboutText, dateText, dueState, dueText, repeatLabel, todayLocal } from '@/lib/tasks'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { FormField, Textarea } from '@/components/ui'
import { TaskDialog } from './TaskDialog'
import { useGoToTask } from '@/hooks/useGoToTask'

const repeatOf = (t: TaskRow) => repeatLabel({ every: t.repeat_every, unit: t.repeat_unit, days: t.repeat_days, until: t.repeat_until })

/** The round check: finish a task (a note for whoever gave it, when someone else did), or reopen a finished one. */
export function DoneButton({ task }: { task: TaskRow }) {
  const { profile } = useAuth()
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const done = !!task.done_at
  const giver = task.created_by && task.created_by !== profile?.id ? task.giver?.full_name.split(' ')[0] ?? 'them' : null

  async function finish(withNote?: string) {
    setBusy(true)
    try {
      const next = await completeTask(task.id, withNote)
      if (next) toast.success(`Done. It repeats: the next one is ready.`)
      else toast((t) => (
        <span className="text-sm">Done. <button type="button" className="ml-1 font-medium text-brand hover:underline" onClick={() => { toast.dismiss(t.id); void reopenTask(task.id) }}>Undo</button></span>
      ))
      setAsking(false)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function reopen() {
    try { await reopenTask(task.id) } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => (done ? void reopen() : giver ? setAsking(true) : void finish())}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`} title={done ? 'Reopen' : 'Mark done'}
        className={cn('shrink-0 rounded-full p-0.5', done ? 'text-emerald-600 hover:text-stone-500' : 'text-stone-400 hover:text-emerald-600')}>
        {done ? <CircleCheck className="size-5" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
      </button>
      {asking ? (
        <Modal title="Mark it done" submitLabel="Done" busy={busy} onSubmit={() => finish(note)} onClose={() => setAsking(false)}>
          <p className="text-stone-700">{task.title}</p>
          <FormField label={`Note for ${giver} (optional)`} htmlFor={`done-note-${task.id}`} hint={`${giver} is told it's done.`}>
            <Textarea id={`done-note-${task.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </FormField>
        </Modal>
      ) : null}
    </>
  )
}

/** Tasks as a short list: check, what, when, who, about. Click a task to go to its work (Dana, Oct 14); Edit changes it. */
export function TaskList({ tasks, showWho = true, empty = 'Nothing to do.' }: { tasks: TaskRow[]; showWho?: boolean; empty?: string }) {
  const { profile } = useAuth()
  const [open, setOpen] = useState<TaskRow | null>(null)
  const go = useGoToTask()
  const today = todayLocal()
  if (!tasks.length) return <p className="text-sm text-stone-500">{empty}</p>
  return (
    <>
      <ul className="divide-y divide-stone-100 text-sm">
        {tasks.map((t) => {
          const state = dueState(t.due_date, today)
          const about = aboutText(t)
          const who = t.assigned_to !== profile?.id ? t.assignee?.full_name.split(' ')[0] : t.created_by && t.created_by !== profile?.id ? `from ${t.giver?.full_name.split(' ')[0] ?? '?'}` : null
          return (
            <li key={t.id} className="flex items-start gap-2 py-2">
              <DoneButton task={t} />
              <button type="button" onClick={() => (t.done_at ? setOpen(t) : go(t, setOpen))} className="min-w-0 flex-1 text-left hover:text-brand">
                <span className={cn('block font-medium', t.done_at ? 'text-stone-500 line-through' : 'text-stone-900')}>{t.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                  {t.done_at ? <span>done {dateText(t.done_at.slice(0, 10))}</span> : (
                    <span className={cn(state === 'late' && 'font-semibold text-red-700', state === 'today' && 'font-semibold text-amber-700')}>{dueText(t.due_date, today)}</span>
                  )}
                  {showWho && who ? <span>{who}</span> : null}
                  {about ? <span className="truncate">{about}</span> : null}
                  {repeatOf(t) ? <span className="inline-flex items-center gap-0.5" title={repeatOf(t)!}><Repeat className="size-3" aria-hidden="true" /><span className="sr-only">{repeatOf(t)}</span></span> : null}
                </span>
              </button>
              <button type="button" onClick={() => setOpen(t)} className="shrink-0 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900" aria-label={`Edit ${t.title}`}>Edit</button>
            </li>
          )
        })}
      </ul>
      {open ? <TaskDialog task={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

/** Links to what a task is about, for the task page. */
export function AboutLinks({ task }: { task: TaskRow }) {
  const links = [
    task.vendor ? { to: `${ROUTES.vendors}/${task.vendor.id}`, label: task.vendor.name } : null,
    task.order ? { to: `${ROUTES.orders}/${task.order.id}`, label: task.order.po_number ? `PO ${task.order.po_number}` : task.order.description || 'Order' } : null,
    task.thread ? { to: `${ROUTES.mail}/${task.thread.id}`, label: `Email: ${task.thread.subject || '(no subject)'}` } : null,
    task.rep_group ? { to: `${ROUTES.repGroups}/${task.rep_group.id}`, label: task.rep_group.name } : null,
    task.carrier ? { to: `${ROUTES.freight}?carrier=${task.carrier.id}`, label: task.carrier.name } : null,
  ].filter((x): x is { to: string; label: string } => !!x)
  if (!links.length && !task.tag_other) return <span className="text-stone-400">—</span>
  return (
    <span className="flex flex-wrap gap-x-2">
      {links.map((l) => <Link key={l.to} to={l.to} className="text-brand hover:underline">{l.label}</Link>)}
      {task.tag_other ? <span>{task.tag_other}</span> : null}
    </span>
  )
}
