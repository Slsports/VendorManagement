import { Mountain } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Branding } from '@/lib/theme'

const SIZES = {
  sm: { box: 'h-8 rounded-lg', square: 'size-8 rounded-lg', icon: 'size-4', maxW: 'max-w-14' },
  md: { box: 'h-11 rounded-xl', square: 'size-11 rounded-xl', icon: 'size-6', maxW: 'max-w-24' },
  lg: { box: 'h-16 rounded-2xl', square: 'size-14 rounded-2xl', icon: 'size-7', maxW: 'max-w-36' },
} as const

/**
 * Tenant logo on a white tile (so it reads on dark panels), or a neutral mark in
 * the brand color when no logo is configured. Wide logos keep their aspect ratio.
 */
export function BrandMark({ branding, className, size = 'md' }: { branding: Branding; className?: string; size?: keyof typeof SIZES }) {
  const s = SIZES[size]
  if (branding.logoUrl) {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center bg-white p-1', s.box, s.maxW, className)}>
        <img src={branding.logoUrl} alt={`${branding.organizationName} logo`} className="h-full w-auto object-contain" />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center bg-brand text-brand-foreground', s.square, className)}>
      <Mountain className={s.icon} />
    </span>
  )
}
