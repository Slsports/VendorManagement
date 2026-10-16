import { Link, Outlet } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { homeRouteForRole } from '@/lib/navigation'

/** The Accounting area (Dana, Oct 16): only people with the Accounting tick on their profile. Admin alone is not enough. */
export function RequireAccounting() {
  const { profile, role } = useAuth()
  if (profile?.sees_accounting) return <Outlet />
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-semibold text-stone-900">Accounting is not open to you</h1>
      <p className="mt-2 text-sm text-stone-600">Dana lets people in under Settings → Users.</p>
      <Link to={homeRouteForRole(role)} className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
        Go back home
      </Link>
    </div>
  )
}
