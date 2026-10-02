import type { Organization } from '@/types'

/**
 * Branding is tenant-driven (spec §11.4). Nothing here is tied to a specific
 * customer: the fallbacks come from environment variables so the deployment at
 * vms.shaverlakesports.com and a future retailhq.ai deployment differ only by
 * configuration.
 */
export interface Branding {
  appName: string
  organizationName: string
  logoUrl: string | null
  accentColor: string
}

export const DEFAULT_BRANDING: Branding = {
  appName: import.meta.env.VITE_APP_NAME?.trim() || 'RetailHQ VMS',
  organizationName: import.meta.env.VITE_ORG_NAME?.trim() || import.meta.env.VITE_APP_NAME?.trim() || 'RetailHQ',
  logoUrl: null,
  // Must match the :root default in index.css and the organizations.accent_color default.
  accentColor: '#2f5d3a',
}

export function brandingFromOrganization(org: Organization | null | undefined): Branding {
  if (!org) return DEFAULT_BRANDING
  return {
    appName: org.app_name?.trim() || `${org.name} VMS`,
    organizationName: org.name,
    logoUrl: org.logo_url,
    accentColor: isHexColor(org.accent_color) ? org.accent_color : DEFAULT_BRANDING.accentColor,
  }
}

/** Push branding into CSS variables and the document title. Safe to call repeatedly. */
export function applyBranding(branding: Branding) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const { accentColor } = branding
  root.style.setProperty('--brand-primary', accentColor)
  root.style.setProperty('--brand-primary-hover', shade(accentColor, -0.18))
  root.style.setProperty('--brand-primary-soft', mix(accentColor, '#ffffff', 0.88))
  root.style.setProperty('--brand-primary-foreground', readableOn(accentColor))
  root.style.setProperty('--brand-ring', accentColor)
  root.style.setProperty('--brand-sidebar', mix(accentColor, '#111111', 0.72))
  document.title = branding.appName
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = accentColor
}

// ---- small color helpers (no dependency) ----

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: [number, number, number]) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** amount in [-1, 1]: negative darkens toward black, positive lightens toward white. */
function shade(hex: string, amount: number) {
  const target = amount < 0 ? '#000000' : '#ffffff'
  return mix(hex, target, Math.abs(amount))
}

/** Mix `hex` toward `target` by `weight` in [0, 1]. */
function mix(hex: string, target: string, weight: number) {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  return rgbToHex([
    a[0] + (b[0] - a[0]) * weight,
    a[1] + (b[1] - a[1]) * weight,
    a[2] + (b[2] - a[2]) * weight,
  ])
}

/** White or near-black text, whichever is readable on the given background. */
function readableOn(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#1c1917' : '#ffffff'
}
