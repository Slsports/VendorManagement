import { useId, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorNames } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'

const MAX = 8

/**
 * The search bar at the top of every page (Dana, Oct 8): matching vendors drop down as you type; click one
 * or press Enter to open it. The last row searches everything (orders, invoices…) as before.
 */
export function TopSearch() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [wanted, setWanted] = useState(false)
  const listId = useId()
  // Loaded the first time someone types (shared with the vendor pickers).
  const vendors = useSupabaseQuery(async () => (organization && wanted ? listVendorNames(organization.id) : []), [organization?.id, wanted])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return []
    const all = vendors.data ?? []
    const hit = all.filter((v) => v.name.toLowerCase().includes(q))
    const rank = (n: string) => (n.toLowerCase().startsWith(q) ? 0 : n.toLowerCase().split(/[\s\-&/]+/).some((w) => w.startsWith(q)) ? 1 : 2)
    return hit.sort((a, b) => Number(!a.is_active) - Number(!b.is_active) || rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)).slice(0, MAX)
  }, [vendors.data, q])
  const rows = matches.length + 1 // the last row: search everything

  function go(i: number) {
    setOpen(false)
    const v = matches[i]
    if (v) { setQuery(''); navigate(`${ROUTES.vendors}/${v.id}`) }
    else if (q) navigate(`${ROUTES.search}?q=${encodeURIComponent(query.trim())}`)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (q) go(active)
  }

  return (
    <form onSubmit={submit} role="search" className="relative hidden min-w-0 flex-1 sm:block sm:max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && !!q}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onFocus={() => { setWanted(true); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); setWanted(true); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Search vendors, orders, invoices…"
        aria-label="Search"
        className="h-10 w-full rounded-lg border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-ring-brand"
      />
      {open && q ? (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg">
          {vendors.isLoading ? <li className="px-3 py-2 text-stone-500">Loading vendors…</li> : null}
          {matches.map((v, i) => (
            <li key={v.id} role="option" aria-selected={active === i} onMouseDown={(e) => { e.preventDefault(); go(i) }}
              className={cn('flex cursor-pointer items-center justify-between gap-2 px-3 py-2', active === i && 'bg-stone-100', v.is_active ? 'text-stone-900' : 'text-stone-400')}>
              <span className="truncate">{v.name}</span>
              <span className="shrink-0 text-xs text-stone-400">{v.is_active ? 'Vendor' : 'Inactive vendor'}</span>
            </li>
          ))}
          <li role="option" aria-selected={active === matches.length} onMouseDown={(e) => { e.preventDefault(); go(matches.length) }}
            className={cn('flex cursor-pointer items-center gap-2 border-t border-stone-100 px-3 py-2 text-brand', active === matches.length && 'bg-stone-100')}>
            <Search className="size-4" aria-hidden="true" />Search everything for “{query.trim()}”
          </li>
        </ul>
      ) : null}
    </form>
  )
}
