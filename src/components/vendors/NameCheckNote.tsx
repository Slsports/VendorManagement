import { Link } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import type { VendorNameCheck } from '@/types'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * After a name or alias is added or removed (Dana, Oct 21), VMS re-checks the old mail and open review cards for it.
 * This line says what it found, with the mail one click away (shown for two weeks after the change: latestNameCheck).
 */
export function NameCheckNote({ check: c }: { check: VendorNameCheck }) {
  const names = [...c.added.map((n) => `"${n}" added`), ...c.removed.map((n) => `"${n}" removed`)].join(', ')
  if (c.status === 'waiting' || c.status === 'working') {
    return <span className="block text-xs text-stone-500">{names}: re-checking the old mail and review cards…</span>
  }
  if (c.status === 'failed') return <span className="block text-xs text-red-700">{names}: the re-check stopped ({c.note ?? 'error'}). Save the vendor again to retry.</span>
  const found = [
    c.emails_named ? `${plural(c.emails_named, 'email')} now name${c.emails_named === 1 ? 's' : ''} this vendor` : null,
    c.emails_unnamed ? `${plural(c.emails_unnamed, 'email')} no longer do${c.emails_unnamed === 1 ? 'es' : ''}` : null,
    c.emails_tagged > 0 ? `${plural(c.emails_tagged, 'email')} from reps or services tagged to it` : null,
    c.cards_updated ? `${plural(c.cards_updated, 'review card')} updated` : null,
  ].filter(Boolean)
  const first = c.added[0]
  return (
    <span className="block text-xs text-stone-500">
      Re-checked {new Date(c.done_at ?? c.created_at).toLocaleDateString()} for {names}: {found.length ? found.join('; ') : c.note ?? 'nothing else matched'}.
      {first ? <> <Link to={`${ROUTES.mail}?q=${encodeURIComponent(first)}`} className="text-brand hover:underline">See the mail</Link></> : null}
      {c.cards_updated ? <> · <Link to={`${ROUTES.review}?tab=who`} className="text-brand hover:underline">Review</Link></> : null}
    </span>
  )
}
