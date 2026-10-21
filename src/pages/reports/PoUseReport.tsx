import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { vendorsPoUse } from '@/services/wwd'
import { ROUTES } from '@/lib/constants'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Spinner } from '@/components/ui'

/** Vendors that bill without our PO (Dana, Oct 21: "so we can address it with them"), from their WWD invoices. */
export default function PoUseReport() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? vendorsPoUse(organization.id) : []), [organization?.id])
  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, {
    vendor: (r) => r.vendor_name, without: (r) => (r.theirs + r.no_po) / r.invoices, invoices: (r) => r.invoices, theirs: (r) => r.theirs, none: (r) => r.no_po,
  }, { param: 'po_sort', descFirst: ['without', 'invoices', 'theirs', 'none'] })
  return (
    <div>
      <BackLink fallback={ROUTES.reports} fallbackLabel="Reports" />
      <PageHeader title="Who uses our PO" description="Vendors whose WWD invoices came without our PO: their own number, or none. From Edenred's invoice lines; the worst first." />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : !rows.length ? <p className="text-sm text-stone-600">Every vendor used our PO.</p>
        : (
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-4 py-2" />
                  <SortHeader label="Without our PO" sortKey="without" sort={sort} onSort={toggle} className="px-4 py-2" />
                  <SortHeader label="Their own number" sortKey="theirs" sort={sort} onSort={toggle} className="px-4 py-2" />
                  <SortHeader label="No PO" sortKey="none" sort={sort} onSort={toggle} className="px-4 py-2" />
                  <th className="px-4 py-2">What they put</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((r) => (
                  <tr key={r.vendor_id}>
                    <td className="px-4 py-2"><Link to={`${ROUTES.vendors}/${r.vendor_id}`} className="font-medium text-brand hover:underline">{r.vendor_name}</Link></td>
                    <td className="px-4 py-2 tabular-nums">{r.theirs + r.no_po} of {r.invoices}</td>
                    <td className="px-4 py-2 tabular-nums">{r.theirs}</td>
                    <td className="px-4 py-2 tabular-nums">{r.no_po}</td>
                    <td className="px-4 py-2 text-stone-600">{(r.examples ?? []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
