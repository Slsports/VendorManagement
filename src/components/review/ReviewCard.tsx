import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, ChevronDown } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useViewAs } from '@/hooks/useViewAs'
import { listReviewItems } from '@/services/vendors'
import { listOpenChecks } from '@/services/orderChecks'
import { mySnoozes } from '@/services/snooze'
import { REVIEW_TABS, reviewTabOfCheck, reviewTabOfKind, type ReviewTab } from '@/lib/reviews'
import { daysWaitingNow } from '@/lib/orderChecks'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useCardOpen } from '@/hooks/useCardOpen'

const CARD_TABS = REVIEW_TABS.filter((t) => t.id !== 'never')

/**
 * Dashboard (Dana, Oct 12): one Review card in place of "Confirmations & invoices to review" and "Review queue".
 * A count per kind, with how many are with the person the Showing switch is on; click a count to open the Review
 * queue on that tab.
 */
export function ReviewCard() {
  const { organization, profile, role } = useAuth()
  const navigate = useNavigate()
  const { personId, isMe, personName } = useViewAs()
  const canReview = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => {
    if (!organization || !profile || !canReview) return null
    const [items, checks, snoozed] = await Promise.all([listReviewItems(organization.id), listOpenChecks(organization.id, null), mySnoozes(profile.id, 'review')])
    return { items: items.filter((i) => !snoozed.hidden.has(i.id)), checks }
  }, [organization?.id, profile?.id, canReview])

  const counts = new Map<ReviewTab, { all: number; mine: number; late: boolean }>(CARD_TABS.map((t) => [t.id, { all: 0, mine: 0, late: false }]))
  for (const i of q.data?.items ?? []) {
    const c = counts.get(reviewTabOfKind(i.kind))
    if (!c) continue
    c.all++
    if (personId && i.assigned_to === personId) c.mine++
  }
  for (const k of q.data?.checks ?? []) {
    const c = counts.get(reviewTabOfCheck(k))!
    c.all++
    if (personId && k.assigned_to === personId) c.mine++
    if (daysWaitingNow(k.created_at) >= 2) c.late = true
  }
  const withWho = isMe ? 'you' : personName?.split(' ')[0] ?? 'them'
  // the box itself starts closed and stays how the person left it (Dana, Oct 27)
  const [shown, setShown] = useCardOpen('review')

  return (
    <div className="col-span-full rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center">
        <button type="button" onClick={() => setShown((v) => !v)} aria-expanded={shown} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left hover:bg-stone-50">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900"><ClipboardCheck className="size-4 text-brand" aria-hidden="true" /> Review</h3>
          <span className="flex shrink-0 items-center gap-2">
            <span className={cn('text-2xl font-semibold tracking-tight', q.isLoading ? 'text-stone-300' : [...counts.values()].some((c) => c.late) ? 'text-red-700' : 'text-stone-900')}>{q.isLoading ? '…' : [...counts.values()].reduce((n, c) => n + c.all, 0)}</span>
            <ChevronDown className={cn('size-4 text-stone-400 transition-transform', shown && 'rotate-180')} aria-hidden="true" />
          </span>
        </button>
        {canReview && shown ? <button type="button" onClick={() => navigate(ROUTES.review)} className="shrink-0 pr-5 text-xs font-medium text-brand hover:underline">Open the review queue</button> : null}
      </div>
      {!shown ? null : !canReview ? <p className="border-t border-stone-100 px-5 pb-4 pt-2 text-sm text-stone-600">Admins, managers and buyers settle the review queue.</p> : (
        <div className="grid grid-cols-4 items-start gap-1 border-t border-stone-100 p-3 md:grid-cols-7">
          {CARD_TABS.map((t) => {
            const c = counts.get(t.id)!
            return (
              <button key={t.id} type="button" onClick={() => navigate(`${ROUTES.review}?tab=${t.id}`)} title={t.help}
                className="rounded-xl px-2 py-2 text-center hover:bg-stone-50">
                <span className={cn('block text-2xl font-semibold tracking-tight', q.isLoading ? 'text-stone-300' : c.mine ? 'text-amber-600' : c.late ? 'text-red-700' : 'text-stone-900')}>{q.isLoading ? '…' : c.all}</span>
                <span className="block text-xs text-stone-600">{t.label}</span>
                {c.mine ? <span className="block text-[11px] font-semibold text-amber-700">{c.mine} with {withWho}</span> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
