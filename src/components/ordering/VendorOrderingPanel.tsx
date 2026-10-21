import { ROUTES } from '@/lib/constants'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { finishOrderingItem, getOpenOrderingItem, latestSalesReport, onOrderingChanged, ORDERING_STAGE_LABELS } from '@/services/ordering'
import { errorMessage } from '@/lib/utils'
import { ORDER_WINDOW_KIND_LABELS, monthsLabel } from '@/lib/vendors'
import type { VendorOrderWindow } from '@/types'
import { Button } from '@/components/ui'
import { FoldSection } from '@/components/shared/FoldSection'
import { FlagButtons } from './FlagButtons'
import { RunReportButtons } from './RunReportButtons'
import { SalesReportUpload } from './SalesReportUpload'
import { SuggestedOrderDialog } from './SuggestedOrder'

/**
 * On a vendor page: where the vendor is on the Ordering card, the two flags, Run report / Run order, the sales report,
 * the suggested order, and the vendor's ordering windows beside the sales report date (Dana, Oct 21: one box, not two).
 */
export function VendorOrderingPanel({ vendor, assignedBuyerId, canEdit, className, windows }: {
  vendor: { id: string; name: string; aliases?: string[] }
  assignedBuyerId?: string | null
  windows?: Pick<VendorOrderWindow, 'id' | 'kind' | 'label' | 'months' | 'notes'>[]
  canEdit: boolean
  className?: string
}) {
  const flag = useSupabaseQuery(() => getOpenOrderingItem(vendor.id), [vendor.id])
  const report = useSupabaseQuery(() => latestSalesReport(vendor.id), [vendor.id])
  const [open, setOpen] = useState(false)
  const { refetch: refetchFlag } = flag
  const { refetch: refetchReport } = report
  useEffect(() => onOrderingChanged(() => { void refetchFlag(); void refetchReport() }), [refetchFlag, refetchReport])
  useLiveTable('sales_reports', `vendor_id=eq.${vendor.id}`, () => { void refetchReport() })
  useLiveTable('ordering_items', `vendor_id=eq.${vendor.id}`, () => { void refetchFlag() })
  const f = flag.data
  // starts closed on the vendor page; the title bar says whether it is on the Ordering card (Dana, Oct 12)
  const summary = flag.isLoading ? null : f ? `On the card: ${ORDERING_STAGE_LABELS[f.stage as 'check' | 'to_order']}` : report.data ? `Sales report ${new Date(`${report.data.run_date}T12:00:00`).toLocaleDateString()}` : 'Not on the card'
  return (
    <>
      <FoldSection title="Ordering" summary={summary} className={className}>
        {f ? (
          <p className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-medium">On the Ordering card: {ORDERING_STAGE_LABELS[f.stage as 'check' | 'to_order']}</span>
            {f.assignee ? <span className="text-xs">for {f.assignee.full_name.split(' ')[0]}</span> : null}
            {f.note ? <span className="text-xs">· {f.note}</span> : null}
            {canEdit ? (
              <button type="button" aria-label="Take off the Ordering card" title="Take off the Ordering card" className="ml-auto rounded p-0.5 hover:bg-amber-100"
                onClick={() => void finishOrderingItem(f.id, 'removed').then(() => toast.success('Taken off the Ordering card')).catch((e) => toast.error(errorMessage(e)))}>
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-stone-500">
          <p>{report.data ? `Last sales report ${new Date(`${report.data.run_date}T12:00:00`).toLocaleDateString()} (${report.data.days} days).` : 'No sales report yet.'}</p>
          {windows ? (
            <p>
              <span className="font-medium text-stone-700">Ordering windows: </span>
              {windows.length ? windows.map((w) => `${w.label || ORDER_WINDOW_KIND_LABELS[w.kind]}${w.months.length ? ` (${monthsLabel(w.months)})` : ''}${w.notes ? `, ${w.notes}` : ''}`).join(' · ')
                : canEdit ? <Link to={`${ROUTES.vendors}/${vendor.id}/edit`} className="text-brand hover:underline">none yet, add on the edit page</Link> : 'none'}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <FlagButtons vendor={vendor} assignedBuyerId={assignedBuyerId} />
            {/* Run report / Run order (Dana, Oct 18): straight from Lightspeed; Upload stays for historical reports */}
            <RunReportButtons vendor={vendor} onSuggest={() => { void report.refetch(); setOpen(true) }} />
            {report.data ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Suggested order</Button> : null}
            <Link to={`${ROUTES.salesReports}?vendor=${vendor.id}`} className="inline-flex h-8 items-center rounded-lg border border-stone-200 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50" title="The Sales Reports page with this vendor picked: other periods, stores apart">Reports</Link>
            <SalesReportUpload vendor={vendor} variant="ghost" onSaved={(used) => { void report.refetch(); if (!used) setOpen(true) }} />
          </div>
        ) : null}
      </FoldSection>
      {open ? <SuggestedOrderDialog vendor={vendor} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
