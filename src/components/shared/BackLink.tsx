import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useHasInAppHistory } from '@/hooks/useHasInAppHistory'
import { cn } from '@/lib/utils'

/**
 * The one way out of a detail page (screen rules, Oct 7): back to wherever you came from, with that
 * page's filters intact. On a cold open (bookmark, pasted link, new tab) it goes to `fallback` instead.
 */
export function BackLink({ fallback, fallbackLabel, className }: { fallback: string; fallbackLabel: string; className?: string }) {
  const navigate = useNavigate()
  const hasHistory = useHasInAppHistory()
  const cls = cn('mb-3 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900', className)
  const icon = <ArrowLeft className="size-4" aria-hidden="true" />
  if (!hasHistory) return <Link to={fallback} className={cls}>{icon} {fallbackLabel}</Link>
  return (
    <button type="button" onClick={() => navigate(-1)} className={cls}>
      {icon} Back
    </button>
  )
}
