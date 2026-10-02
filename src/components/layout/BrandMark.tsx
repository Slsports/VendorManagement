import { Mountain } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Branding } from '@/lib/theme'

/** Tenant logo if one is configured, otherwise a neutral mark in the brand color. */
export function BrandMark({ branding, className, size = 'md' }: { branding: Branding; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-14 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-11 rounded-xl'
  const icon = size === 'lg' ? 'size-7' : size === 'sm' ? 'size-4' : 'size-6'
  if (branding.logoUrl) {
    return (
      <img
        src={branding.logoUrl}
        alt={`${branding.organizationName} logo`}
        className={cn(box, 'object-contain bg-white', className)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(box, 'inline-flex items-center justify-center bg-brand text-brand-foreground', className)}
    >
      <Mountain className={icon} />
    </span>
  )
}
