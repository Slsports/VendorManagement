import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'error' | 'success' | 'info' | 'warning'

const styles: Record<Variant, { box: string; Icon: typeof Info }> = {
  error: { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertCircle },
  success: { box: 'border-green-200 bg-green-50 text-green-800', Icon: CheckCircle2 },
  info: { box: 'border-sky-200 bg-sky-50 text-sky-800', Icon: Info },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', Icon: TriangleAlert },
}

export function Alert({
  variant = 'info',
  title,
  children,
  className,
}: {
  variant?: Variant
  title?: string
  children?: ReactNode
  className?: string
}) {
  const { box, Icon } = styles[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  )
}
