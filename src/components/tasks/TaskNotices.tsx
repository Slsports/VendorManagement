import { useState } from 'react'
import toast from 'react-hot-toast'
import { AlarmClock, BellRing, CircleCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { finishedSeen, listNotices, reminderSeen, snoozeTask, type TaskRow } from '@/services/tasks'
import { aboutText, dueText, todayLocal } from '@/lib/tasks'
import { isFuture, snoozeChoicesNow, snoozeText } from '@/lib/snooze'
import { errorMessage } from '@/lib/utils'
import { Button, Dropdown } from '@/components/ui'
import { DoneButton } from './TaskList'
import { TaskDialog } from './TaskDialog'
import { useGoToTask } from '@/hooks/useGoToTask'

/**
 * Top of the dashboard (Dana, Oct 11): reminders whose time has come, for people who get reminders on the dashboard,
 * and tasks you gave that someone finished. Each stays until you deal with it.
 */
export function TaskNotices() {
  const { organization, profile } = useAuth()
  const q = useTasksQuery(async () => (organization && profile ? listNotices(organization.id, profile.id) : null), [organization?.id, profile?.id])
  const [open, setOpen] = useState<TaskRow | null>(null)
  const go = useGoToTask()
  const reminders = profile?.remind_dashboard === false ? [] : q.data?.reminders ?? []
  const finished = q.data?.finished ?? []
  if (!reminders.length && !finished.length) return null
  const today = todayLocal()
  const act = (fn: () => Promise<void>) => fn().catch((e) => toast.error(errorMessage(e)))
  return (
    <section aria-label="Reminders" className="mb-4 space-y-2">
      {reminders.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <BellRing className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <DoneButton task={t} />
          <button type="button" onClick={() => go(t, setOpen)} className="min-w-0 flex-1 text-left hover:text-brand">
            <span className="font-medium text-stone-900">{t.title}</span>
            <span className="ml-2 text-xs text-stone-600">{t.due_date ? `due ${dueText(t.due_date, today).toLowerCase()}` : ''}{aboutText(t) ? ` · ${aboutText(t)}` : ''}</span>
          </button>
          <TaskSnooze task={t} />
          <Button size="sm" variant="ghost" onClick={() => void act(() => reminderSeen(t.id))}>Dismiss</Button>
        </div>
      ))}
      {finished.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
          <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-stone-800">
            <span className="font-medium">{t.finisher?.full_name.split(' ')[0] ?? 'Someone'}</span> finished <span className="font-medium">{t.title}</span>
            {t.done_note ? <span className="text-stone-600"> — {t.done_note}</span> : null}
          </p>
          <Button size="sm" variant="ghost" onClick={() => void act(() => finishedSeen(t.id))}>OK</Button>
        </div>
      ))}
      {open ? <TaskDialog task={open} onClose={() => setOpen(null)} /> : null}
    </section>
  )
}

/** Remind me again later. */
function TaskSnooze({ task }: { task: TaskRow }) {
  const [custom, setCustom] = useState('')
  async function apply(when: Date, close: () => void) {
    close()
    try {
      await snoozeTask(task.id, when)
      toast.success(`I'll remind you ${snoozeText(when)}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dropdown label="Remind me later" align="right" trigger={(t) => (
      <Button size="sm" variant="ghost" onClick={t.toggle} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-haspopup leftIcon={<AlarmClock className="size-4" aria-hidden="true" />}>Later</Button>
    )}>
      {(close) => (
        <div className="w-64 text-sm">
          {snoozeChoicesNow().map((c) => (
            <button key={c.label} type="button" onClick={() => void apply(c.until, close)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-stone-100">
              <span>{c.label}</span><span className="text-xs text-stone-500">{snoozeText(c.until)}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-stone-100 px-3 py-2">
            <label className="block text-xs font-medium text-stone-500">Pick a date and time
              <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-stone-300 px-2 text-sm" />
            </label>
            <Button size="sm" className="mt-2 w-full" disabled={!isFuture(custom)} onClick={() => void apply(new Date(custom), close)}>Remind me then</Button>
          </div>
        </div>
      )}
    </Dropdown>
  )
}
