import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A dashboard card (Dana, Oct 11: "the cards should not show any data except for the number of items in it. When
 * you click it, the list appears"). Closed: its name and the count. Open: the list, across the whole row.
 */
export function CountCard({ title, count, loading, error, alert, tile, action, children }: {
  title: ReactNode
  /** null = nothing to count yet */
  count: number | null
  loading?: boolean
  error?: string | null
  /** red count: something is late or waiting too long */
  alert?: boolean
  /** a number box (smaller, four to a row) */
  tile?: boolean
  /** a small button beside the count (the task box's +) */
  action?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('rounded-2xl border bg-white shadow-sm', open ? 'col-span-full border-brand/40' : 'border-stone-200')}>
      <div className="flex items-center">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className={cn('flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:bg-stone-50', tile ? 'rounded-2xl p-5' : 'rounded-2xl px-5 py-4')}>
          <span className="min-w-0 text-sm font-semibold text-stone-900">{title}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className={cn('font-semibold tracking-tight', tile ? 'text-3xl' : 'text-2xl', loading || count === null ? 'text-stone-300' : alert && count ? 'text-red-700' : 'text-stone-900')}>
              {loading ? '…' : error ? '!' : count === null ? '—' : count}
            </span>
            <ChevronDown className={cn('size-4 text-stone-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </span>
        </button>
        {action ? <div className="shrink-0 pr-3">{action}</div> : null}
      </div>
      {open ? <div className="border-t border-stone-100 px-5 pb-5 pt-3">{error ? <p className="text-sm text-red-700">{error}</p> : children}</div> : null}
    </div>
  )
}
