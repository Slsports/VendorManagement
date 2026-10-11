import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import type { Branding } from '@/lib/theme'

const YEAR = new Date().getFullYear()

/** "Shaver Lake Sports Inc." → "Shaver Lake Sports" for the sign-in logo. */
function displayOrgName(name: string) {
  return name.replace(/,?\s+inc\.?$/i, '').trim() || name
}

/** One line of text spread letter by letter to fill its container's width (font size unchanged). */
function SpreadLine({ text, className }: { text: string; className?: string }) {
  return (
    <p aria-label={text} className={cn('flex justify-between whitespace-nowrap', className)}>
      {Array.from(text).map((ch, i) =>
        ch === ' ' ? <span key={i} aria-hidden="true" className="w-[0.28em]" /> : <span key={i} aria-hidden="true">{ch}</span>,
      )}
    </p>
  )
}

/**
 * Sign-in logo: the tenant's mark beside the organization's name, with
 * "Vendor Management System" spread to the same width underneath. Sizes follow the
 * container width, so the two lines stay nearly as tall as the mark on a phone,
 * an iPad or a computer.
 */
function SignInBrand({ branding, onDark = false, className }: { branding: Branding; onDark?: boolean; className?: string }) {
  const logo = onDark ? (branding.logoOnDarkUrl ?? branding.logoUrl) : branding.logoUrl
  return (
    <div className={cn('@container w-full', className)}>
      {/* "Shaver Lake Sports" is ~9.1em wide; with the mark and gap the row is ~11.5em, so 8.2cqw fits with room for wider system fonts. */}
      <div className="flex items-center justify-center gap-[0.45em] text-[clamp(1rem,8.2cqw,3rem)]">
        {logo ? <img src={logo} alt={`${branding.organizationName} logo`} className="h-[2.55em] w-auto shrink-0" /> : null}
        <div className="w-fit min-w-0">
          <p className={cn('whitespace-nowrap font-extrabold leading-[1.05] tracking-tight', onDark ? 'text-white' : 'text-brand')}>
            {displayOrgName(branding.organizationName)}
          </p>
          <SpreadLine
            text="Vendor Management System"
            className={cn('mt-[0.12em] text-[0.62em] font-semibold leading-tight', onDark ? 'text-white/75' : 'text-accent')}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Two-panel layout for sign-in flows: brand panel on large screens, a single
 * centered card on phones and tablets. Branding comes from the tenant theme.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { branding } = useAuth()

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, var(--brand-primary) 0%, transparent 70%), radial-gradient(50% 40% at 90% 90%, var(--brand-accent) 0%, transparent 70%)',
          }}
        />
        <SignInBrand branding={branding} onDark className="relative" />
        <div className="relative space-y-3">
          <h2 className="text-3xl font-semibold leading-tight">Every vendor, every order, one place.</h2>
          <p className="max-w-md text-white/75">
            Track orders from placement to payment, keep vendor contacts current, and know what is arriving at
            each store.
          </p>
        </div>
        <p className="relative text-xs text-white/50">
          © {YEAR} {displayOrgName(branding.organizationName)}
        </p>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
          <div className="w-full max-w-md">
            <SignInBrand branding={branding} className="mb-6 lg:hidden" />
            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
              <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
              {subtitle ? <p className="mt-1.5 text-sm text-stone-600">{subtitle}</p> : null}
              <div className="mt-6">{children}</div>
            </div>
          </div>
        </div>
        <p className="px-6 pb-6 text-center text-xs text-stone-500 lg:hidden">
          © {YEAR} {displayOrgName(branding.organizationName)}
        </p>
      </main>
    </div>
  )
}
