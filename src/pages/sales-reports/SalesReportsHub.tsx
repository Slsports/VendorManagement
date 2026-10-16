import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet, Play, Save, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { DEFAULT_PARAMS, daysAgoIso, deleteReportPreset, downloadRunFile, listLsCategories, listLsStores, listLsVendorChoices, listReportPresets, listReportRuns, lsSyncStatus, reportName, runLsReport, saveReportPreset, todayIso, type LsVendorChoice, type ReportParams, type ReportRun, type StoreMode } from '@/services/lsReports'
import { ROUTES } from '@/lib/constants'
import { rungsOf } from '@/lib/sizes'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'

/**
 * Sales Reports (Dana, Oct 16): vendor and category reports straight from Lightspeed, by spec v49, replacing LS
 * Analytics. Pick the kind, one or two vendors, categories, the stores (together, one, or kept apart) and the period;
 * Run builds the workbook, files it (under the vendor, or under Reports) and lists the run. Saved settings run again
 * with one click. Opened from a vendor's ordering card with the vendor already picked.
 */
export default function SalesReportsHub() {
  const { organization, profile, role } = useAuth()
  const org = organization?.id
  const canRun = role === 'admin' || role === 'manager' || role === 'buyer'
  const [params] = useSearchParams()
  const stores = useSupabaseQuery(async () => (org ? listLsStores(org) : []), [org])
  const vendors = useSupabaseQuery(async () => (org ? listLsVendorChoices(org) : []), [org])
  const categories = useSupabaseQuery(async () => (org ? listLsCategories(org) : []), [org])
  const status = useSupabaseQuery(async () => (org ? lsSyncStatus(org) : null), [org])
  const [tick, setTick] = useState(0)
  const presets = useSupabaseQuery(async () => (org ? listReportPresets(org) : []), [org, tick])
  const runs = useSupabaseQuery(async () => (org ? listReportRuns(org) : []), [org, tick])

  // every store on the account by default; a vendor from the ordering card is picked on arrival (the form starts
  // from these once they are loaded, so no state is set in an effect)
  const storeCodes = useMemo(() => (stores.data ?? []).map((s) => s.code), [stores.data])
  const wantedVendor = params.get('vendor')
  const wantedLs = wantedVendor ? (vendors.data ?? []).find((x) => x.vendor_id === wantedVendor)?.ls_vendor_id ?? null : null
  const initial = useMemo<ReportParams>(() => ({ ...DEFAULT_PARAMS, store_codes: storeCodes, vendor_ids: wantedLs ? [wantedLs] : [] }), [storeCodes, wantedLs])
  const [preset, setPreset] = useState<{ n: number; params: ReportParams } | null>(null)
  const formKey = `${storeCodes.join(',')}|${wantedLs ?? ''}|${preset?.n ?? 0}`
  const [p, setP] = useState<ReportParams>(initial)
  const set = <K extends keyof ReportParams>(k: K, v: ReportParams[K]) => setP((x) => ({ ...x, [k]: v }))
  const [formSeen, setFormSeen] = useState(formKey)
  if (formSeen !== formKey) { setFormSeen(formKey); setP(preset?.params ?? initial) }

  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<{ run: ReportRun; file: File } | null>(null)
  async function run() {
    if (!org || !profile) return
    if (p.kind === 'vendor' && !p.vendor_ids.length) { toast.error('Pick a vendor'); return }
    if (p.kind === 'category' && !p.categories.length && !p.vendor_ids.length) { toast.error('Pick a category'); return }
    if (!p.store_codes.length) { toast.error('Pick a store'); return }
    setRunning(true)
    try {
      const r = await runLsReport({ organizationId: org, params: p, stores: stores.data ?? [], vendors: vendors.data ?? [], profile: { id: profile.id, full_name: profile.full_name } })
      setLast({ run: r.run, file: r.file })
      download(r.file)
      toast.success(`Report ready: ${r.file.name}`)
      setTick((t) => t + 1)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const [presetName, setPresetName] = useState('')
  async function savePreset() {
    if (!org || !profile) return
    const name = presetName.trim() || reportName(p, vendors.data ?? [])
    try { await saveReportPreset(org, name, p, profile.id); toast.success(`Saved as “${name}”`); setPresetName(''); setTick((t) => t + 1) } catch (e) { toast.error(errorMessage(e)) }
  }

  const fresh = status.data
  const soldThrough = fresh?.lines_since ? new Date(fresh.lines_since) : null

  return (
    <div className="space-y-5">
      <PageHeader title="Sales Reports" description="Vendor and category reports straight from Lightspeed, formatted by the sales report spec. Pick the vendor or category, the stores and the period, then Run." />

      {status.data === null && !status.isLoading ? <Alert variant="warning">Lightspeed is not copied into VMS yet. Connect Lightspeed in Settings; the copy starts on its own.</Alert> : null}
      {fresh ? (
        <p className="text-sm text-stone-600">
          Lightspeed copy: {fresh.items.toLocaleString()} items{fresh.items_pass_finished ? ` (stock as of ${new Date(fresh.items_pass_finished).toLocaleString()})` : ' (first pass still running)'},
          {' '}{fresh.lines.toLocaleString()} sale lines{soldThrough ? ` through ${soldThrough.toLocaleString()}` : ''}{!fresh.lines_backfill_done ? ', still bringing in the history from ' + new Date(fresh.backfill_from).toLocaleDateString() : ''}.
          {fresh.last_error ? <span className="text-red-700"> Last problem: {fresh.last_error}</span> : null}
        </p>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <FormField label="Report" htmlFor="r-kind">
              <Select id="r-kind" value={p.kind} onChange={(e) => set('kind', e.target.value as ReportParams['kind'])}>
                <option value="vendor">Vendor report (one vendor, or several side by side)</option>
                <option value="category">Category report (every vendor in the category)</option>
              </Select>
            </FormField>
            <VendorPick vendors={vendors.data ?? []} value={p.vendor_ids} onChange={(v) => set('vendor_ids', v)} label={p.kind === 'vendor' ? 'Vendor (one or several)' : 'Only these vendors (optional)'} />
            <CategoryPick categories={categories.data ?? []} value={p.categories} onChange={(v) => set('categories', v)} label={p.kind === 'vendor' ? 'Only these categories (optional)' : 'Category'} />
          </div>
          <div className="space-y-4">
            <FormField label="Stores" htmlFor="r-stores">
              <Select id="r-stores" value={p.store_mode} onChange={(e) => { const m = e.target.value as StoreMode; setP((x) => ({ ...x, store_mode: m, store_codes: m === 'one' ? [x.store_codes[0] ?? storeCodes[0] ?? ''] : storeCodes })) }}>
                <option value="together">All stores together (one Sold and one In Stock column)</option>
                <option value="separate">All stores kept apart (a Sold and In Stock column per store)</option>
                <option value="one">One store</option>
              </Select>
              {p.store_mode === 'one' ? (
                <Select value={p.store_codes[0] ?? ''} onChange={(e) => set('store_codes', [e.target.value])} className="mt-2" aria-label="Which store">
                  {(stores.data ?? []).map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                </Select>
              ) : <p className="mt-1 text-xs text-stone-500">{storeCodes.join(', ') || '…'}. SLH is a separate Lightspeed account and is not included.</p>}
            </FormField>
            <FormField label="Period" htmlFor="r-days">
              <Select id="r-days" value={p.days ? String(p.days) : 'range'} onChange={(e) => { const v = e.target.value; if (v === 'range') set('days', null); else setP((x) => ({ ...x, days: Number(v), from: daysAgoIso(Number(v)), to: todayIso() })) }}>
                <option value="365">Last 12 months (365 days)</option>
                <option value="180">Last 6 months</option>
                <option value="90">Last 90 days</option>
                <option value="730">Last 24 months</option>
                <option value="range">A date range</option>
              </Select>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input type="date" value={p.from} onChange={(e) => setP((x) => ({ ...x, from: e.target.value, days: null }))} aria-label="From" />
                <Input type="date" value={p.to} onChange={(e) => setP((x) => ({ ...x, to: e.target.value, days: null }))} aria-label="To" />
              </div>
            </FormField>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
          {canRun ? <Button onClick={run} loading={running}><Play className="size-4" aria-hidden="true" />Run the report</Button> : <span className="text-sm text-stone-500">Admins, managers and buyers run reports.</span>}
          <span className="text-sm text-stone-600">{reportName(p, vendors.data ?? []) || 'Pick a vendor or a category'}</span>
          {canRun ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name these settings" className="h-9 w-48 text-sm" aria-label="Preset name" />
              <Button variant="secondary" size="sm" onClick={savePreset}><Save className="size-4" aria-hidden="true" />Save settings</Button>
            </span>
          ) : null}
        </div>
        {last ? (
          <Alert variant="success" className="mt-4">
            <span className="font-medium">{last.file.name}</span> is filed{last.run.document_id ? ' under the vendor' : ' under Reports'} and downloaded.
            {' '}<button type="button" onClick={() => download(last.file)} className="underline">Download again</button>
            {last.run.sales_report_id ? <> · <Link to={ROUTES.workingOrders} className="underline">Suggested order</Link></> : null}
          </Alert>
        ) : null}
      </section>

      {(presets.data ?? []).length ? (
        <section className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">Saved settings</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {(presets.data ?? []).map((pr) => (
              <li key={pr.id} className="inline-flex items-center overflow-hidden rounded-lg border border-stone-200 text-sm">
                <button type="button" onClick={() => { const q = pr.params as unknown as ReportParams; setPreset((x) => ({ n: (x?.n ?? 0) + 1, params: { ...DEFAULT_PARAMS, ...q, from: q.days ? daysAgoIso(q.days) : q.from, to: q.days ? todayIso() : q.to } })); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="px-3 py-1.5 font-medium text-stone-800 hover:bg-stone-50">{pr.name}</button>
                {canRun ? <button type="button" onClick={() => { if (window.confirm(`Delete the saved settings “${pr.name}”?`)) void deleteReportPreset(pr.id).then(() => setTick((t) => t + 1)) }} className="border-l border-stone-200 px-2 py-1.5 text-stone-400 hover:text-red-700" title="Delete" aria-label={`Delete ${pr.name}`}><Trash2 className="size-3.5" aria-hidden="true" /></button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white">
        <h2 className="px-4 py-3 text-sm font-semibold text-stone-900">Reports run</h2>
        {runs.isLoading ? <Spinner label="Loading…" className="m-4 text-brand" /> : <RunsTable runs={runs.data ?? []} />}
      </section>
    </div>
  )
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function VendorPick({ vendors, value, onChange, label }: { vendors: LsVendorChoice[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [q, setQ] = useState('')
  const matches = q.trim() ? vendors.filter((v) => `${v.name} ${v.vendor_name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12) : []
  const chosen = value.map((id) => vendors.find((v) => v.ls_vendor_id === id)).filter((v): v is LsVendorChoice => !!v)
  return (
    <FormField label={label} htmlFor="r-vendor">
      {chosen.length ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {chosen.map((v) => <li key={v.ls_vendor_id}><Badge tone="brand">{v.vendor_name ?? v.name}<button type="button" onClick={() => onChange(value.filter((x) => x !== v.ls_vendor_id))} className="ml-1 opacity-70 hover:opacity-100" aria-label={`Remove ${v.name}`}>×</button></Badge></li>)}
        </ul>
      ) : null}
      {(
        <div className="relative">
          <Input id="r-vendor" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a vendor name" autoComplete="off" />
          {matches.length ? (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
              {matches.map((v) => (
                <li key={v.ls_vendor_id}>
                  <button type="button" onClick={() => { onChange([...value, v.ls_vendor_id]); setQ('') }} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-stone-50">
                    <span>{v.name}</span>{v.vendor_name && v.vendor_name !== v.name ? <span className="text-xs text-stone-500">{v.vendor_name} in VMS</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </FormField>
  )
}

function CategoryPick({ categories, value, onChange, label }: { categories: { category_path: string; items: number }[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [q, setQ] = useState('')
  // every rung is a choice: "FOOTWEAR/HIKING" covers everything under it
  const paths = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of categories) {
      const rungs = rungsOf(c.category_path)
      for (let i = 1; i <= rungs.length; i++) { const k = rungs.slice(0, i).join('/'); m.set(k, (m.get(k) ?? 0) + Number(c.items)) }
    }
    return [...m].map(([path, items]) => ({ path, items })).sort((a, b) => a.path.localeCompare(b.path))
  }, [categories])
  const matches = q.trim() ? paths.filter((c) => c.path.toLowerCase().includes(q.trim().toLowerCase()) && !value.includes(c.path)).slice(0, 15) : []
  return (
    <FormField label={label} htmlFor="r-category" hint="A category includes everything under it.">
      {value.length ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {value.map((c) => <li key={c}><Badge tone="brand">{c}<button type="button" onClick={() => onChange(value.filter((x) => x !== c))} className="ml-1 opacity-70 hover:opacity-100" aria-label={`Remove ${c}`}>×</button></Badge></li>)}
        </ul>
      ) : null}
      <div className="relative">
        <Input id="r-category" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type part of a category: FOOTWEAR/HIKING, KIDS" autoComplete="off" />
        {matches.length ? (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
            {matches.map((c) => (
              <li key={c.path}>
                <button type="button" onClick={() => { onChange([...value, c.path]); setQ('') }} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-stone-50">
                  <span>{c.path}</span><span className="text-xs text-stone-500">{c.items} items</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </FormField>
  )
}

function RunsTable({ runs }: { runs: ReportRun[] }) {
  const { sorted, sort, toggle } = useTableSort(runs, {
    when: (r) => r.created_at,
    title: (r) => r.title,
    kind: (r) => r.kind,
    file: (r) => r.file_name,
  }, { descFirst: ['when'] })
  async function open(r: ReportRun) {
    try { const blob = await downloadRunFile(r); download(new File([blob], r.file_name)) } catch (e) { toast.error(errorMessage(e)) }
  }
  if (!runs.length) return <p className="px-4 pb-4 text-sm text-stone-500">No reports run yet.</p>
  return (
    <table className="w-full text-sm">
      <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
        <tr>
          <SortHeader label="When" sortKey="when" sort={sort} onSort={toggle} className="px-4 py-2" />
          <SortHeader label="Report" sortKey="title" sort={sort} onSort={toggle} className="px-3 py-2" />
          <SortHeader label="Kind" sortKey="kind" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
          <SortHeader label="File" sortKey="file" sort={sort} onSort={toggle} className="hidden px-3 py-2 lg:table-cell" />
          <th className="px-3 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-100">
        {sorted.map((r) => {
          const s = r.summary as { items?: number; need?: number; flags?: number } | null
          const prm = r.params as unknown as Partial<ReportParams>
          return (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-4 py-2 text-stone-600">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-stone-900">{r.title}</span>
                <span className="block text-xs text-stone-500">{[prm.store_mode === 'one' ? prm.store_codes?.[0] : prm.store_mode === 'separate' ? 'stores kept apart' : 'all stores', prm.days ? `${prm.days} days` : `${prm.from} to ${prm.to}`, s?.items != null ? `${s.items} items` : null, s?.flags ? `${s.flags} flagged` : null].filter(Boolean).join(' · ')}</span>
              </td>
              <td className={cn('hidden px-3 py-2 md:table-cell')}>{r.kind === 'vendor' ? 'Vendor' : r.kind === 'category' ? 'Category' : 'Inventory'}</td>
              <td className="hidden px-3 py-2 text-stone-600 lg:table-cell"><span className="inline-flex items-center gap-1"><FileSpreadsheet className="size-4 text-stone-400" aria-hidden="true" />{r.file_name}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-right"><button type="button" onClick={() => open(r)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-stone-100"><Download className="size-3.5" aria-hidden="true" />Download</button></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
