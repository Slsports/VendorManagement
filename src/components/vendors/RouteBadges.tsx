import { Badge } from '@/components/ui'
import { BILLING_ROUTE_LABELS, BILLING_ROUTE_TONE, PAY_METHOD_LABELS } from '@/lib/vendors'
import type { BillingRoute } from '@/types'

export function RouteBadges({ routes, emptyLabel = 'No route yet' }: { routes: { route: BillingRoute; is_default?: boolean; pay_method?: 'card' | 'ach' | null }[]; emptyLabel?: string | null }) {
  if (routes.length === 0) return emptyLabel ? <span className="text-xs text-stone-400">{emptyLabel}</span> : null
  const sorted = routes.slice().sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default))
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sorted.map((r) => (
        <Badge key={r.route} tone={BILLING_ROUTE_TONE[r.route]} className={r.is_default ? 'ring-1 ring-inset ring-current/30' : ''}>
          {BILLING_ROUTE_LABELS[r.route]}{r.pay_method ? ` · ${PAY_METHOD_LABELS[r.pay_method]}` : ''}
        </Badge>
      ))}
    </span>
  )
}
