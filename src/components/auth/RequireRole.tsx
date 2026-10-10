import { Link, Outlet } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { homeRouteForRole } from '@/lib/navigation'
import type { UserRole } from '@/lib/constants'

/** Renders the child routes only for the listed roles; otherwise a friendly "no access" page. */
export function RequireRole({ roles }: { roles: readonly UserRole[] }) {
  const { role } = useAuth()
  if (role && roles.includes(role)) return <Outlet />
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-semibold text-stone-900">You don't have access to this page</h1>
      <p className="mt-2 text-sm text-stone-600">Ask an administrator if you think you should.</p>
      <Link to={homeRouteForRole(role)} className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
        Go back home
      </Link>
    </div>
  )
}
