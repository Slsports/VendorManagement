import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FoldSectionProps {
  title: ReactNode
  /** Short count next to the title, e.g. "142 conversations". Null while loading. */
  summary?: ReactNode
  /** Buttons on the right of the title bar. Clicking them does not open or close the box. */
  actions?: ReactNode
  className?: string
  defaultOpen?: boolean
  /** Set both to open or close the box from outside (e.g. "Add rule" opens it). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

/**
 * A box on a long page that starts closed: just the title bar with a count. Click the bar to open it, again
 * to close it (Dana, Oct 12). What is inside is only drawn while open.
 */
export function FoldSection({ title, summary, actions, className, defaultOpen = false, open: openProp, onOpenChange, children }: FoldSectionProps) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const toggle = () => {
    setOpenState(!open)
    onOpenChange?.(!open)
  }
  return (
    <section className={cn('rounded-2xl border border-stone-200 bg-white', className)}>
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <h2 className="min-w-0 flex-1">
          <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left">
            <ChevronRight className={cn('size-4 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')} aria-hidden="true" />
            <span className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</span>
            {summary != null && summary !== '' ? <span className="text-sm font-normal normal-case text-stone-600">{summary}</span> : null}
          </button>
        </h2>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </section>
  )
}
