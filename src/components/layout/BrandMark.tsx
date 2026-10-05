import { Mountain } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Branding } from '@/lib/theme'

const SIZES = {
  sm: { box: 'h-8 rounded-lg', bare: 'h-9', square: 'size-8 rounded-lg', icon: 'size-4', maxW: 'max-w-14' },
  md: { box: 'h-11 rounded-xl', bare: 'h-12', square: 'size-11 rounded-xl', icon: 'size-6', maxW: 'max-w-24' },
  lg: { box: 'h-16 rounded-2xl', bare: 'h-20', square: 'size-14 rounded-2xl', icon: 'size-7', maxW: 'max-w-36' },
} as const

/**
 * Tenant logo. On dark surfaces the dark-variant logo (usually white on
 * transparent) is drawn directly; otherwise the standard logo sits on a white
 * tile so it reads anywhere. Falls back to a neutral mark in the brand color.
 */
export function BrandMark({
  branding,
  className,
  size = 'md',
  onDark = false,
}: {
  branding: Branding
  className?: string
  size?: keyof typeof SIZES
  onDark?: boolean
}) {
  const s = SIZES[size]
  const alt = `${branding.organizationName} logo`
  if (onDark && branding.logoOnDarkUrl) {
    return <img src={branding.logoOnDarkUrl} alt={alt} className={cn('w-auto shrink-0 object-contain', s.bare, s.maxW, className)} />
  }
  if (branding.logoUrl) {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center bg-white p-1', s.box, s.maxW, className)}>
        <img src={branding.logoUrl} alt={alt} className="h-full w-auto object-contain" />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center bg-brand text-brand-foreground', s.square, className)}>
      <Mountain className={s.icon} />
    </span>
  )
}
