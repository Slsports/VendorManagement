import { useEffect, useRef, useState } from 'react'
import { Building2, FileText, Search, User, Users, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { parseShortcuts, type MailFilters } from '@/lib/mailSearch'
import { searchMail, suggestMail, type MailSuggestion } from '@/services/mailSearch'
import { cn } from '@/lib/utils'
import { Alert, Spinner } from '@/components/ui'
import { ThreadTable } from './ThreadTable'

const KIND_ICON = { person: User, vendor: Building2, rep_group: Users, order: FileText } as const
const KIND_WORD = { person: 'People', vendor: 'Vendors', rep_group: 'Rep groups', order: 'Orders' } as const

/**
 * The mail search box (Dana, Oct 21): type names, addresses, vendors, words, a PO or a file name. Suggestions come up as
 * you type (people, vendors, rep groups, orders); picking one shows all mail with it. Filter buttons sit underneath.
 */
export function MailSearchBar({ filters, onChange, placeholder, showDirection = true }: {
  filters: MailFilters; onChange: (f: MailFilters) => void; placeholder?: string; showDirection?: boolean
}) {
  const [text, setText] = useState(filters.q)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const box = useRef<HTMLDivElement>(null)
  // a new search from outside (Clear, Back) shows its words in the box
  const [shownQ, setShownQ] = useState(filters.q)
  if (shownQ !== filters.q) { setShownQ(filters.q); setText(filters.q) }
  // ask for suggestions a moment after typing stops
  useEffect(() => { const t = window.setTimeout(() => setTyped(text), 250); return () => window.clearTimeout(t) }, [text])
  const sug = useSupabaseQuery(async () => (open && typed.trim().length >= 2 ? suggestMail(typed) : []), [open, typed])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function submit() {
    const { q, filters: extra } = parseShortcuts(text)
    onChange({ ...filters, ...extra, q })
    setOpen(false)
  }
  function pick(s: MailSuggestion) {
    const next: MailFilters = { ...filters, q: '' }
    if (s.kind === 'person') { next.with = s.address ?? undefined; next.withName = s.label }
    else if (s.kind === 'vendor') { next.vendorId = s.id; next.vendorName = s.label }
    else if (s.kind === 'rep_group') { next.repGroupId = s.id; next.repGroupName = s.label }
    else { next.orderId = s.id; next.orderName = s.label }
    setText('')
    setOpen(false)
    onChange(next)
  }
  const set = (patch: Partial<MailFilters>) => onChange({ ...filters, ...patch })
  const groups = (['person', 'vendor', 'rep_group', 'order'] as const).map((k) => ({ k, list: (sug.data ?? []).filter((s) => s.kind === k) })).filter((g) => g.list.length)

  const chip = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium'
  const on = 'border-brand bg-brand-soft text-brand'
  const off = 'border-stone-200 bg-white text-stone-600 hover:text-stone-900'
  type Chip = { key: string; label: string; clear: Partial<MailFilters> }
  const picked = ([
    filters.with ? { key: 'with', label: `With ${filters.withName || filters.with}`, clear: { with: undefined, withName: undefined } } : null,
    filters.vendorId ? { key: 'vendor', label: `Vendor: ${filters.vendorName || 'picked'}`, clear: { vendorId: undefined, vendorName: undefined } } : null,
    filters.repGroupId ? { key: 'rg', label: `Rep group: ${filters.repGroupName || 'picked'}`, clear: { repGroupId: undefined, repGroupName: undefined } } : null,
    filters.orderId ? { key: 'order', label: filters.orderName || 'Order', clear: { orderId: undefined, orderName: undefined } } : null,
    filters.from ? { key: 'from', label: `From: ${filters.from}`, clear: { from: undefined } } : null,
    filters.to ? { key: 'to', label: `To: ${filters.to}`, clear: { to: undefined } } : null,
    filters.since && !filters.days ? { key: 'since', label: `After ${filters.since}`, clear: { since: undefined } } : null,
    filters.until ? { key: 'until', label: `Before ${filters.until}`, clear: { until: undefined } } : null,
  ] as (Chip | null)[]).filter((x): x is Chip => !!x)

  return (
    <div className="mb-4 space-y-2">
      <div ref={box} className="relative">
        <form onSubmit={(e) => { e.preventDefault(); submit() }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" value={text} onFocus={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value && filters.q) onChange({ ...filters, q: '' }) }}
            placeholder={placeholder ?? 'Search names, email addresses, vendors, words, PO or file names…'} aria-label="Search mail" autoComplete="off"
            className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm" />
        </form>
        {open && text.trim().length >= 2 ? (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg" role="listbox" aria-label="Suggestions">
            <button type="button" onClick={submit} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50">
              <Search className="size-4 text-stone-400" aria-hidden="true" />Search all mail for <span className="font-medium">"{text.trim()}"</span>
            </button>
            {groups.map((g) => (
              <div key={g.k} className="border-t border-stone-100">
                <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{KIND_WORD[g.k]}</p>
                {g.list.map((s) => {
                  const Icon = KIND_ICON[s.kind]
                  return (
                    <button key={`${s.kind}-${s.id}-${s.address ?? ''}`} type="button" role="option" aria-selected="false" onClick={() => pick(s)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-stone-50">
                      <Icon className="size-4 shrink-0 text-stone-400" aria-hidden="true" />
                      <span className="min-w-0 truncate"><span className="font-medium text-stone-900">{s.label}</span>
                        {s.address && s.address !== s.label ? <span className="text-stone-500"> · {s.address}</span> : null}
                        {s.sub ? <span className="text-stone-500"> · {s.sub}</span> : null}</span>
                    </button>
                  )
                })}
              </div>
            ))}
            {sug.isLoading ? <p className="border-t border-stone-100 px-3 py-2 text-xs text-stone-400">Looking…</p> : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {picked.map((c) => (
          <button key={c.key} type="button" onClick={() => set(c.clear)} className={cn(chip, on)} aria-label={`Remove ${c.label}`}>{c.label}<X className="size-3" aria-hidden="true" /></button>
        ))}
        <button type="button" onClick={() => set({ attach: filters.attach === 'yes' ? undefined : 'yes', file: filters.attach === 'yes' ? undefined : filters.file })} className={cn(chip, filters.attach === 'yes' ? on : off)}>Has attachment</button>
        <button type="button" onClick={() => set({ attach: filters.attach === 'no' ? undefined : 'no', file: undefined })} className={cn(chip, filters.attach === 'no' ? on : off)}>No attachment</button>
        {(['pdf', 'sheet', 'picture'] as const).map((k) => (
          <button key={k} type="button" onClick={() => set({ file: filters.file === k ? undefined : k, attach: filters.file === k ? filters.attach : 'yes' })} className={cn(chip, filters.file === k ? on : off)}>{k === 'pdf' ? 'PDF' : k === 'sheet' ? 'Spreadsheet' : 'Pictures'}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-stone-200" aria-hidden="true" />
        {(['7', '30', '90'] as const).map((d) => (
          <button key={d} type="button" onClick={() => set({ days: filters.days === d ? undefined : d, since: undefined })} className={cn(chip, filters.days === d ? on : off)}>Last {d} days</button>
        ))}
        <label className={cn(chip, filters.since && !filters.days ? on : off)}>From date
          <input type="date" value={filters.days ? '' : filters.since ?? ''} onChange={(e) => set({ since: e.target.value || undefined, days: undefined })} className="w-28 bg-transparent text-xs" aria-label="From date" />
        </label>
        <label className={cn(chip, filters.until ? on : off)}>To date
          <input type="date" value={filters.until ?? ''} onChange={(e) => set({ until: e.target.value || undefined })} className="w-28 bg-transparent text-xs" aria-label="To date" />
        </label>
        {showDirection ? (
          <>
            <span className="mx-1 h-4 w-px bg-stone-200" aria-hidden="true" />
            <button type="button" onClick={() => set({ dir: filters.dir === 'in' ? undefined : 'in' })} className={cn(chip, filters.dir === 'in' ? on : off)}>Received</button>
            <button type="button" onClick={() => set({ dir: filters.dir === 'out' ? undefined : 'out' })} className={cn(chip, filters.dir === 'out' ? on : off)}>Sent</button>
          </>
        ) : null}
        <span className="mx-1 h-4 w-px bg-stone-200" aria-hidden="true" />
        {(['confirmation', 'invoice', 'shipping', 'artwork'] as const).map((k) => (
          <button key={k} type="button" onClick={() => set({ found: filters.found === k ? undefined : k })} className={cn(chip, filters.found === k ? on : off)}
            title="What Claude found in the email">{k === 'confirmation' ? 'Confirmation' : k === 'invoice' ? 'Invoice' : k === 'shipping' ? 'Shipping notice' : 'Artwork'}</button>
        ))}
      </div>
    </div>
  )
}

/** Search results: the conversations that match, each opening the exact email that matched, with why. */
export function MailSearchResults({ organizationId, filters, scope, showVendor = true, showContact = false, onClear }: {
  organizationId: string; filters: MailFilters; scope?: { box?: string; vendorId?: string; dir?: 'in' | 'out' }; showVendor?: boolean; showContact?: boolean; onClear: () => void
}) {
  const key = JSON.stringify([filters, scope])
  const q = useSupabaseQuery(() => searchMail(organizationId, filters, scope), [organizationId, key])
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner label="Searching…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const rows = q.data?.rows ?? []
  return (
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
        {rows.length ? `${rows.length >= 200 ? 'The newest 200' : rows.length} conversation${rows.length === 1 ? '' : 's'} found.` : 'Nothing found. Try fewer words or another filter.'}
        <button type="button" onClick={onClear} className="font-medium text-brand hover:underline">Clear the search</button>
      </p>
      {rows.length ? <ThreadTable rows={rows} showVendor={showVendor} showContact={showContact} matches={q.data?.matches} onChanged={q.refetch} /> : null}
    </div>
  )
}
