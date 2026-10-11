import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listReviewItems } from '@/services/vendors'
import { mySnoozes } from '@/services/snooze'
import { ORDER_VIEW_LABELS, type OrderView } from '@/services/orders'
import { ROUTES } from '@/lib/constants'
import { MailForYouPanel } from '@/components/mail/MailForYouPanel'
import { FreightForYouPanel } from '@/components/freight/FreightForYouPanel'
import { WorkingOrdersPanel } from '@/components/mail/WorkingOrdersPanel'
import { FreightAllowancePanel } from '@/components/orders/FreightAllowancePanel'
import { ArtApprovalsPanel } from '@/components/mail/ArtApprovalsPanel'
import { PaperworkPanel } from '@/components/orders/PaperworkPanel'
import { useViewAs } from '@/hooks/useViewAs'
import { DashboardCards } from '@/components/dashboard/DashboardCards'
import { CountCard } from '@/components/dashboard/CountCard'
import { OrderCountCard } from '@/components/dashboard/OrderCountCard'

// The order number boxes (ids kept from the first dashboard so saved layouts still match).
const ORDER_BOXES: { id: string; view: OrderView }[] = [
  { id: 'kpi_open_orders', view: 'open' },
  { id: 'kpi_overdue_orders', view: 'overdue' },
  { id: 'kpi_payments_due', view: 'payments_due' },
  { id: 'kpi_future_dated_orders', view: 'future' },
]

const PANELS = [
  { title: 'Recent activity', phase: 3, text: 'Who changed what, across vendors, orders and payments.' },
] as const

export default function DashboardPage() {
  const { profile, organization, role } = useAuth()
  const first = profile?.full_name?.split(' ')[0]
  const canReview = role === 'admin' || role === 'manager' || role === 'buyer'
  // my snoozed review items do not count until they come back (Dana, Oct 9)
  const reviewQ = useSupabaseQuery(async () => {
    if (!organization || !canReview || !profile) return []
    const [items, snoozed] = await Promise.all([listReviewItems(organization.id), mySnoozes(profile.id, 'review')])
    return items.filter((i) => !snoozed.hidden.has(i.id))
  }, [organization?.id, canReview, profile?.id])
  const pending = reviewQ.data?.length ?? 0
  const { personId, isMe, personName } = useViewAs()
  const mine = (reviewQ.data ?? []).filter((i) => i.assigned_to === (personId ?? profile?.id)).length
  const whose = isMe ? 'to you' : personId ? `to ${personName?.split(' ')[0] ?? 'them'}` : null

  return (
    <div>
      <DashboardCards
        title={first ? `Good to see you, ${first}` : 'Dashboard'}
        description="Each box shows how many; click it to see them."
        items={[
        // each box is a count; click it for the orders (Dana, Oct 11)
        ...ORDER_BOXES.map((v) => ({ id: v.id, label: ORDER_VIEW_LABELS[v.view].title, size: 'tile' as const, node: <OrderCountCard view={v.view} /> })),
        { id: 'mail', label: 'Mail for you', node: <MailForYouPanel /> },
        { id: 'paperwork', label: 'Confirmations & invoices to review', node: <PaperworkPanel /> },
        { id: 'art', label: 'Artwork approvals', node: <ArtApprovalsPanel /> },
        { id: 'working', label: "Orders I'm working on", node: <WorkingOrdersPanel /> },
        { id: 'freight_allowance', label: 'Freight allowances', node: <FreightAllowancePanel /> },
        { id: 'review', label: 'Review queue', node: (
          <CountCard title="Review queue" count={canReview ? (whose ? mine : pending) : null} loading={reviewQ.isLoading}>
            {canReview ? (
              <>
                <p className="text-sm text-stone-600">{pending ? `${pending} item${pending === 1 ? '' : 's'} waiting for a decision${whose && mine ? `, ${mine} assigned ${whose}` : ''}.` : 'Nothing waiting. Imports, the mailbox and the vendor form add items here.'}</p>
                <Link to={ROUTES.review} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Open the review queue</Link>
              </>
            ) : <p className="text-sm text-stone-600">Admins, managers and buyers settle the review queue.</p>}
          </CountCard>
        ) },
        { id: 'recent_activity', label: 'Recent activity', node: <PlaceholderPanel p={PANELS[0]} /> },
        { id: 'freight', label: 'Freight', node: <FreightForYouPanel /> },
      ]} />
    </div>
  )
}

function PlaceholderPanel({ p }: { p: (typeof PANELS)[number] }) {
  return (
    <CountCard title={p.title} count={null}>
      <p className="text-sm text-stone-600">{p.text}</p>
      <p className="mt-1 text-xs text-stone-400">Coming in phase {p.phase}</p>
    </CountCard>
  )
}
