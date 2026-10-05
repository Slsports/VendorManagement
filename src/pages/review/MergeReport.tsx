import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Download } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorMerges, setMergeDoneInLightspeed } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_LABELS } from '@/lib/vendors'
import { cn, errorMessage } from '@/lib/utils'
import type { VendorMerge } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

type Filter = 'todo' | 'all'

const STATUS_LABEL: Record<VendorMerge['status'], { text: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending: { text: 'Awaiting your OK', tone: 'warning' },
  confirmed: { text: 'Confirmed', tone: 'success' },
  split: { text: 'Split back out', tone: 'neutral' },
}

/** What got merged into what, so Dana can repeat it in Lightspeed and tick each one off. */
export default function MergeReportPage() {
  const { role, profile, organization } = useAuth()
  const navigate = useNavigate()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [filter, setFilter] = useState<Filter>('todo')
  const q = useSupabaseQuery(async () => (organization ? listVendorMerges(organization.id) : []), [organization?.id])

  const rows = useMemo(() => {
    const all = q.data ?? []
    // Only names that exist in Lightspeed need doing there; VMS-only vendors have nothing to merge in LS.
    return filter === 'todo' ? all.filter((m) => m.merged_lightspeed_name && m.status === 'confirmed' && !m.ls_done_at) : all
  }, [q.data, filter])

  const groups = useMemo(() => {
    const map = new Map<string, VendorMerge[]>()
    for (const m of rows) {
      const list = map.get(m.kept_vendor_id) ?? []
      list.push(m)
      map.set(m.kept_vendor_id, list)
    }
    return [...map.values()]
  }, [rows])

  const todoCount = (q.data ?? []).filter((m) => m.merged_lightspeed_name && m.status === 'confirmed' && !m.ls_done_at).length
  const pendingCount = (q.data ?? []).filter((m) => m.status === 'pending').length

  async function toggle(m: VendorMerge, done: boolean) {
    if (!profile) return
    try {
      await setMergeDoneInLightspeed(m.id, done, profile.id)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  function download() {
    const header = ['Keep in Lightspeed', 'Merge into it', 'VMS vendor', 'Route', 'Status', 'Merged on', 'Done in LS']
    const lines = rows.map((m) => [
      m.kept_lightspeed_name ?? '',
      m.merged_lightspeed_name ?? `${m.merged_name} (VMS only)`,
      m.kept_name,
      m.route ? BILLING_ROUTE_LABELS[m.route] : '',
      STATUS_LABEL[m.status].text,
      new Date(m.merged_at).toLocaleDateString(),
      m.ls_done_at ? 'Yes' : 'No',
    ])
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `lightspeed-merges-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading merges…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>

  return (
    <div>
      <button type="button" onClick={() => navigate(ROUTES.review)} className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ArrowLeft className="size-4" aria-hidden="true" /> Review queue
      </button>
      <PageHeader
        title="Lightspeed merge report"
        description={`${todoCount} to do in Lightspeed${pendingCount ? `, ${pendingCount} still waiting for your OK in the review queue` : ''}. Tick each one as you merge it in LS.`}
        actions={<Button variant="secondary" onClick={download} disabled={rows.length === 0} leftIcon={<Download className="size-4" aria-hidden="true" />}>Download CSV</Button>}
      />

      <div className="mb-4 flex gap-2">
        {(['todo', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded-full px-3 py-1.5 text-sm', filter === f ? 'bg-brand text-brand-foreground' : 'bg-stone-100 text-stone-700 hover:bg-stone-200')}>
            {f === 'todo' ? `To do in LS (${todoCount})` : `Everything (${q.data?.length ?? 0})`}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">
          {filter === 'todo' ? 'Nothing left to merge in Lightspeed.' : 'No merges recorded yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((list) => {
            const kept = list[0]
            return (
              <section key={kept.kept_vendor_id} className="rounded-2xl border border-stone-200 bg-white p-4">
                <p className="text-sm text-stone-500">Keep in Lightspeed</p>
                <p className="font-semibold text-stone-900">{kept.kept_lightspeed_name ?? kept.kept_name}{kept.kept_lightspeed_name && kept.kept_lightspeed_name !== kept.kept_name ? <span className="font-normal text-stone-500"> · VMS: {kept.kept_name}</span> : null}</p>
                <ul className="mt-3 divide-y divide-stone-100">
                  {list.map((m) => (
                    <li key={m.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm text-stone-900">Merge <span className="font-medium">{m.merged_lightspeed_name ?? m.merged_name}</span> into it{m.merged_lightspeed_name ? '' : ' (VMS only, nothing to do in LS)'}</p>
                        <p className="text-xs text-stone-500">
                          {m.route ? `${BILLING_ROUTE_LABELS[m.route]} · ` : ''}{m.source === 'import' ? 'Merged at import' : 'Merged by hand'} · {new Date(m.merged_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge tone={STATUS_LABEL[m.status].tone}>{STATUS_LABEL[m.status].text}</Badge>
                        {m.merged_lightspeed_name && m.status === 'confirmed' ? (
                          <label className="flex items-center gap-2 text-sm text-stone-700">
                            <input type="checkbox" className="size-4 accent-brand" checked={!!m.ls_done_at} disabled={!canEdit} onChange={(e) => void toggle(m, e.target.checked)} />
                            Done in LS
                          </label>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
