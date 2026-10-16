import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { listAccountingTasks, type TaskRow } from '@/services/tasks'
import { localDay } from '@/lib/tasks'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { TaskList } from '@/components/tasks/TaskList'
import { Alert, Button, Spinner } from '@/components/ui'

type View = 'week' | 'month' | 'year'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d: Date) => addDays(d, -d.getDay())
const iso = (d: Date) => localDay(d)

/** Week, month or year at a glance (Dana, Oct 16): every accounting task by its due date; click a day to see them. */
export default function AccountingCalendarPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = (['week', 'month', 'year'].find((v) => v === params.get('view')) ?? 'month') as View
  const [today] = useState(() => new Date())
  const anchor = params.get('date') ? new Date(`${params.get('date')}T00:00:00`) : today
  const [picked, setPicked] = useState<string | null>(null)

  // the range the view shows
  const range = view === 'week'
    ? { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) }
    : view === 'month'
      ? { from: startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), to: addDays(startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)), 6) }
      : { from: new Date(anchor.getFullYear(), 0, 1), to: new Date(anchor.getFullYear(), 11, 31) }
  const q = useTasksQuery(async () => (organization ? listAccountingTasks(organization.id, { view: 'range', from: iso(range.from), to: iso(range.to) }) : []), [organization?.id, iso(range.from), iso(range.to)])
  const byDay = new Map<string, TaskRow[]>()
  for (const t of q.data ?? []) if (t.due_date) byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t])

  function go(next: Date, nextView: View = view) {
    const p = new URLSearchParams(params)
    p.set('date', iso(next))
    if (nextView === 'month') p.delete('view'); else p.set('view', nextView)
    setParams(p, { replace: true })
    setPicked(null)
  }
  const step = (n: number) => go(view === 'week' ? addDays(anchor, 7 * n) : view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) : new Date(anchor.getFullYear() + n, 0, 1))
  const title = view === 'week' ? `Week of ${range.from.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
    : view === 'month' ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}` : String(anchor.getFullYear())
  const pickedTasks = picked ? byDay.get(picked) ?? [] : []

  const Day = ({ day, compact = false }: { day: Date; compact?: boolean }) => {
    const key = iso(day)
    const tasks = byDay.get(key) ?? []
    const isToday = key === iso(today)
    const inMonth = view !== 'month' || day.getMonth() === anchor.getMonth()
    const late = tasks.some((t) => !t.done_at && key < iso(today))
    return (
      <button type="button" onClick={() => setPicked(key)} aria-label={`${day.toLocaleDateString()}: ${tasks.length} task(s)`}
        className={cn('flex min-h-16 flex-col rounded-lg border p-1 text-left text-xs', compact && 'min-h-8 items-center justify-center p-0.5',
          picked === key ? 'border-brand bg-brand-soft' : 'border-stone-200 bg-white hover:bg-stone-50', !inMonth && 'opacity-40')}>
        <span className={cn('font-medium', isToday ? 'rounded-full bg-brand px-1.5 text-white' : 'text-stone-700')}>{day.getDate()}</span>
        {compact ? (tasks.length ? <span className={cn('mt-0.5 size-1.5 rounded-full', late ? 'bg-red-600' : 'bg-brand')} /> : null) : (
          <span className="mt-1 space-y-0.5">
            {tasks.slice(0, 3).map((t) => <span key={t.id} className={cn('block truncate', t.done_at ? 'text-stone-400 line-through' : late ? 'text-red-700' : 'text-stone-800')}>{t.title}</span>)}
            {tasks.length > 3 ? <span className="block text-stone-500">+{tasks.length - 3} more</span> : null}
          </span>
        )}
      </button>
    )
  }

  const days: Date[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d)

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Accounting calendar" description="Renewals, filings, payments and follow-ups by the day they are due. Click a day to see its tasks." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Calendar view" className="flex rounded-xl border border-stone-200 bg-white p-1">
          {(['week', 'month', 'year'] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => go(anchor, v)}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold capitalize', view === v ? 'bg-brand text-white shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{v}</button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => step(-1)} aria-label="Earlier"><ChevronLeft className="size-4" aria-hidden="true" /></Button>
        <span className="min-w-48 text-center text-sm font-semibold text-stone-900">{title}</span>
        <Button size="sm" variant="secondary" onClick={() => step(1)} aria-label="Later"><ChevronRight className="size-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" onClick={() => go(today)}>Today</Button>
        {q.isLoading ? <Spinner label="Loading…" className="text-brand" /> : null}
      </div>
      {q.error ? <Alert variant="error">{q.error}</Alert> : null}
      {view === 'year' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MONTHS.map((m, mi) => {
            const first = new Date(anchor.getFullYear(), mi, 1)
            const start = startOfWeek(first)
            const cells: Date[] = []
            for (let i = 0; i < 42; i++) cells.push(addDays(start, i))
            const count = (q.data ?? []).filter((t) => t.due_date?.startsWith(`${anchor.getFullYear()}-${String(mi + 1).padStart(2, '0')}`)).length
            return (
              <section key={m} className="rounded-2xl border border-stone-200 bg-white p-3">
                <button type="button" onClick={() => go(first, 'month')} className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-stone-900 hover:text-brand">
                  <span>{m}</span><span className="text-xs font-normal text-stone-500">{count ? `${count} task${count === 1 ? '' : 's'}` : ''}</span>
                </button>
                <div className="grid grid-cols-7 gap-0.5">
                  {DAYS.map((d) => <span key={d} className="text-center text-[10px] text-stone-400">{d[0]}</span>)}
                  {cells.map((d) => d.getMonth() === mi ? <Day key={iso(d)} day={d} compact /> : <span key={iso(d)} />)}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((d) => <span key={d} className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{d}</span>)}
          {days.map((d) => <Day key={iso(d)} day={d} />)}
        </div>
      )}
      {picked ? (
        <section className="mt-6 rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <h2 className="mb-1 text-sm font-semibold text-stone-900">{new Date(`${picked}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
          <TaskList tasks={pickedTasks} showWho={false} empty="Nothing due this day." />
        </section>
      ) : null}
    </div>
  )
}
