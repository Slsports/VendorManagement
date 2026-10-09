import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listWwdPaymentLines, listWwdPaymentSummaries, type WwdPaymentLine, type WwdPaymentSummary } from '@/services/wwd'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

const KIND_LABEL = { invoice: null, credit: 'Credit', debit: 'Debit', fee: 'Membership fee' } as const

interface Group { key: string; label: string; href: string | null; note: string | null; lines: WwdPaymentLine[]; paid: number }

/** One payment's lines grouped by vendor (or freight company, or the WWD name when VMS has no vendor). */
function groupLines(lines: WwdPaymentLine[]): Group[] {
  const by = new Map<string, Group>()
  for (const l of lines) {
    const i = l.invoice
    const key = i.vendor?.id ?? (i.carrier ? `c:${i.carrier.id}` : `n:${(i.wwd_vendor_name ?? '').toUpperCase()}`)
    const g = by.get(key) ?? {
      key,
      label: i.vendor?.name ?? i.carrier?.name ?? i.wwd_vendor_name ?? 'Vendor unknown',
      href: i.vendor ? `${ROUTES.vendors}/${i.vendor.id}` : null,
      note: i.carrier ? (i.vendor ? `freight via ${i.carrier.name}` : 'freight, vendor not picked yet') : !i.vendor ? (i.wwd_vendor_name ? 'not matched yet' : 'WWD gave no name') : null,
      lines: [], paid: 0,
    }
    g.lines.push(l); g.paid += l.amount
    by.set(key, g)
  }
  return [...by.values()].sort((a, b) => b.paid - a.paid)
}

function PaymentDetail({ p }: { p: WwdPaymentSummary }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listWwdPaymentLines({ paymentId: p.payment_id, sheetDate: p.pay_date, organizationId: organization.id }) : []), [organization?.id, p.payment_id, p.pay_date])
  if (q.isLoading) return <Spinner label="Loading…" className="text-brand" />
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const groups = groupLines(q.data ?? [])
  const total = groups.reduce((s, g) => s + g.paid, 0)
  return (
    <div className="space-y-3">
      {p.pending ? <p className="text-xs text-stone-500">From your payment sheet. WWD's payment # fills in when the next Payment History export is imported.</p> : null}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-stone-900">
              {g.href ? <Link to={g.href} className="hover:text-brand hover:underline">{g.label}</Link> : g.label}
              {g.note ? <span className="ml-2 text-xs font-normal text-amber-700">{g.note}</span> : null}
            </span>
            <span className="font-medium text-stone-900">{money(g.paid)}</span>
          </div>
          <table className="mt-1 w-full text-xs text-stone-600">
            <tbody>
              {g.lines.map((l, n) => {
                const i = l.invoice
                const k = KIND_LABEL[i.kind]
                const showDisc = !!i.discount && i.amount !== null && i.amount > 0
                return (
                  <tr key={`${i.id}-${n}`}>
                    <td className="py-0.5 pr-3">WWD #{i.seq}{k ? <Badge tone={i.kind === 'credit' ? 'success' : 'neutral'} className="ml-1">{k}</Badge> : null}</td>
                    <td className="py-0.5 pr-3">{shortDate(i.wwd_date)}</td>
                    <td className="py-0.5 pr-3">{i.vendor_invoice_number ? `their #${i.vendor_invoice_number}` : ''}{i.order ? <Link to={`${ROUTES.orders}/${i.order.id}`} className="ml-1 text-brand hover:underline">order</Link> : null}</td>
                    <td className="py-0.5 pr-3 text-right">{i.amount !== null && i.amount !== l.amount ? `invoice ${money(i.amount)}` : ''}</td>
                    <td className="py-0.5 pr-3 text-right text-emerald-700">{showDisc ? `− ${money(i.discount)} discount` : ''}</td>
                    <td className="py-0.5 text-right font-medium text-stone-800">{money(l.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="flex justify-between border-t border-stone-200 pt-2 font-semibold text-stone-900">
        <span>Total paid</span>
        <span>{money(total)}{p.total !== null && Math.abs(p.total - total) > 0.01 ? <span className="ml-2 text-xs font-normal text-amber-700">WWD says {money(p.total)}</span> : null}</span>
      </div>
    </div>
  )
}

/**
 * WWD payments (Dana, Oct 9: "one location that shows them all"): every payment with its date and amount,
 * newest first; click one to see which vendors it paid, the discounts and credits. Sorts by any header.
 */
export function WwdPaymentsList({ refreshKey }: { refreshKey: number }) {
  const q = useSupabaseQuery(() => listWwdPaymentSummaries(), [refreshKey])
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const rowKey = (p: WwdPaymentSummary) => p.payment_id ?? `sheet-${p.pay_date}`
  const { sorted, sort, toggle } = useTableSort(q.data ?? [], {
    date: (p) => p.pay_date, ref: (p) => p.ref, vendors: (p) => p.vendors, discounts: (p) => p.discounts, amount: (p) => p.total,
  }, { param: 'wsort', descFirst: ['date', 'amount', 'discounts', 'vendors'] })
  if (q.isLoading) return <Spinner label="Loading WWD payments…" className="text-brand" />
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const rows = q.data ?? []
  if (!rows.length) return null
  const shown = all ? sorted : sorted.slice(0, 25)
  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-900">WWD payments ({rows.length})</h2>
      <p className="text-sm text-stone-600">Click a payment to see the vendors it paid, discounts and credits.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggle} className="py-2 pr-3" />
              <SortHeader label="WWD payment #" sortKey="ref" sort={sort} onSort={toggle} className="py-2 pr-3" />
              <SortHeader label="Vendors" sortKey="vendors" sort={sort} onSort={toggle} align="right" className="py-2 pr-3 text-right" />
              <SortHeader label="Discounts" sortKey="discounts" sort={sort} onSort={toggle} align="right" className="py-2 pr-3 text-right" />
              <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={toggle} align="right" className="py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((p) => {
              const k = rowKey(p)
              const isOpen = open === k
              const Chevron = isOpen ? ChevronDown : ChevronRight
              return (
                <Fragment key={k}>
                  <tr className="cursor-pointer hover:bg-stone-50" onClick={() => setOpen(isOpen ? null : k)}>
                    <td className="whitespace-nowrap py-2 pr-3">
                      <button type="button" className="flex items-center gap-1 font-medium text-stone-900" aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : k) }}>
                        <Chevron className="size-4 text-stone-400" aria-hidden="true" />{shortDate(p.pay_date)}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-stone-700">{p.ref ?? <Badge tone="warning">From your sheet</Badge>}{p.unknown ? <span className="ml-2 text-xs text-amber-700">{p.unknown} with no vendor</span> : null}</td>
                    <td className="py-2 pr-3 text-right text-stone-700">{p.vendors || '—'}</td>
                    <td className="py-2 pr-3 text-right text-emerald-700">{p.discounts ? money(p.discounts) : '—'}</td>
                    <td className="whitespace-nowrap py-2 text-right font-medium text-stone-900">{money(p.total)}</td>
                  </tr>
                  {isOpen ? <tr><td colSpan={5} className="bg-stone-50 px-3 py-3"><PaymentDetail p={p} /></td></tr> : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 25 ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll((a) => !a)}>{all ? 'Show the latest 25' : `Show all ${rows.length}`}</Button> : null}
    </section>
  )
}
