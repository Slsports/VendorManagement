import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { WwdInvoiceRow } from '@/services/wwd'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { Badge } from '@/components/ui'

const KIND = { invoice: null, credit: { label: 'Credit', tone: 'success' }, debit: { label: 'Debit', tone: 'warning' }, fee: { label: 'Membership fee', tone: 'neutral' } } as const

function wwdPaidText(i: WwdInvoiceRow): string {
  const refs = [...new Set(i.wwd_payment_lines.map((l) => l.wwd_payments?.ref).filter(Boolean))]
  if (i.paid_date) return `${shortDate(i.paid_date)}${refs.length ? ` · ${refs.join(', ')}` : ''}`
  if (i.sheet_paid_date) return `${shortDate(i.sheet_paid_date)} (your sheet)`
  return 'Not paid'
}

/** A few WWD invoices in a compact table (names to match, freight lines): number, date, their invoice / PO, amount, paid. */
export function WwdInvoiceTable({ rows, action, showVendor = false }: { rows: WwdInvoiceRow[]; action?: (i: WwdInvoiceRow) => ReactNode; showVendor?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="py-1 pr-3">WWD #</th>
            <th className="py-1 pr-3">Date</th>
            {showVendor ? <th className="py-1 pr-3">Name on WWD</th> : null}
            <th className="py-1 pr-3">Their invoice / PO</th>
            <th className="py-1 pr-3 text-right">Amount</th>
            <th className="py-1 pr-3">Paid</th>
            {action ? <th className="py-1" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((i) => {
            const k = KIND[i.kind]
            return (
              <tr key={i.id}>
                <td className="whitespace-nowrap py-1.5 pr-3 font-medium text-stone-900">{i.seq}{k ? <Badge tone={k.tone} className="ml-1">{k.label}</Badge> : null}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-stone-600">{shortDate(i.wwd_date)}</td>
                {showVendor ? <td className="py-1.5 pr-3 text-stone-700">{i.wwd_vendor_name ?? '—'}</td> : null}
                <td className="py-1.5 pr-3 text-stone-600">
                  {[i.vendor_invoice_number ? `#${i.vendor_invoice_number}` : null, i.po_number ? `PO ${i.po_number}` : null].filter(Boolean).join(' · ') || '—'}
                  {i.order ? <Link to={`${ROUTES.orders}/${i.order.id}`} className="ml-1 text-brand hover:underline">order</Link> : null}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium text-stone-900">{money(i.amount ?? i.paid_amount)}{i.discount ? <span className="block text-xs font-normal text-emerald-700">− {money(i.discount)} disc.</span> : null}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-stone-500">{wwdPaidText(i)}</td>
                {action ? <td className="py-1.5 text-right">{action(i)}</td> : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
