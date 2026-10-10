import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface FormFieldProps {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  /** Rendered to the right of the label, e.g. a "Forgot password?" link. */
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function FormField({ label, htmlFor, hint, error, action, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-800">
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-stone-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
