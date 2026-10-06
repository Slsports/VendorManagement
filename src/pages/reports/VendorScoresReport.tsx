import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listScorecards } from '@/services/scores'
import { SCORE_DIMENSIONS, scoreTone } from '@/lib/scores'
import { ROUTES } from '@/lib/constants'
import { standingWhy } from '@/lib/vendors'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Select, Spinner } from '@/components/ui'

const TONE = { good: 'text-emerald-700', mid: 'text-amber-700', bad: 'text-red-700', none: 'text-stone-300' }

export default function VendorScoresReportPage() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listScorecards(organization.id) : []), [organization?.id])
  const [show, setShow] = useState<'scored' | 'all'>('scored')
  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Scoring vendors…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const rows = (q.data ?? []).filter((r) => show === 'all' || r.overall !== null).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name))
  const cell = (v: number | null) => <td className={`px-3 py-2 text-center ${TONE[scoreTone(v)]}`}>{v ?? '·'}</td>

  return (
    <div>
      <Link to={ROUTES.reports} className="mb-3 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900"><ArrowLeft className="size-4" aria-hidden="true" /> Reports</Link>
      <PageHeader
        title="Vendor scores"
        description="Five is best. Fulfilment, accuracy, shipping and resolution score themselves from the order history; ease and communication are staff ratings until Gmail is connected. A staff rating always wins."
        actions={<Select value={show} onChange={(e) => setShow(e.target.value as 'scored' | 'all')} aria-label="Which vendors" className="h-9 w-48"><option value="scored">Scored vendors ({(q.data ?? []).filter((r) => r.overall !== null).length})</option><option value="all">All vendors ({(q.data ?? []).length})</option></Select>}
      />
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
            <tr><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Standing</th><th className="px-3 py-2 text-center">Overall</th>{SCORE_DIMENSIONS.map((d) => <th key={d.key} className="px-3 py-2 text-center" title={d.help}>{d.label}</th>)}<th className="px-3 py-2 text-right">Orders</th><th className="px-3 py-2 text-right">Freight %</th><th className="px-3 py-2 text-right">Issues</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.vendor_id} className="hover:bg-stone-50">
                <td className="px-3 py-2"><Link to={`${ROUTES.vendors}/${r.vendor_id}`} className="font-medium text-stone-900 hover:text-brand">{r.name}</Link></td>
                <td className="px-3 py-2">{r.standing === 'do_not_order' ? <Badge tone="danger">Do not order</Badge> : r.standing === 'last_resort' ? <Badge tone="warning">Last resort</Badge> : null}{r.standing_tags.length ? <span className="block text-xs text-stone-500">{standingWhy(r.standing_tags)}</span> : null}</td>
                <td className={`px-3 py-2 text-center font-semibold ${TONE[scoreTone(r.overall)]}`}>{r.overall ?? '·'}</td>
                {cell(r.rated_ease)}{cell(r.rated_communication)}{cell(r.rated_fulfilment ?? r.auto_fulfilment)}{cell(r.rated_accuracy ?? r.auto_accuracy)}{cell(r.rated_shipping ?? r.auto_shipping)}{cell(r.rated_resolution ?? r.auto_resolution)}
                <td className="px-3 py-2 text-right text-stone-600">{r.orders}</td>
                <td className="px-3 py-2 text-right text-stone-600">{r.freight_pct !== null ? `${r.freight_pct}%` : ''}</td>
                <td className="px-3 py-2 text-right text-stone-600">{r.accuracy_issues + r.issue_notes + r.free_violations || ''}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={12} className="px-3 py-8 text-center text-stone-500">Nothing scored yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
