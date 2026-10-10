import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SortState } from '@/hooks/useTableSort'

/** A clickable column header: click to sort, click again to reverse; the arrow shows the current sort. */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
  title,
}: {
  label: ReactNode
  sortKey: K
  sort: SortState<K> | null
  onSort: (key: K) => void
  align?: 'left' | 'center' | 'right'
  className?: string
  title?: string
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th scope="col" className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'group inline-flex items-center gap-1 uppercase tracking-wide hover:text-stone-900',
          align === 'right' && 'flex-row-reverse',
          active && 'text-stone-900',
        )}
      >
        {label}
        <Icon className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-30 group-hover:opacity-70')} aria-hidden="true" />
      </button>
    </th>
  )
}

/** For card lists with no headers: a "Sort by" picker and a direction toggle backed by the same hook. */
export function SortPicker<K extends string>({
  options,
  sort,
  onChange,
  defaultLabel = 'Default order',
}: {
  options: { key: K; label: string }[]
  sort: SortState<K> | null
  onChange: (next: SortState<K> | null) => void
  defaultLabel?: string
}) {
  const Icon = sort?.dir === 'desc' ? ArrowDown : ArrowUp
  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor="sort-picker">Sort by</label>
      <select
        id="sort-picker"
        value={sort?.key ?? ''}
        onChange={(e) => onChange(e.target.value ? { key: e.target.value as K, dir: sort?.dir ?? 'asc' } : null)}
        className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm"
      >
        <option value="">Sort: {defaultLabel}</option>
        {options.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
      </select>
      {sort ? (
        <button
          type="button"
          onClick={() => onChange({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          className="inline-flex size-11 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-600 shadow-sm hover:text-stone-900"
          aria-label={sort.dir === 'asc' ? 'Sorted ascending, click to reverse' : 'Sorted descending, click to reverse'}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
