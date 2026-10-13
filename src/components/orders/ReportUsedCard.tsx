import { useState } from 'react'
import toast from 'react-hot-toast'
import { FileSpreadsheet } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { downloadVendorFile, listVendorLinks, tickSalesReport } from '@/services/lines'
import { errorMessage } from '@/lib/utils'
import { Select } from '@/components/ui'

/**
 * "Report used" (Dana, Oct 5 and 13): the sales report this order was placed from. The vendor's confirmation is checked
 * against it when the order has no item list; picking one also ticks it "Used to place the order" in Sales reports.
 */
export function ReportUsedCard({ orderId, vendorId, reportId, canEdit, onChange }: { orderId: string; vendorId: string; reportId: string | null; canEdit: boolean; onChange: () => void }) {
  const q = useSupabaseQuery(async () => (await listVendorLinks(vendorId)).filter((l) => l.kind === 'sales_report' && l.storage_path), [vendorId])
  const { view, viewer } = useDocumentViewer()
  const [busy, setBusy] = useState(false)
  const reports = q.data ?? []
  const current = reports.find((r) => r.id === reportId) ?? null

  async function pick(id: string) {
    setBusy(true)
    try {
      if (id) await tickSalesReport(id, true, orderId)
      else if (reportId) await tickSalesReport(reportId, false, orderId)
      toast.success(id ? 'Report used saved' : 'Report used cleared')
      onChange()
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!reports.length && !canEdit) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Report used</h2>
      {reports.length ? (
        <>
          {canEdit ? (
            <Select aria-label="Sales report used for this order" className="mt-3 h-9 text-sm" value={reportId ?? ''} disabled={busy} onChange={(e) => void pick(e.target.value)}>
              <option value="">Not picked</option>
              {reports.map((r) => <option key={r.id} value={r.id}>{r.label}{r.received_at ? ` (${new Date(`${r.received_at}T12:00:00`).toLocaleDateString()})` : ''}</option>)}
            </Select>
          ) : null}
          {current ? (
            <button type="button" onClick={() => view({ name: current.file_name ?? current.label, mime: current.mime_type, load: () => downloadVendorFile(current.storage_path!) })}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><FileSpreadsheet className="size-4" aria-hidden="true" />Open {current.label}</button>
          ) : <p className="mt-2 text-xs text-stone-500">The sales report this order was placed from. The confirmation is checked against it when the order has no item list.</p>}
        </>
      ) : <p className="mt-2 text-sm text-stone-500">No sales reports for this vendor yet. Add one in the vendor's Sales reports folder.</p>}
      {viewer}
    </section>
  )
}
