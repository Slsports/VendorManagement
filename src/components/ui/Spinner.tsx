import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label ? <span className="text-sm text-stone-600">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  )
}

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <Spinner label={label} className="text-brand" />
    </div>
  )
}
