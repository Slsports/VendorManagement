import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

const baseClasses =
  'block w-full rounded-lg border bg-white px-3.5 text-base text-stone-900 placeholder:text-stone-400 shadow-sm ' +
  'h-11 sm:text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring-brand focus:border-brand ' +
  'disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-500'

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(baseClasses, invalid ? 'border-red-400 focus:ring-red-500 focus:border-red-500' : 'border-stone-300', className)}
      {...rest}
    />
  )
}

/** Password field with a show/hide toggle. */
export function PasswordInput({ className, invalid, ...rest }: InputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        invalid={invalid}
        className={cn('pr-11', className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-stone-500 hover:text-stone-800 focus-visible:outline-none focus-visible:text-brand"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
