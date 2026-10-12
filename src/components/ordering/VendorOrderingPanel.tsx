import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShoppingCart, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { finishOrderingItem, getOpenOrderingItem, latestSalesReport, onOrderingChanged, ORDERING_STAGE_LABELS } from '@/services/ordering'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui'
import { FlagButtons } from './FlagButtons'
import { SalesReportUpload } from './SalesReportUpload'
import { SuggestedOrderDialog } from './SuggestedOrder'

/** On a vendor page: where the vendor is on the Ordering card, the two flags, the sales report and the suggested order. */
export function VendorOrderingPanel({ vendor, assignedBuyerId, canEdit, className }: {
  vendor: { id: string; name: string; aliases?: string[] }
  assignedBuyerId?: string | null
  canEdit: boolean
  className?: string
}) {
  const flag = useSupabaseQuery(() => getOpenOrderingItem(vendor.id), [vendor.id])
  const report = useSupabaseQuery(() => latestSalesReport(vendor.id), [vendor.id])
  const [open, setOpen] = useState(false)
  const { refetch: refetchFlag } = flag
  const { refetch: refetchReport } = report
  useEffect(() => onOrderingChanged(() => { void refetchFlag(); void refetchReport() }), [refetchFlag, refetchReport])
  const f = flag.data
  return (
    <section aria-label="Ordering" className={className}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><ShoppingCart className="size-4 text-brand" aria-hidden="true" /> Ordering</h2>
      {f ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
      <p className="mt-2 text-xs text-stone-500">
        {report.data ? `Last sales report ${new Date(`${report.data.run_date}T12:00:00`).toLocaleDateString()} (${report.data.days} days).` : 'No sales report yet.'}
      </p>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <FlagButtons vendor={vendor} assignedBuyerId={assignedBuyerId} />
          <SalesReportUpload vendor={vendor} onSaved={() => { void report.refetch(); setOpen(true) }} />
          {report.data ? <Button size="sm" onClick={() => setOpen(true)}>Suggested order</Button> : null}
        </div>
      ) : null}
      {open ? <SuggestedOrderDialog vendor={vendor} onClose={() => setOpen(false)} /> : null}
    </section>
  )
}
