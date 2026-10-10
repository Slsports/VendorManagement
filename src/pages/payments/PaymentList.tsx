import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { importBillcom, listPayments, previewBillcom, readBillcomFile, type BillcomMatch } from '@/services/payments'
import type { BillcomRow } from '@/lib/billcom'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { WwdImportSection } from '@/components/payments/WwdImportSection'
import { WwdUnsortedNames } from '@/components/payments/WwdUnsortedNames'
import { WwdPaymentsList } from '@/components/payments/WwdPaymentsList'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

/**
 * Payments (Dana, Oct 9): import Bill.com's Payments export. Each payment is matched to a freight bill or a
 * vendor order and marked paid; every payment is kept as history on its vendor or billing company.
 * Nothing is saved until "Import".
 */
export default function PaymentsPage() {
  const { organization } = useAuth()
  const recent = useSupabaseQuery(async () => (organization ? listPayments({ organizationId: organization.id }, 50) : []), [organization?.id])
  const [rows, setRows] = useState<BillcomRow[]>([])
  const [matches, setMatches] = useState<BillcomMatch[]>([])
  const [keep, setKeep] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [wwdRun, setWwdRun] = useState(0)

  async function read(file: File) {
    setBusy(true)
    try {
      const r = await readBillcomFile(file)
      const m = await previewBillcom(r)
      setRows(r)
      setMatches(m)
      setKeep(new Set(r.map((_, i) => i).filter((i) => !m[i]?.already)))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function doImport() {
    setBusy(true)
    try {
      const n = await importBillcom(rows.filter((_, i) => keep.has(i)))
      toast.success(`${n} payment${n === 1 ? '' : 's'} imported`)
      setRows([]); setMatches([]); setKeep(new Set())
      await recent.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const count = (f: (m: BillcomMatch) => boolean) => matches.filter((m, i) => keep.has(i) && f(m)).length
  return (
    <div>
      <PageHeader title="Payments" description="Import Bill.com and Worldwide (WWD) payments: each payment marks its freight bill or vendor order paid, and stays as history on the vendor." />

      <WwdImportSection onImported={() => setWwdRun((n) => n + 1)} />
      <WwdUnsortedNames refreshKey={wwdRun} />
      <WwdPaymentsList refreshKey={wwdRun} />

      <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FileSpreadsheet className="size-6 text-stone-400" aria-hidden="true" />
          <p className="text-sm text-stone-700">Bill.com → Payments → export to Excel or CSV, then choose the file here.</p>
          <Button variant="secondary" loading={busy && !rows.length} onClick={() => input.current?.click()} leftIcon={<Upload className="size-4" aria-hidden="true" />}>Choose the export</Button>
          <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />
        </div>

        {rows.length ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span><span className="font-semibold">{keep.size}</span> of {rows.length} to import</span>
              <span className="text-emerald-700">{count((m) => !!m.bill_id && !m.bill_paid)} freight bills to mark paid</span>
              <span className="text-emerald-700">{count((m) => !!m.order_id && !m.order_paid)} orders to mark paid</span>
              <span className="text-stone-500">{count((m) => !m.bill_id && !m.order_id)} kept as history only</span>
              <span className="text-stone-500">{matches.filter((m) => m.already).length} already imported</span>
              <Button className="ml-auto" loading={busy} disabled={!keep.size} onClick={() => void doImport()}>Import {keep.size}</Button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr><th className="px-2 py-2" /><th className="px-2 py-2">Paid</th><th className="px-2 py-2">To</th><th className="px-2 py-2">Invoice</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2">Matches</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r, i) => {
                    const m = matches[i]
                    return (
                      <tr key={i} className={keep.has(i) ? '' : 'opacity-50'}>
                        <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Import ${r.payee} ${r.invoice_number ?? ''}`} checked={keep.has(i)} onChange={() => setKeep((k) => { const n = new Set(k); if (n.has(i)) n.delete(i); else n.add(i); return n })} /></td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-stone-600">{shortDate(r.process_date)}<span className="block text-xs text-stone-400">{r.method}</span></td>
                        <td className="px-2 py-1.5 text-stone-900">{r.payee}<span className="block text-xs text-stone-500">{m?.carrier ?? m?.vendor ?? 'No vendor by that name'}</span></td>
                        <td className="px-2 py-1.5 text-stone-700">{r.invoice_number}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium">{money(r.amount)}</td>
                        <td className="px-2 py-1.5">
                          {m?.already ? <Badge tone="neutral">Already imported</Badge>
                            : m?.bill_id ? <Badge tone={m.bill_paid ? 'neutral' : 'success'}>Freight bill {m.bill}{m.bill_paid ? ' (already paid)' : ''}</Badge>
                            : m?.order_id ? <Badge tone={m.order_paid ? 'neutral' : 'success'}>Order {m.order}{m.order_paid ? ' (already paid)' : ''}</Badge>
                            : <span className="text-xs text-stone-500">History only</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Recent payments</h2>
      {recent.error ? <Alert variant="error">{recent.error}</Alert> : null}
      {recent.isLoading ? <Spinner label="Loading…" className="text-brand" /> : (recent.data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 px-6 py-10 text-center text-sm text-stone-600">None yet. Import the Bill.com export above.</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white text-sm">
          {recent.data!.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0"><span className="font-medium text-stone-900">{p.payee}</span><span className="text-stone-500"> · {shortDate(p.process_date)}{p.invoice_number ? ` · ${p.invoice_number}` : ''}{p.method ? ` · ${p.method}` : ''}</span></span>
              <span className="flex items-center gap-2">
                {p.freight_bill_id ? <Link to={`${ROUTES.freight}/${p.freight_bill_id}`} className="text-xs text-brand hover:underline">Freight bill</Link> : null}
                {p.order_id ? <Link to={`${ROUTES.orders}/${p.order_id}`} className="text-xs text-brand hover:underline">Order</Link> : null}
                <span className="font-medium">{money(p.amount)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
