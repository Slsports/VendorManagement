import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'block h-11 w-full appearance-none rounded-lg border border-stone-300 bg-white pl-3.5 pr-10 text-base text-stone-900 shadow-sm sm:text-sm',
          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand disabled:bg-stone-50 disabled:text-stone-500',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
    </div>
  )
}
