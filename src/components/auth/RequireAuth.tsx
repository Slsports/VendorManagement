import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { Alert, Button, FullScreenLoader } from '@/components/ui'

/** Gate for authenticated routes. Redirects to /login and remembers where the user was going. */
export function RequireAuth() {
  const { session, isLoading, profileError, signOut } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullScreenLoader label="Signing you in…" />
  if (!session) return <Navigate to={ROUTES.login} replace state={{ from: location }} />

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <Alert variant="error" title="We couldn't open your account">
            {profileError}
          </Alert>
          <Button variant="secondary" fullWidth onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  return <Outlet />
}

/** Wrapper for public auth pages: a signed-in user is sent to the app instead. */
export function PublicOnly() {
  const { session, isLoading, passwordRecoveryPending } = useAuth()
  const location = useLocation()
  if (isLoading) return <FullScreenLoader />
  if (session) {
    if (passwordRecoveryPending) return <Navigate to={ROUTES.resetPassword} replace />
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    return <Navigate to={from && from !== ROUTES.login ? from : ROUTES.dashboard} replace />
  }
  return <Outlet />
}
