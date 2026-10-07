import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Tags } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listLines } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortPicker } from '@/components/shared/SortHeader'
import { useTableSort } from '@/hooks/useTableSort'
import { LineCard } from '@/components/lines/LineCard'
import { Alert, Select, Spinner } from '@/components/ui'

/** Every line we know of: what reps carry and what Worldwide shows listed. Catalogs to look at, not vendors. */
export default function LinesPage() {
  const { role, organization } = useAuth()
  const navigate = useNavigate()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const group = params.get('group') ?? ''
  const show = params.get('show') ?? ''
  const only = params.get('only') ?? 'lines'
  const [draft, setDraft] = useState(search)
  const q = useSupabaseQuery(async () => (organization ? listLines(organization.id) : []), [organization?.id])

  const groups = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of q.data ?? []) if (l.rep_group) m.set(l.rep_group.id, l.rep_group.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [q.data])
  const shows = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of q.data ?? []) for (const s of l.show_appearances) m.set(s.show_code, s.show_label)
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [q.data])

  const rows = useMemo(() => {
    let list = q.data ?? []
    const s = search.trim().toLowerCase()
    if (s) list = list.filter((l) => l.name.toLowerCase().includes(s) || l.rep_group?.name.toLowerCase().includes(s) || l.show_appearances.some((a) => a.exhibitor?.toLowerCase().includes(s) || a.booth === s))
    if (group) list = list.filter((l) => l.rep_group?.id === group)
    if (show) list = list.filter((l) => l.show_appearances.some((a) => a.show_code === show))
    if (only === 'lines') list = list.filter((l) => !l.matched_vendor_id)
    else if (only === 'vendors') list = list.filter((l) => !!l.matched_vendor_id)
    return list
  }, [q.data, search, group, show, only])

  const { sorted, sort, setSort } = useTableSort(rows, {
    name: (l) => l.name,
    rep: (l) => l.rep_group?.name,
    show: (l) => l.show_appearances.map((a) => a.show_code).sort().at(-1),
  }, { descFirst: ['show'] })

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading lines…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const total = q.data?.length ?? 0
  const catalogOnly = q.data?.filter((l) => !l.matched_vendor_id).length ?? 0

  return (
    <div>
      <PageHeader
        title="Lines"
        description={`${total} lines on file: ${catalogOnly} catalogs to look at, ${total - catalogOnly} already vendors. From rep line lists and Worldwide show listings.`}
      />
      <form onSubmit={(e) => { e.preventDefault(); setParam('q', draft.trim()) }} className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search a line, rep group, exhibitor or booth…" aria-label="Search lines" className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm" />
        </div>
        <Select value={group} onChange={(e) => setParam('group', e.target.value)} aria-label="Rep group" className="lg:w-56">
          <option value="">Any rep group</option>
          {groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <Select value={show} onChange={(e) => setParam('show', e.target.value)} aria-label="Show" className="lg:w-56">
          <option value="">Any show</option>
          {shows.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </Select>
        <SortPicker sort={sort} onChange={setSort} options={[{ key: 'name', label: 'Name' }, { key: 'rep', label: 'Rep group' }, { key: 'show', label: 'Latest show' }]} />
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1" role="group" aria-label="Which lines">
          {([['lines', 'Catalogs only'], ['vendors', 'Already vendors'], ['all', 'All']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setParam('only', v)} className={cn('rounded-md px-3 py-1.5 text-sm', only === v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{label}</button>
          ))}
        </div>
      </form>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
          <Tags className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">Nothing matches.</p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.slice(0, 300).map((l) => <LineCard key={l.id} line={l} canEdit={canEdit} showRepGroup onPromoted={(id) => navigate(`${ROUTES.vendors}/${id}`)} />)}
        </ul>
      )}
      {rows.length > 300 ? <p className="mt-3 text-sm text-stone-500">Showing the first 300 of {rows.length}. Narrow the search to see the rest.</p> : null}
    </div>
  )
}
