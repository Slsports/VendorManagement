import { Link } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to={ROUTES.dashboard} className="text-sm font-medium text-brand hover:underline">
        Go to the dashboard
      </Link>
    </div>
  )
}
