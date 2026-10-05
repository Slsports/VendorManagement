import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { BrandMark } from './BrandMark'

const YEAR = new Date().getFullYear()

/**
 * Two-panel layout for sign-in flows: brand panel on large screens, a single
 * centered card on phones and tablets. Branding comes from the tenant theme.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { branding } = useAuth()

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="relative hidden w-[42%] max-w-xl flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, var(--brand-primary) 0%, transparent 70%), radial-gradient(50% 40% at 90% 90%, var(--brand-accent) 0%, transparent 70%)',
          }}
        />
        <div className="relative flex items-center gap-4">
          <BrandMark branding={branding} size="lg" />
          <div>
            <p className="text-lg font-semibold leading-tight">{branding.appName}</p>
            <p className="text-sm text-white/70">{branding.organizationName}</p>
          </div>
        </div>
        <div className="relative space-y-3">
          <h2 className="text-3xl font-semibold leading-tight">Every vendor, every order, one place.</h2>
          <p className="max-w-md text-white/75">
            Track orders from placement to payment, keep vendor contacts current, and know what is arriving at
            each store.
          </p>
        </div>
        <p className="relative text-xs text-white/50">
          © {YEAR} {branding.organizationName}
        </p>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 px-6 pt-8 lg:hidden">
          <BrandMark branding={branding} size="sm" />
          <p className="font-semibold">{branding.appName}</p>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
              <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
              {subtitle ? <p className="mt-1.5 text-sm text-stone-600">{subtitle}</p> : null}
              <div className="mt-6">{children}</div>
            </div>
          </div>
        </div>
        <p className="px-6 pb-6 text-center text-xs text-stone-500 lg:hidden">
          © {YEAR} {branding.organizationName}
        </p>
      </main>
    </div>
  )
}
