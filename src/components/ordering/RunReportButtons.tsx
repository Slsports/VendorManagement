import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { latestSalesReport } from '@/services/ordering'
import { DEFAULT_PARAMS, daysAgoIso, listLsStores, listLsVendorChoices, runLsReport, todayIso } from '@/services/lsReports'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui'

/**
 * Run report and Run order (Dana, Oct 18): ordering starts from Lightspeed, not from an upload. Run report runs this
 * vendor's sales report from LS (last 12 months, all stores together) and files it under the vendor, exactly like a
 * vendor run from the Sales Reports page. Run order opens the suggested order from today's report, running one first
 * when there is none today. Other periods or stores apart: the Sales Reports page (Reports).
 */
export function RunReportButtons({ vendor, onSuggest, compact = false }: {
  vendor: { id: string; name: string }
  /** Open the suggested order (after Run order, or Run report when nothing else is wanted). */
  onSuggest: () => void
  /** One line of buttons on a card row; the vendor page shows the status line under them. */
  compact?: boolean
}) {
  const { organization, profile } = useAuth()
  const [busy, setBusy] = useState<'report' | 'order' | null>(null)
  const [status, setStatus] = useState<{ kind: 'running' | 'done' | 'error'; text: string } | null>(null)

  async function run(): Promise<boolean> {
    if (!organization || !profile) return false
    setStatus({ kind: 'running', text: 'Running the sales report from Lightspeed…' })
    const [stores, vendors] = await Promise.all([listLsStores(organization.id), listLsVendorChoices(organization.id)])
    const mine = vendors.filter((v) => v.vendor_id === vendor.id)
    if (!mine.length) {
      setStatus({ kind: 'error', text: `${vendor.name} is not tied to a Lightspeed vendor yet, so VMS cannot run its report. Set In Lightspeed as on the vendor page.` })
      return false
    }
    if (mine.length > 1) {
      setStatus({ kind: 'error', text: `${vendor.name} is tied to ${mine.length} Lightspeed vendors (${mine.map((v) => v.name).join(', ')}). Run the report from the Sales Reports page.` })
      return false
    }
    const params = { ...DEFAULT_PARAMS, vendor_ids: [mine[0]!.ls_vendor_id], store_codes: stores.map((s) => s.code), from: daysAgoIso(365), to: todayIso(), days: 365 }
    const r = await runLsReport({ organizationId: organization.id, params, stores, vendors, profile: { id: profile.id, full_name: profile.full_name } })
    setStatus({ kind: 'done', text: `Report filed under ${vendor.name}: ${r.run.file_name}.` })
    return true
  }

  async function runReport() {
    setBusy('report')
    try {
      if (await run()) toast.success('Sales report filed under the vendor')
    } catch (e) {
      setStatus({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  async function runOrder() {
    setBusy('order')
    try {
      // a report run today is good enough (Dana, Oct 18)
      const latest = await latestSalesReport(vendor.id)
      if (latest?.run_date === todayIso()) { setStatus(null); onSuggest(); return }
      if (await run()) onSuggest()
    } catch (e) {
      setStatus({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const link = `${ROUTES.vendors}/${vendor.id}`
  return (
    <>
      <Button size="sm" loading={busy === 'report'} disabled={busy !== null} onClick={() => void runReport()} title="Run this vendor's sales report from Lightspeed: last 12 months, all stores together, filed under the vendor">Run report</Button>
      <Button size="sm" loading={busy === 'order'} disabled={busy !== null} onClick={() => void runOrder()} title="Open the suggested order from today's report (runs one first when there is none today)">Run order</Button>
      {status ? (
        <span className={`${compact ? '' : 'basis-full '}text-xs ${status.kind === 'error' ? 'text-red-700' : status.kind === 'done' ? 'text-green-700' : 'text-stone-600'}`} role="status">
          {status.text}
          {status.kind === 'error' && /In Lightspeed as/.test(status.text) && compact ? <> <Link to={link} className="font-medium text-brand hover:underline">Open the vendor</Link></> : null}
        </span>
      ) : null}
    </>
  )
}
