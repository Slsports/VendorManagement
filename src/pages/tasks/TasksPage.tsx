import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Repeat, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useViewAs } from '@/hooks/useViewAs'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { deleteTask, getTask, listTasks, saveReminderSettings, type TaskRow, type TaskView } from '@/services/tasks'
import { aboutText, dateText, dueState, dueText, remindText, repeatLabel, todayLocal } from '@/lib/tasks'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Button, Input, Spinner } from '@/components/ui'
import { TaskDialog } from '@/components/tasks/TaskDialog'
import { AboutLinks, DoneButton } from '@/components/tasks/TaskList'

const first = (name: string | null | undefined) => name?.split(' ')[0] ?? ''

/**
 * Tasks (Dana, Oct 11): to-dos with a due date, a reminder, who it is for and what it is about. Each person sees the
 * tasks assigned to them and the ones they gave; Dana switches to anyone's with "Showing", or sees everyone's.
 */
export default function TasksPage() {
  const { organization, profile } = useAuth()
  const { personId, isMe, personName } = useViewAs()
  const [params, setParams] = useSearchParams()
  const everyone = !personId
  const view: TaskView = (['mine', 'given', 'done'] as const).find((v) => v === params.get('view')) ?? 'mine'
  const listView: TaskView = everyone && view !== 'done' ? 'all' : view
  const q = useTasksQuery(async () => (organization ? listTasks(organization.id, listView, personId) : []), [organization?.id, listView, personId])
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<TaskRow | null>(null)
  const today = todayLocal()

  // ?task=<id> (the link in a reminder email) opens that task
  const linked = params.get('task')
  useEffect(() => {
    if (!linked) return
    let gone = false
    void getTask(linked).then((t) => { if (!gone && t) setOpen(t) }).catch(() => undefined)
    return () => { gone = true }
  }, [linked])

  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    task: (t) => t.title,
    due: (t) => t.due_date,
    remind: (t) => t.remind_at,
    who: (t) => t.assignee?.full_name,
    from: (t) => t.giver?.full_name,
    about: (t) => aboutText(t),
    done: (t) => t.done_at,
  }, { descFirst: ['done'] })

  function setView(v: TaskView) {
    const next = new URLSearchParams(params)
    if (v === 'mine') next.delete('view')
    else next.set('view', v)
    setParams(next, { replace: true })
  }
  async function remove(t: TaskRow) {
    if (!window.confirm(`Delete the task "${t.title}"?`)) return
    try { await deleteTask(t.id); toast.success('Task deleted') } catch (e) { toast.error(errorMessage(e)) }
  }

  const whose = isMe ? 'My' : everyone ? 'Everyone’s' : `${first(personName)}’s`
  const tabs: { v: TaskView; label: string }[] = [
    { v: 'mine', label: everyone ? 'Open' : `${whose} tasks` },
    ...(everyone ? [] : [{ v: 'given' as const, label: isMe ? 'Given to others' : `Given by ${first(personName)}` }]),
    { v: 'done', label: 'Done' },
  ]

  return (
    <div>
      <PageHeader title="Tasks" description="To-dos with a due date and a reminder. Tag them to a vendor, order, email or freight company."
        actions={<Button onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>New task</Button>} />
      <nav aria-label="Which tasks" className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {tabs.map((t) => (
            <li key={t.v}><button type="button" onClick={() => setView(t.v)} aria-current={view === t.v ? 'page' : undefined}
              className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', view === t.v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{t.label}</button></li>
          ))}
        </ul>
      </nav>

      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading tasks…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">
            {view === 'done' ? 'Nothing finished yet.' : view === 'given' ? 'No open tasks given to others.' : 'Nothing on the list.'}
            {view !== 'done' ? <> <button type="button" onClick={() => setAdding(true)} className="font-medium text-brand hover:underline">Add a task</button></> : null}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="w-8 px-3 py-2"><span className="sr-only">Done</span></th>
                  <SortHeader label="Task" sortKey="task" sort={sort} onSort={toggle} className="px-3 py-2" />
                  {view === 'done' ? <SortHeader label="Done" sortKey="done" sort={sort} onSort={toggle} className="px-3 py-2" /> : <SortHeader label="Due" sortKey="due" sort={sort} onSort={toggle} className="px-3 py-2" />}
                  {view !== 'done' ? <SortHeader label="Remind" sortKey="remind" sort={sort} onSort={toggle} className="px-3 py-2" /> : null}
                  <SortHeader label="Assigned to" sortKey="who" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="From" sortKey="from" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <SortHeader label="About" sortKey="about" sort={sort} onSort={toggle} className="px-3 py-2" />
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Delete</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((t) => {
                  const state = dueState(t.due_date, today)
                  const rep = repeatLabel({ every: t.repeat_every, unit: t.repeat_unit, days: t.repeat_days, until: t.repeat_until })
                  return (
                    <tr key={t.id} className="align-top hover:bg-stone-50">
                      <td className="px-3 py-2"><DoneButton task={t} /></td>
                      <td className="min-w-48 px-3 py-2">
                        <button type="button" onClick={() => setOpen(t)} className={cn('text-left font-medium hover:text-brand', t.done_at ? 'text-stone-500 line-through' : 'text-stone-900')}>{t.title}</button>
                        {rep ? <span className="mt-0.5 flex items-center gap-1 text-xs text-stone-500"><Repeat className="size-3" aria-hidden="true" />{rep}</span> : null}
                        {t.done_note ? <span className="mt-0.5 block text-xs text-stone-500">Note: {t.done_note}</span> : null}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2', !t.done_at && state === 'late' ? 'font-semibold text-red-700' : !t.done_at && state === 'today' ? 'font-semibold text-amber-700' : 'text-stone-600')}>
                        {t.done_at ? `${dateText(t.done_at.slice(0, 10))}${t.finisher ? ` · ${first(t.finisher.full_name)}` : ''}` : dueText(t.due_date, today)}
                      </td>
                      {view !== 'done' ? <td className="whitespace-nowrap px-3 py-2 text-stone-600">{t.remind_at ? remindText(t.remind_at) : ''}{t.remind_error ? <span className="block text-xs text-red-700" title={t.remind_error}>not all sent</span> : null}</td> : null}
                      <td className="whitespace-nowrap px-3 py-2 text-stone-700">{t.assigned_to === profile?.id ? 'Me' : first(t.assignee?.full_name)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-600">{!t.created_by || t.created_by === t.assigned_to ? '' : t.created_by === profile?.id ? 'Me' : first(t.giver?.full_name)}</td>
                      <td className="px-3 py-2 text-stone-700"><AboutLinks task={t} /></td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => void remove(t)} aria-label={`Delete ${t.title}`} title="Delete" className="rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-700"><Trash2 className="size-4" aria-hidden="true" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      {isMe ? <ReminderSettings /> : null}
      {adding ? <TaskDialog onClose={() => setAdding(false)} /> : null}
      {open ? <TaskDialog task={open} onClose={() => { setOpen(null); if (linked) { const next = new URLSearchParams(params); next.delete('task'); setParams(next, { replace: true }) } }} /> : null}
      <p className="mt-6 text-xs text-stone-500">Tasks also show on the <Link to={ROUTES.dashboard} className="text-brand hover:underline">dashboard</Link>.</p>
    </div>
  )
}

/** How I get reminders (Dana, Oct 11): dashboard, email and/or text, any mix; dashboard + email to start. */
function ReminderSettings() {
  const { profile, refreshProfile } = useAuth()
  const [dash, setDash] = useState(profile?.remind_dashboard ?? true)
  const [email, setEmail] = useState(profile?.remind_email ?? true)
  const [text, setText] = useState(profile?.remind_text ?? false)
  const [phone, setPhone] = useState(profile?.mobile_phone ?? '')
  const [busy, setBusy] = useState(false)
  if (!profile) return null
  const changed = dash !== profile.remind_dashboard || email !== profile.remind_email || text !== profile.remind_text || (phone.trim() || null) !== profile.mobile_phone
  async function save() {
    if (text && phone.replace(/\D/g, '').length < 10) { toast.error('Add your cell number for texts'); return }
    setBusy(true)
    try {
      await saveReminderSettings(profile!.id, { remind_dashboard: dash, remind_email: email, remind_text: text, mobile_phone: phone.trim() || null })
      await refreshProfile()
      toast.success('Reminder settings saved')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const box = 'size-4 accent-brand'
  return (
    <section aria-labelledby="remind-settings" className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 id="remind-settings" className="text-sm font-semibold text-stone-900">How I get reminders</h2>
      <p className="mt-0.5 text-xs text-stone-500">Pick one, two or all three. Also used to tell you when someone finishes a task you gave them.</p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-800">
        <label className="flex items-center gap-2"><input type="checkbox" className={box} checked={dash} onChange={(e) => setDash(e.target.checked)} /> On my dashboard</label>
        <label className="flex items-center gap-2"><input type="checkbox" className={box} checked={email} onChange={(e) => setEmail(e.target.checked)} /> By email <span className="text-xs text-stone-500">({profile.email})</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" className={box} checked={text} onChange={(e) => setText(e.target.checked)} /> By text</label>
      </div>
      {text ? (
        <div className="mt-3 max-w-xs">
          <label htmlFor="remind-phone" className="block text-sm font-medium text-stone-800">Cell number</label>
          <Input id="remind-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="559-555-1234" className="mt-1" />
        </div>
      ) : null}
      <Button size="sm" className="mt-3" disabled={!changed} loading={busy} onClick={() => void save()}>Save</Button>
    </section>
  )
}
