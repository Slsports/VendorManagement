import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Minimal accessible dropdown: click to toggle, click outside or Escape to close.
 * The trigger receives aria-expanded/aria-controls; the panel is a plain region
 * so callers can put menus, forms or lists inside.
 */
export function Dropdown({
  trigger,
  children,
  align = 'right',
  panelClassName,
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void; 'aria-expanded': boolean; 'aria-controls': string; 'aria-haspopup': true }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  panelClassName?: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)
  const toggle = () => setOpen((v) => !v)

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle, 'aria-expanded': open, 'aria-controls': panelId, 'aria-haspopup': true })}
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label={label}
          className={cn(
            'absolute z-40 mt-2 min-w-56 rounded-xl border border-stone-200 bg-white p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  )
}
