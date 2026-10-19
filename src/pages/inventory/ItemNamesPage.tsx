import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { RotateCcw, Send } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { NAME_TABS, changeKind, checkName, classifyNames, lsContext, proposedName, type NameRow, type NameTab } from '@/lib/itemNames'
import { decideItemNames, listItemNameChanges, listLsItemNames, listNameVendors, sendItemNamesNow, undoItemNames, type NameDecision } from '@/services/itemNames'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, Input, Select, Spinner } from '@/components/ui'

const PAGE = 200

/**
 * Item names (Trevor's SOP-INV-001-NC, Dana Oct 19). Every active LS item's name, checked against the SOP. Trevor
 * approves the fixes; VMS sends them to LS (every 2 minutes, or **Send now**), keeping any * or ** marker, and puts the
 * ones that change what the name says on his shelf-tag task. Nothing changes in LS without the click.
 */
export default function ItemNamesPage() {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [params, setParams] = useSearchParams()
  const tab = (NAME_TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'quick') as NameTab
  const vendorFilter = params.get('vendor') ?? ''
  const catFilter = params.get('cat') ?? ''
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)

  const itemsQ = useSupabaseQuery(async () => (organization ? listLsItemNames(organization.id) : []), [organization?.id])
  const vendorsQ = useSupabaseQuery(async () => (organization ? listNameVendors(organization.id) : []), [organization?.id])
  const changesQ = useSupabaseQuery(async () => (organization ? listItemNameChanges(organization.id) : []), [organization?.id])

  const data = useMemo(() => classifyNames(itemsQ.data ?? [], vendorsQ.data ?? [], changesQ.data ?? []), [itemsQ.data, vendorsQ.data, changesQ.data])
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
    setPicked(new Set())
    setShown(PAGE)
  }

  const vendorOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data.rows) if (r.vendor) m.set(r.vendor.id, r.vendor.name)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.rows])
  const cats = useMemo(() => [...new Set(data.rows.map((r) => top(r.item.category_path)).filter(Boolean))].sort(), [data.rows])

  const inFilter = (r: NameRow) =>
    (!vendorFilter || r.vendor?.id === vendorFilter) &&
    (!catFilter || top(r.item.category_path) === catFilter) &&
    (!search || r.item.description.toUpperCase().includes(search.toUpperCase()) || (r.item.vendor_item_id ?? '').toUpperCase().includes(search.toUpperCase()))
  const filtered = data.rows.filter(inFilter)
  const inTab = filtered.filter((r) => r.tabs.includes(tab))
  const counts = Object.fromEntries(NAME_TABS.map((t) => [t.key, filtered.filter((r) => r.tabs.includes(t.key)).length])) as Record<NameTab, number>

  const nameOf = (r: NameRow) => edits.get(r.item.item_id) ?? proposedName(r, tab)
  const { sorted, sort, toggle } = useTableSort(inTab, {
    vendor: (r) => r.vendor?.name ?? '',
    name: (r) => r.item.description,
    length: (r) => nameOf(r).length,
  }, { descFirst: ['length'] })
  const page = sorted.slice(0, shown)

  /** Is the new name one another LS item already has? */
  const taken = (r: NameRow, name: string) => name.trim().toUpperCase() !== r.item.description.trim().toUpperCase() && data.names.has(name.trim().toUpperCase())

  const decisionFor = (r: NameRow): NameDecision | null => {
    const name = nameOf(r).trim().toUpperCase()
    if (!name || name === r.item.description || taken(r, name)) return null
    const k = changeKind(r.item.description, name)
    return { ls_item_id: r.item.item_id, old_name: r.item.description, new_name: name, kind: k === 'content' ? 'content' : 'cosmetic', vendor_id: r.vendor?.id ?? null }
  }

  async function refresh() {
    await Promise.all([changesQ.refetch(), itemsQ.refetch()])
    setPicked(new Set())
    setEdits(new Map())
  }

  async function approve(rows: NameRow[]) {
    if (!organization) return
    const items = rows.map(decisionFor).filter((d): d is NameDecision => !!d)
    if (!items.length) { toast.error('Nothing to send: the names are the same, empty or already used by another item'); return }
    setBusy(true)
    try {
      const n = await decideItemNames(organization.id, items)
      const run = await sendItemNamesNow().catch((e: unknown) => ({ sent: 0, failed: 0, waiting: n, error: errorMessage(e) }))
      if (run.error) toast.error(run.error)
      const tags = items.filter((i) => i.kind === 'content').length
      toast.success(`${n} approved${run.sent ? `, ${run.sent} already in Lightspeed` : ''}${run.waiting ? `; ${run.waiting} more go in the next few minutes` : ''}${tags ? `. ${tags} need a new shelf tag (on the shelf-tag task)` : ''}`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function leave(rows: NameRow[]) {
    if (!organization) return
    setBusy(true)
    try {
      const n = await decideItemNames(organization.id, rows.map((r) => ({ ls_item_id: r.item.item_id, old_name: r.item.description, vendor_id: r.vendor?.id ?? null })), true)
      toast.success(`${n} left as they are`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function undo(rows: NameRow[]) {
    setBusy(true)
    try {
      const n = await undoItemNames(rows.map((r) => r.change?.id).filter((x): x is string => !!x))
      toast.success(`${n} taken back`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendNow() {
    setBusy(true)
    try {
      const run = await sendItemNamesNow()
      if (run.error) toast.error(run.error)
      else toast.success(`${run.sent} sent to Lightspeed${run.failed ? `, ${run.failed} not taken (see below)` : ''}${run.waiting ? `; ${run.waiting} still waiting` : ''}`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const loading = itemsQ.isLoading || vendorsQ.isLoading || changesQ.isLoading
  const error = itemsQ.error ?? vendorsQ.error ?? changesQ.error
  const pickedRows = inTab.filter((r) => picked.has(r.item.item_id))
  const allPicked = page.length > 0 && page.every((r) => picked.has(r.item.item_id))
  const waiting = (changesQ.data ?? []).filter((c) => c.status === 'approved' || c.status === 'sending').length
  const failed = (changesQ.data ?? []).filter((c) => c.status === 'failed').length
  const editable = tab === 'quick' || tab === 'vendor_id' || tab === 'look'
  const info = NAME_TABS.find((t) => t.key === tab)!

  return (
    <div>
      <PageHeader
        title="Item names"
        description="Every active Lightspeed item name checked against Trevor's naming SOP (SOP-INV-001-NC). Approve the fixes and VMS changes them in Lightspeed. Any * or ** stays as it is."
        actions={canEdit ? (
          <Button variant="secondary" loading={busy} leftIcon={<Send className="size-4" aria-hidden="true" />} onClick={() => void sendNow()} disabled={!waiting}>
            Send now{waiting ? ` (${waiting})` : ''}
          </Button>
        ) : null}
      />

      {loading ? <div className="flex justify-center py-16"><Spinner label="Checking every item name…" className="text-brand" /></div> : error ? <Alert variant="error">{error}</Alert> : (
        <>
          {failed ? <Alert variant="warning" className="mb-4">{failed} {failed === 1 ? 'name was' : 'names were'} not taken by Lightspeed. See <button type="button" className="font-semibold underline" onClick={() => setParam('tab', 'waiting')}>Sent / waiting</button>.</Alert> : null}

          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Select aria-label="Vendor" className="h-9 w-56" value={vendorFilter} onChange={(e) => setParam('vendor', e.target.value)}>
              <option value="">All vendors</option>
              {vendorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
            <Select aria-label="Category" className="h-9 w-48" value={catFilter} onChange={(e) => setParam('cat', e.target.value)}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input aria-label="Search names" placeholder="Search name or Vendor ID" className="h-9 w-64" value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE) }} />
          </div>

          <div className="mb-3 flex flex-wrap gap-1 border-b border-stone-200" role="tablist">
            {NAME_TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setParam('tab', t.key === 'quick' ? '' : t.key)}
                className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t.key ? 'border-brand text-brand' : 'border-transparent text-stone-600 hover:text-stone-900')}>
                {t.label} <span className="ml-1 rounded-full bg-stone-100 px-1.5 text-xs text-stone-600">{counts[t.key].toLocaleString()}</span>
              </button>
            ))}
          </div>
          <p className="mb-3 text-sm text-stone-600">{info.hint}</p>

          {canEdit && editable && inTab.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button size="sm" loading={busy} disabled={!pickedRows.length} onClick={() => void approve(pickedRows)}>Approve and send {pickedRows.length || ''}</Button>
              <Button size="sm" variant="secondary" loading={busy} disabled={!pickedRows.length} onClick={() => void leave(pickedRows)}>Leave {pickedRows.length || ''} as is</Button>
              {tab === 'quick' ? <Button size="sm" variant="ghost" loading={busy} onClick={() => void approve(inTab)}>Approve all {inTab.length.toLocaleString()} shown</Button> : null}
            </div>
          ) : null}
          {canEdit && (tab === 'waiting' || tab === 'left') && pickedRows.length ? (
            <div className="mb-3"><Button size="sm" variant="secondary" loading={busy} leftIcon={<RotateCcw className="size-3.5" aria-hidden="true" />} onClick={() => void undo(pickedRows.filter((r) => r.change && r.change.status !== 'sending'))}>Take back {pickedRows.length}</Button></div>
          ) : null}

          {!inTab.length ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-600">Nothing here{vendorFilter || catFilter || search ? ' for this filter' : ''}.</p> : (
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <tr>
                    {canEdit ? <th className="w-8 px-3 py-2.5"><input type="checkbox" className="size-4 accent-brand" aria-label="Pick all shown" checked={allPicked}
                      onChange={(e) => setPicked(e.target.checked ? new Set(page.map((r) => r.item.item_id)) : new Set())} /></th> : null}
                    <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2.5" />
                    <SortHeader label="Name in Lightspeed" sortKey="name" sort={sort} onSort={toggle} className="px-3 py-2.5" />
                    <SortHeader label={tab === 'passing' ? 'Length' : 'New name'} sortKey="length" sort={sort} onSort={toggle} className="px-3 py-2.5" />
                    <th className="px-3 py-2.5">{tab === 'waiting' ? 'Lightspeed' : 'What the SOP says'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {page.map((r) => <NameLine key={r.item.item_id} row={r} tab={tab} canEdit={canEdit} name={nameOf(r)} taken={taken(r, nameOf(r))}
                    picked={picked.has(r.item.item_id)} onPick={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(r.item.item_id); else n.delete(r.item.item_id); return n })}
                    onEdit={(v) => setEdits((m) => new Map(m).set(r.item.item_id, v))} />)}
                </tbody>
              </table>
            </div>
          )}
          {sorted.length > shown ? <div className="mt-3 text-center"><Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, sorted.length - shown)} more of {(sorted.length - shown).toLocaleString()}</Button></div> : null}
        </>
      )}
    </div>
  )
}

const top = (path: string | null) => String(path ?? '').split('/')[0]!.trim()

function NameLine({ row: r, tab, canEdit, name, taken, picked, onPick, onEdit }: {
  row: NameRow; tab: NameTab; canEdit: boolean; name: string; taken: boolean; picked: boolean; onPick: (on: boolean) => void; onEdit: (v: string) => void
}) {
  const editable = canEdit && (tab === 'quick' || tab === 'vendor_id' || tab === 'look')
  const ctx = lsContext(r.item, r.vendor)
  const kind = changeKind(r.item.description, name.trim().toUpperCase())
  const still = editable ? checkName(name.trim().toUpperCase(), ctx).filter((p) => p.code !== 'duplicate') : []
  return (
    <tr className={picked ? 'bg-brand/5' : ''}>
      {canEdit ? <td className="px-3 py-2 align-top"><input type="checkbox" className="size-4 accent-brand" checked={picked} aria-label={`Pick ${r.item.description}`} onChange={(e) => onPick(e.target.checked)} /></td> : null}
      <td className="px-3 py-2 align-top text-xs text-stone-600">{r.vendor?.name ?? '—'}<span className="block text-stone-400">{top(r.item.category_path)}</span></td>
      <td className="px-3 py-2 align-top font-mono text-xs text-stone-800">{r.item.description}{r.item.vendor_item_id ? <span className="block font-sans text-stone-400">Vendor ID {r.item.vendor_item_id}</span> : null}</td>
      <td className="px-3 py-2 align-top">
        {tab === 'passing' ? <span className="text-xs text-stone-500">{r.item.description.length}</span> : editable ? (
          <>
            <Input aria-label={`New name for ${r.item.description}`} value={name} onChange={(e) => onEdit(e.target.value)} className={cn('h-8 min-w-80 font-mono text-xs', taken && 'border-red-400')} />
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              <span className={name.trim().length > 52 ? 'text-red-700' : 'text-stone-500'}>{name.trim().length}/52</span>
              {kind === 'content' ? <Badge tone="warning">New shelf tag</Badge> : kind === 'cosmetic' ? <Badge tone="neutral">No new tag</Badge> : null}
              {taken ? <span className="text-red-700">Another LS item has this name</span> : null}
            </div>
          </>
        ) : <span className="font-mono text-xs text-stone-800">{r.change?.new_name}</span>}
      </td>
      <td className="px-3 py-2 align-top text-xs text-stone-700">
        {tab === 'waiting' ? (
          r.change?.status === 'failed' ? <span className="text-red-700">Not taken: {r.change.ls_error}</span>
            : <span>{r.change?.status === 'sending' ? 'Sending…' : 'Waiting to send'}{r.change?.ls_error ? <span className="block text-amber-700">Last try: {r.change.ls_error}</span> : null}</span>
        ) : tab === 'left' ? 'Left as is' : (
          <ul className="list-disc space-y-0.5 pl-4">
            {(editable ? still : r.problems).map((p, i) => <li key={i} className={p.fixable ? 'text-stone-600' : 'text-amber-800'}>{p.text}</li>)}
            {editable && !still.length ? <li className="list-none text-emerald-700">Follows the SOP</li> : null}
          </ul>
        )}
      </td>
    </tr>
  )
}
