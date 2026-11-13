import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Mail, Table2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listIncomingShipments } from '@/services/incomingShipments'
import { fmt, inWindow, shipStatusWord, sortIncoming, type IncomingRow } from '@/lib/incomingShipments'
import { localDay } from '@/lib/tasks'
import { ORDER_STATUS_LABELS, ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { FoldSection } from '@/components/shared/FoldSection'
import { Alert, Badge, Button, Input, Select, Spinner } from '@/components/ui'

type View = 'table' | 'week' | 'month'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const STORES = ['SLS', 'SLH', 'SLM', 'GS']
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d: Date) => addDays(d, -d.getDay())
const iso = (d: Date) => localDay(d)

/**
 * Incoming Shipments (Dana, Nov 13): every live order with the day it is expected, from what VMS already has: the
 * carrier's email, the vendor's shipment form, the order's ship date, or the delivery receipt. A table soonest first, a
 * week and a month calendar, a From / To window, store and vendor filters. Each line opens the order or the email it came
 * from. Received orders drop off.
 */
export default function ShipmentListPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = (['table', 'week', 'month'].find((v) => v === params.get('view')) ?? 'table') as View
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const store = params.get('store') ?? ''
  const status = params.get('status') ?? ''
  const who = params.get('q') ?? ''
  const [today] = useState(() => new Date())
  const anchor = params.get('date') ? new Date(`${params.get('date')}T00:00:00`) : today
  const [picked, setPicked] = useState<string | null>(null)
  const q = useSupabaseQuery(async () => (organization ? listIncomingShipments(organization.id) : []), [organization?.id])

  const set = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) p.set(k, v); else p.delete(k) }
    setParams(p, { replace: true })
  }
  const all = q.data ?? []
  const filtered = all.filter((r) =>
    (!store || r.order.store_codes.includes(store))
    && (!status || r.order.status === status)
    && (!who || `${r.order.vendor?.name ?? ''} ${r.order.po_number ?? ''} ${r.order.description ?? ''}`.toLowerCase().includes(who.toLowerCase())))
  // nothing is hidden (Dana, Nov 13: show orders placed in August and February ship months later): the table holds what is
  // coming, and the orders past their day and not marked received sit in their own section underneath
  const windowed = view === 'table' ? inWindow(filtered, from || null, to || null) : filtered
  const rows = sortIncoming(windowed.filter((r) => !r.late))
  const pastRows = sortIncoming(windowed.filter((r) => r.late))
  const { sorted, sort, toggle } = useTableSort(rows, {
    day: (r) => r.day ?? '9999',
    vendor: (r) => r.order.vendor?.name ?? '',
    po: (r) => r.order.po_number ?? '',
    ship: (r) => r.ship_date ?? '9999',
    carrier: (r) => r.carrier ?? '',
    status: (r) => r.order.status,
    store: (r) => r.order.store_codes.join(', '),
  }, { param: 'in_sort' })
  const late = pastRows.length

  // the calendar
  const range = view === 'week'
    ? { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) }
    : { from: startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), to: addDays(startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)), 6) }
  const byDay = new Map<string, IncomingRow[]>()
  for (const r of filtered) if (r.day) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r])
  function go(next: Date, nextView: View = view) {
    set({ date: iso(next), view: nextView === 'table' ? null : nextView })
    setPicked(null)
  }
  const step = (n: number) => go(view === 'week' ? addDays(anchor, 7 * n) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1))
  const title = view === 'week' ? `Week of ${range.from.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  const days: Date[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d)
  const pickedRows = picked ? byDay.get(picked) ?? [] : []

  const dayWord = (r: IncomingRow) => (r.delivered ? `Delivered ${fmt(r.arrival!)}` : r.arrival ? `Arrives ${fmt(r.arrival)}` : r.ship_date ? `Ships ${fmt(r.ship_date)}` : 'No date yet')

  return (
    <div>
      <PageHeader title="Incoming Shipments" description="Every order Sent, Placed, Confirmed or Shipped, by the day it is expected. The day comes from the carrier's email when there is one, else the vendor's shipment form, else the order's ship date; each line says which. Received orders drop off." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="flex rounded-xl border border-stone-200 bg-white p-1">
          {([['table', 'Table', Table2], ['week', 'Week', CalendarDays], ['month', 'Month', CalendarDays]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => go(anchor, v)}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold', view === v ? 'bg-brand text-white shadow-sm' : 'text-stone-600 hover:text-stone-900')}><Icon className="size-4" aria-hidden="true" />{label}</button>
          ))}
        </div>
        {view === 'table' ? (
          <>
            <label className="flex items-center gap-1.5 text-sm text-stone-700">From <Input type="date" value={from} onChange={(e) => set({ from: e.target.value })} className="h-9 w-40" aria-label="From date" /></label>
            <label className="flex items-center gap-1.5 text-sm text-stone-700">To <Input type="date" value={to} onChange={(e) => set({ to: e.target.value })} className="h-9 w-40" aria-label="To date" /></label>
            {from || to ? <Button size="sm" variant="ghost" onClick={() => set({ from: null, to: null })}>Any date</Button> : null}
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => step(-1)} aria-label="Earlier"><ChevronLeft className="size-4" aria-hidden="true" /></Button>
            <span className="min-w-48 text-center text-sm font-semibold text-stone-900">{title}</span>
            <Button size="sm" variant="secondary" onClick={() => step(1)} aria-label="Later"><ChevronRight className="size-4" aria-hidden="true" /></Button>
            <Button size="sm" variant="ghost" onClick={() => go(today)}>Today</Button>
          </>
        )}
        <Select value={store} onChange={(e) => set({ store: e.target.value })} aria-label="Store" className="h-9 w-32">
          <option value="">All stores</option>
          {STORES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Status" className="h-9 w-36">
          <option value="">Any status</option>
          {(['open', 'awaiting_confirmation', 'confirmed', 'shipped'] as const).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </Select>
        <Input value={who} onChange={(e) => set({ q: e.target.value })} placeholder="Vendor, PO or words" aria-label="Vendor, PO or words" className="h-9 w-52" />
        {q.isLoading ? <Spinner label="Loading…" className="text-brand" /> : <span className="text-sm text-stone-500">{rows.length} coming{late ? <span className="text-red-700">, {late} past their day</span> : null}</span>}
      </div>
      {q.error ? <Alert variant="error">{q.error}</Alert> : null}

      {view === 'table' ? (
        <>
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <tr>
                <SortHeader label="Expected" sortKey="day" sort={sort} onSort={toggle} className="px-4 py-2" />
                <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="PO" sortKey="po" sort={sort} onSort={toggle} className="px-3 py-2" />
                <th className="px-3 py-2">What</th>
                <SortHeader label="Ships" sortKey="ship" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Carrier" sortKey="carrier" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Store" sortKey="store" sort={sort} onSort={toggle} className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((r) => (
                <tr key={r.order.id} className={cn('align-top', r.late ? 'bg-red-50/60' : r.delivered ? 'bg-emerald-50/50' : '')}>
                  <td className={cn('max-w-64 px-4 py-2 font-medium', r.late ? 'text-red-700' : 'text-stone-900')}>
                    <span className="whitespace-nowrap">{dayWord(r)}{r.late ? <span className="ml-1 text-xs font-normal">late</span> : null}</span>
                    {r.from.to ? <Link to={r.from.to} className="mt-0.5 flex items-start gap-1 text-xs font-normal text-stone-500 hover:text-brand hover:underline">{r.from.kind === 'carrier' ? <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}<span>{r.from.label}</span></Link> : <span className="mt-0.5 block text-xs font-normal text-stone-500">{r.from.label}</span>}
                  </td>
                  <td className="px-3 py-2">{r.order.vendor ? <Link to={`${ROUTES.vendors}/${r.order.vendor.id}`} className="text-stone-900 hover:text-brand hover:underline">{r.order.vendor.name}</Link> : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2"><Link to={`${ROUTES.orders}/${r.order.id}`} className="font-medium text-brand hover:underline">{r.order.po_number ?? 'Open the order'}</Link></td>
                  <td className="max-w-56 px-3 py-2 text-stone-700"><span className="line-clamp-2">{r.order.description ?? ''}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.ship_date ? fmt(r.ship_date) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.carrier ?? '—'}{r.tracking ? <span className="block text-xs text-stone-500">{r.tracking}</span> : null}{r.email?.ship_status && !r.delivered ? <span className="block text-xs text-stone-500">{shipStatusWord(r.email.ship_status)}</span> : null}</td>
                  <td className="whitespace-nowrap px-3 py-2"><Badge tone={r.order.status === 'shipped' ? 'info' : 'neutral'}>{ORDER_STATUS_LABELS[r.order.status]}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{r.order.store_codes.join(', ')}</td>
                </tr>
              ))}
              {!q.isLoading && !sorted.length ? <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-stone-500">Nothing expected{from || to ? ' in these dates' : ''}.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {pastRows.length ? (
          <FoldSection className="mt-6" title="Past their day, not marked received" summary={`${pastRows.length} ${pastRows.length === 1 ? 'order' : 'orders'}`}>
            <p className="mb-3 text-sm text-stone-600">Their ship or arrival day has passed and nobody marked them received. Most of the old ones came in long ago: open the order and click <strong>Mark received</strong>; chase the rest.</p>
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <tr><th className="px-4 py-2">Was expected</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">PO</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Ordered</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Store</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {pastRows.map((r) => (
                    <tr key={r.order.id} className="align-top bg-red-50/40">
                      <td className="max-w-64 px-4 py-2 font-medium text-red-700">
                        <span className="whitespace-nowrap">{dayWord(r)}</span>
                        {r.from.to ? <Link to={r.from.to} className="mt-0.5 block text-xs font-normal text-stone-500 hover:text-brand hover:underline">{r.from.label}</Link> : <span className="mt-0.5 block text-xs font-normal text-stone-500">{r.from.label}</span>}
                      </td>
                      <td className="px-3 py-2">{r.order.vendor ? <Link to={`${ROUTES.vendors}/${r.order.vendor.id}`} className="text-stone-900 hover:text-brand hover:underline">{r.order.vendor.name}</Link> : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2"><Link to={`${ROUTES.orders}/${r.order.id}`} className="font-medium text-brand hover:underline">{r.order.po_number ?? 'Open the order'}</Link></td>
                      <td className="max-w-56 px-3 py-2 text-stone-700"><span className="line-clamp-2">{r.order.description ?? ''}</span></td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.order.order_date ? fmt(r.order.order_date) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.carrier ?? '—'}{r.tracking ? <span className="block text-xs text-stone-500">{r.tracking}</span> : null}</td>
                      <td className="whitespace-nowrap px-3 py-2"><Badge tone="neutral">{ORDER_STATUS_LABELS[r.order.status]}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-600">{r.order.store_codes.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FoldSection>
        ) : null}
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((d) => <span key={d} className="px-1 text-center text-xs font-medium text-stone-500">{d}</span>)}
              {days.map((day) => {
                const key = iso(day)
                const items = byDay.get(key) ?? []
                const isToday = key === iso(today)
                const inMonth = view !== 'month' || day.getMonth() === anchor.getMonth()
                return (
                  <button key={key} type="button" onClick={() => setPicked(key)} aria-label={`${day.toLocaleDateString()}: ${items.length} order(s)`}
                    className={cn('flex min-h-20 flex-col rounded-lg border p-1 text-left text-xs', picked === key ? 'border-brand bg-brand-soft' : 'border-stone-200 bg-white hover:bg-stone-50', !inMonth && 'opacity-40')}>
                    <span className={cn('font-medium', isToday ? 'rounded-full bg-brand px-1.5 text-white' : 'text-stone-700')}>{day.getDate()}</span>
                    <span className="mt-1 space-y-0.5">
                      {items.slice(0, view === 'week' ? 8 : 3).map((r) => <span key={r.order.id} className={cn('block truncate', r.delivered ? 'text-emerald-800' : r.late ? 'text-red-700' : 'text-stone-800')}>{r.order.vendor?.name ?? r.order.po_number}</span>)}
                      {items.length > (view === 'week' ? 8 : 3) ? <span className="block text-stone-500">+{items.length - (view === 'week' ? 8 : 3)} more</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
          <section className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-stone-900">{picked ? new Date(`${picked}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Click a day'}</h2>
            {picked && !pickedRows.length ? <p className="mt-2 text-sm text-stone-500">Nothing expected that day.</p> : null}
            <ul className="mt-2 divide-y divide-stone-100 text-sm">
              {pickedRows.map((r) => (
                <li key={r.order.id} className="py-2">
                  <Link to={`${ROUTES.orders}/${r.order.id}`} className="font-medium text-stone-900 hover:text-brand">{r.order.vendor?.name ?? 'Order'}{r.order.po_number ? ` · PO ${r.order.po_number}` : ''}</Link>
                  <span className="block text-stone-600">{dayWord(r)}{r.carrier ? ` · ${r.carrier}` : ''}{r.late ? <span className="text-red-700"> · late</span> : ''}</span>
                  {r.from.to ? <Link to={r.from.to} className="block text-xs text-stone-500 hover:text-brand hover:underline">{r.from.label}</Link> : <span className="block text-xs text-stone-500">{r.from.label}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
