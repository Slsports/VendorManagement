import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'block w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-base text-stone-900 shadow-sm placeholder:text-stone-400 sm:text-sm',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand disabled:bg-stone-50',
        className,
      )}
      {...rest}
    />
  )
}
