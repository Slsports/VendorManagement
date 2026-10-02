import toast from 'react-hot-toast'
import { LogOut, Store as StoreIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABELS } from '@/lib/constants'
import { errorMessage, initials } from '@/lib/utils'
import { BrandMark } from '@/components/layout/BrandMark'
import { Button } from '@/components/ui'

/**
 * Phase 1 placeholder. Phase 2 replaces this with the AppShell (sidebar, topbar,
 * store selector) and the real dashboard. For now it proves auth, profile, RLS
 * and store access end to end.
 */
export default function DashboardPage() {
  const { profile, organization, stores, role, branding, signOut } = useAuth()

  async function handleSignOut() {
    try {
      await signOut()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark branding={branding} size="sm" />
            <div>
              <p className="font-semibold leading-tight">{branding.appName}</p>
              <p className="text-xs text-stone-500">{organization?.legal_name ?? branding.organizationName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="hidden size-9 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand sm:inline-flex"
            >
              {initials(profile?.full_name || profile?.email)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void handleSignOut()} leftIcon={<LogOut className="size-4" aria-hidden="true" />}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-stone-600">
            Signed in as <span className="font-medium text-stone-900">{profile?.email}</span>
            {role ? (
              <>
                {' '}
                · <span className="rounded-md bg-brand-soft px-2 py-0.5 text-sm font-medium text-brand">{ROLE_LABELS[role]}</span>
              </>
            ) : null}
          </p>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            <StoreIcon className="size-4" aria-hidden="true" /> Your stores
          </h2>
          {stores.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">
              No stores have been assigned to you yet. Ask an administrator to grant store access.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {stores.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3">
                  <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-brand px-2 text-sm font-bold text-brand-foreground">
                    {s.code}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="text-xs text-stone-500">
                      {[s.city, s.state].filter(Boolean).join(', ') || 'No address on file'}
                      {!s.is_active ? ' · inactive' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-sm text-stone-500">
          Phase 1 is complete when you can sign in and see your stores here. Navigation, vendors and orders arrive in
          the next phases.
        </p>
      </main>
    </div>
  )
}
