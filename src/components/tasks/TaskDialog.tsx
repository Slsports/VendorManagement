import { useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listPeople } from '@/services/reviews'
import { listCarriers } from '@/services/freight'
import { listRepGroups } from '@/services/vendors'
import { listOrders } from '@/services/orders'
import { createTask, updateTask, type TaskRow } from '@/services/tasks'
import { fromLocalInput, localDay, REPEAT_CHOICES, REPEAT_UNITS, repeatChoice, repeatFor, toLocalInput, todayLocal, WEEKDAYS, type RepeatChoice } from '@/lib/tasks'
import { errorMessage } from '@/lib/utils'
import type { RepeatUnit } from '@/types'
import { Modal } from '@/components/shared/Modal'
import { Link } from 'react-router-dom'
import { TaskGo } from './TaskGo'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { FormField, Input, Select, Textarea } from '@/components/ui'

interface Ref { id: string; name: string }
/** What a new task is about when it is added from a vendor, order or email page. */
export interface TaskPreset { vendor?: Ref | null; order?: Ref | null; thread?: Ref | null; carrier?: Ref | null; rep_group?: Ref | null }
type TagKind = 'vendor' | 'carrier' | 'rep_group' | 'order' | 'other'
const TAG_KINDS: { value: TagKind; label: string }[] = [
  { value: 'vendor', label: 'Vendor' },
  { value: 'carrier', label: 'Freight company' },
  { value: 'rep_group', label: 'Rep group' },
  { value: 'order', label: 'Order' },
  { value: 'other', label: 'Something else' },
]

const orderName = (o: { po_number: string | null; description: string | null; vendor?: { name: string } | null }) =>
  [o.vendor?.name, o.po_number ? `PO ${o.po_number}` : null, o.description].filter(Boolean).join(' · ') || 'Order'

/** Add or change a task (Dana, Oct 11): what, due, remind me, who, what it is about, repeat. */
export function TaskDialog({ task, preset, onClose, onSaved }: { task?: TaskRow | null; preset?: TaskPreset; onClose: () => void; onSaved?: () => void }) {
  const { organization, profile } = useAuth()
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [due, setDue] = useState(task?.due_date ?? '')
  const [remind, setRemind] = useState(toLocalInput(task?.remind_at ?? null))
  const [assignee, setAssignee] = useState(task?.assigned_to ?? profile?.id ?? '')
  const [vendor, setVendor] = useState<Ref | null>(task?.vendor ?? preset?.vendor ?? null)
  const [carrier, setCarrier] = useState<Ref | null>(task?.carrier ?? preset?.carrier ?? null)
  const [repGroup, setRepGroup] = useState<Ref | null>(task?.rep_group ?? preset?.rep_group ?? null)
  const [order, setOrder] = useState<Ref | null>(task?.order ? { id: task.order.id, name: orderName(task.order) } : preset?.order ?? null)
  const [thread, setThread] = useState<Ref | null>(task?.thread ? { id: task.thread.id, name: task.thread.subject || '(no subject)' } : preset?.thread ?? null)
  const [other, setOther] = useState(task?.tag_other ?? '')
  const [adding, setAdding] = useState<TagKind | ''>('')
  const saved = { every: task?.repeat_every ?? null, unit: task?.repeat_unit ?? null, days: task?.repeat_days ?? [], until: task?.repeat_until ?? null }
  const [choice, setChoice] = useState<RepeatChoice>(repeatChoice(saved))
  const [every, setEvery] = useState(String(saved.every ?? 2))
  const [unit, setUnit] = useState<RepeatUnit>(saved.unit ?? 'week')
  const [days, setDays] = useState<number[]>(saved.days)
  const [until, setUntil] = useState(saved.until ?? '')
  const [busy, setBusy] = useState(false)

  const org = organization?.id
  const people = useSupabaseQuery(async () => (org ? listPeople(org) : []), [org])
  const carriers = useSupabaseQuery(async () => (org && adding === 'carrier' ? listCarriers(org) : []), [org, adding])
  const groups = useSupabaseQuery(async () => (org && adding === 'rep_group' ? listRepGroups(org) : []), [org, adding])
  const orders = useSupabaseQuery(async () => (org && adding === 'order' ? listOrders(org, vendor ? { vendorId: vendor.id, limit: 200 } : { view: 'open', limit: 300 }) : []), [org, adding, vendor?.id])

  async function save() {
    if (!org || !profile) return
    if (!title.trim()) { toast.error('Say what needs doing'); return }
    const n = Math.round(Number(every))
    const repeat = choice === 'custom'
      ? { every: n >= 1 && n <= 365 ? n : null, unit, days: unit === 'week' ? days : [], until: until || null }
      : repeatFor(choice)
    if (choice === 'custom' && !repeat.every) { toast.error('Repeat every how many? (1 to 365)'); return }
    // a repeating task needs a date to count from: today when none is given
    const dueDate = due || (repeat.every ? localDay(new Date()) : null)
    const row = {
      title: title.trim(), notes: notes.trim() || null, due_date: dueDate, remind_at: fromLocalInput(remind), assigned_to: assignee || profile.id,
      vendor_id: vendor?.id ?? null, carrier_id: carrier?.id ?? null, rep_group_id: repGroup?.id ?? null, order_id: order?.id ?? null,
      thread_id: thread?.id ?? null, tag_other: other.trim() || null,
      repeat_every: repeat.every, repeat_unit: repeat.unit, repeat_days: repeat.days, repeat_until: repeat.until,
    }
    setBusy(true)
    try {
      if (task) await updateTask(task.id, row)
      else await createTask({ ...row, organization_id: org, created_by: profile.id })
      toast.success(task ? 'Task saved' : row.assigned_to === profile.id ? 'Task added' : `Task given to ${people.data?.find((p) => p.id === row.assigned_to)?.full_name.split(' ')[0] ?? 'them'}`)
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // each tag opens what it is (Dana, Oct 14)
  const chips: { label: string; clear: () => void; to?: string }[] = [
    ...(vendor ? [{ label: `Vendor: ${vendor.name}`, clear: () => setVendor(null), to: `/vendors/${vendor.id}` }] : []),
    ...(carrier ? [{ label: `Freight: ${carrier.name}`, clear: () => setCarrier(null), to: `/freight?carrier=${carrier.id}` }] : []),
    ...(repGroup ? [{ label: `Rep group: ${repGroup.name}`, clear: () => setRepGroup(null), to: `/rep-groups/${repGroup.id}` }] : []),
    ...(order ? [{ label: `Order: ${order.name}`, clear: () => setOrder(null), to: `/orders/${order.id}` }] : []),
    ...(thread ? [{ label: `Email: ${thread.name}`, clear: () => setThread(null), to: `/mail/${thread.id}` }] : []),
    ...(other.trim() && adding !== 'other' ? [{ label: other.trim(), clear: () => setOther('') }] : []),
  ]
  const morningOfDue = due ? `${due}T08:00` : ''

  return (
    <Modal title={task ? 'Task' : 'New task'} submitLabel={task ? 'Save' : 'Add task'} busy={busy} onSubmit={save} onClose={onClose}>
      {task && !task.done_at ? <TaskGo task={task} onGo={() => { onSaved?.(); onClose() }} /> : null}
      <FormField label="What needs doing" htmlFor="task-title">
        <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} maxLength={300} />
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Due" htmlFor="task-due">
          <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </FormField>
        <FormField label="Remind me" htmlFor="task-remind"
          action={morningOfDue && remind !== morningOfDue ? <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setRemind(morningOfDue)}>Due day, 8 AM</button> : null}>
          <Input id="task-remind" type="datetime-local" value={remind} onChange={(e) => setRemind(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Assigned to" htmlFor="task-who">
        <Select id="task-who" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.id === profile?.id ? `${p.full_name} (me)` : p.full_name}</option>)}
          {assignee && !people.data?.some((p) => p.id === assignee) ? <option value={assignee}>{task?.assignee?.full_name ?? 'Me'}</option> : null}
        </Select>
      </FormField>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-stone-800">About</p>
        {chips.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <li key={c.label} className="inline-flex max-w-full items-center gap-1 rounded-full bg-stone-100 py-1 pl-2.5 pr-1 text-xs text-stone-700">
                {c.to ? <Link to={c.to} onClick={onClose} className="truncate font-medium text-brand hover:underline">{c.label}</Link> : <span className="truncate">{c.label}</span>}
                <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`} className="rounded-full p-0.5 hover:bg-stone-200"><X className="size-3.5" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : null}
        <Select aria-label="Tag it to" value={adding} onChange={(e) => setAdding(e.target.value as TagKind | '')}>
          <option value="">{chips.length ? '+ Tag something else…' : 'Tag it to a vendor, freight company, order…'}</option>
          {TAG_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
        {adding === 'vendor' ? <VendorPicker autoFocus onPick={(v) => { setVendor({ id: v.id, name: v.name }); setAdding('') }} /> : null}
        {adding === 'carrier' ? (
          <Select aria-label="Freight company" value="" onChange={(e) => { const c = carriers.data?.find((x) => x.id === e.target.value); if (c) { setCarrier({ id: c.id, name: c.name }); setAdding('') } }}>
            <option value="">{carriers.isLoading ? 'Loading…' : 'Pick the freight company'}</option>
            {(carriers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
        {adding === 'rep_group' ? (
          <Select aria-label="Rep group" value="" onChange={(e) => { const g = groups.data?.find((x) => x.id === e.target.value); if (g) { setRepGroup({ id: g.id, name: g.name }); setAdding('') } }}>
            <option value="">{groups.isLoading ? 'Loading…' : 'Pick the rep group'}</option>
            {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        ) : null}
        {adding === 'order' ? (
          <Select aria-label="Order" value="" onChange={(e) => { const o = orders.data?.find((x) => x.id === e.target.value); if (o) { setOrder({ id: o.id, name: orderName(o) }); setAdding('') } }}>
            <option value="">{orders.isLoading ? 'Loading…' : vendor ? `Pick one of ${vendor.name}'s orders` : 'Pick an open order (tag a vendor first to see all of theirs)'}</option>
            {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{orderName(o)}</option>)}
          </Select>
        ) : null}
        {adding === 'other' ? (
          <div className="flex gap-2">
            <Input aria-label="What it is about" value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Marina dock, County permit" autoFocus />
            <button type="button" className="shrink-0 text-sm font-medium text-brand hover:underline" onClick={() => setAdding('')}>OK</button>
          </div>
        ) : null}
      </div>

      <FormField label="Repeat" htmlFor="task-repeat">
        <Select id="task-repeat" value={choice} onChange={(e) => setChoice(e.target.value as RepeatChoice)}>
          {REPEAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </FormField>
      {choice === 'custom' ? (
        <div className="space-y-2 rounded-lg border border-stone-200 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-stone-700">Every</span>
            <Input aria-label="Every how many" type="number" min={1} max={365} value={every} onChange={(e) => setEvery(e.target.value)} className="w-20" />
            <Select aria-label="Days, weeks, months or years" value={unit} onChange={(e) => setUnit(e.target.value as RepeatUnit)}>
              {REPEAT_UNITS.map((u) => <option key={u.value} value={u.value}>{Number(every) === 1 ? u.one : u.many}</option>)}
            </Select>
          </div>
          {unit === 'week' ? (
            <div>
              <p className="text-xs text-stone-500">On (optional)</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {WEEKDAYS.map((d, i) => (
                  <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]))}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${days.includes(i) ? 'border-brand bg-brand text-white' : 'border-stone-300 text-stone-700 hover:bg-stone-50'}`}>{d}</button>
                ))}
              </div>
            </div>
          ) : null}
          <FormField label="Stop repeating after (optional)" htmlFor="task-until">
            <Input id="task-until" type="date" value={until} min={due || todayLocal()} onChange={(e) => setUntil(e.target.value)} />
          </FormField>
        </div>
      ) : null}
      {choice !== 'none' && !due ? <p className="text-xs text-stone-500">With no due date, it counts from today.</p> : null}

      <FormField label="Notes" htmlFor="task-notes">
        <Textarea id="task-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
    </Modal>
  )
}
