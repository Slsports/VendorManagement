import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { amazonMonthly, listAmazonOrders, type AmazonMonth } from '@/services/supplies'
import { money } from '@/lib/freight'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Spinner } from '@/components/ui'

const STORES = ['SLS', 'SLH', 'SLM', 'GS', 'No PO'] as const
const monthName = (m: string) => new Date(`${m.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const STATUS = { ordered: { label: 'Ordered', tone: 'info' }, shipped: { label: 'Shipped', tone: 'info' }, delivered: { label: 'Delivered', tone: 'success' }, cancelled: { label: 'Cancelled', tone: 'neutral' } } as const

/**
 * Supplies › Amazon (Dana, Oct 12): every Amazon order from the confirmation emails. The PO says whose and which store:
 * TP-SLS is Tyler for Shaver Lake Sports. Monthly totals by store and by person; orders with no PO show as "No PO".
 */
export function AmazonTab() {
  const { organization } = useAuth()
  const months = useSupabaseQuery(async () => (organization ? amazonMonthly(organization.id, 12) : []), [organization?.id])
  const orders = useSupabaseQuery(async () => (organization ? listAmazonOrders(organization.id) : []), [organization?.id])
  const rows = orders.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    date: (o) => o.ordered_at, who: (o) => o.person_name ?? o.initials, store: (o) => o.store_code, total: (o) => o.total, status: (o) => o.status, items: (o) => o.items,
  }, { param: 'amz_sort', descFirst: ['date', 'total'] })

  if (months.isLoading || orders.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading Amazon orders…" className="text-brand" /></div>
  if (months.error || orders.error) return <Alert variant="error">{months.error ?? orders.error}</Alert>

  const byMonth = new Map<string, AmazonMonth[]>()
  for (const r of months.data ?? []) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r])
  const people = [...new Set((months.data ?? []).map((r) => r.person_name))].sort()

  return (
    <div className="space-y-6">
      <section className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Spending by month</h2>
        {byMonth.size === 0 ? <p className="px-4 pb-4 pt-2 text-sm text-stone-600">No Amazon orders yet. They arrive from the confirmation emails sent to orders@.</p> : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-3 py-2">Month</th>
                {STORES.map((s) => <th key={s} scope="col" className="px-3 py-2 text-right">{s}</th>)}
                {people.map((p) => <th key={p} scope="col" className="px-3 py-2 text-right normal-case">{p.split(' ')[0]}</th>)}
                <th scope="col" className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {[...byMonth.entries()].map(([m, list]) => {
                const sum = (f: (r: AmazonMonth) => boolean) => list.filter(f).reduce((a, r) => a + r.total, 0)
                const all = sum(() => true)
                return (
                  <tr key={m}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-stone-900">{monthName(m)}</td>
                    {STORES.map((s) => { const n = sum((r) => r.store_code === s); return <td key={s} className="px-3 py-2 text-right text-stone-700">{n ? money(n) : ''}</td> })}
                    {people.map((p) => { const n = sum((r) => r.person_name === p); return <td key={p} className="px-3 py-2 text-right text-stone-600">{n ? money(n) : ''}</td> })}
                    <td className="px-3 py-2 text-right font-semibold text-stone-900">{money(all)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {rows.length ? (
        <section className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Orders</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <SortHeader label="Ordered" sortKey="date" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Who" sortKey="who" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Store" sortKey="store" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="What" sortKey="items" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Total" sortKey="total" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{day(o.ordered_at)}<span className="block text-xs text-stone-400">#{o.order_number}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{o.person_name ?? o.initials ?? <span className="text-amber-700">No PO</span>}{o.po ? <span className="block text-xs text-stone-400">PO {o.po}</span> : null}</td>
                  <td className="px-3 py-2 text-stone-700">{o.store_code ?? ''}</td>
                  <td className="min-w-48 px-3 py-2 text-stone-700">{o.items ?? ''}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-stone-900">{o.total !== null ? money(o.total) : ''}</td>
                  <td className="whitespace-nowrap px-3 py-2"><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                    {o.status === 'delivered' && o.delivered_at ? <span className="block text-xs text-stone-500">{day(o.delivered_at)}</span> : o.expected_at ? <span className="block text-xs text-stone-500">due {day(o.expected_at)}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <p className="text-xs text-stone-500">The PO starts with the buyer's initials and the store: TP-SLS, GP-SLH, DP-GS. Dana's (DP) orders also fill Supplies requests.</p>
    </div>
  )
}
