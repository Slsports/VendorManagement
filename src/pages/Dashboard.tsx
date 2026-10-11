import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, CalendarClock, ClipboardCheck, Inbox, ShoppingCart } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listReviewItems } from '@/services/vendors'
import { mySnoozes } from '@/services/snooze'
import { countOrdersByStatus } from '@/services/orders'
import { ROUTES } from '@/lib/constants'
import { MailForYouPanel } from '@/components/mail/MailForYouPanel'
import { FreightForYouPanel } from '@/components/freight/FreightForYouPanel'
import { WorkingOrdersPanel } from '@/components/mail/WorkingOrdersPanel'
import { FreightAllowancePanel } from '@/components/orders/FreightAllowancePanel'
import { ArtApprovalsPanel } from '@/components/mail/ArtApprovalsPanel'
import { PaperworkPanel } from '@/components/orders/PaperworkPanel'
import { useViewAs } from '@/hooks/useViewAs'
import { DashboardCards } from '@/components/dashboard/DashboardCards'

const KPIS = [
  { label: 'Open orders', icon: ShoppingCart, phase: 4 },
  { label: 'Overdue orders', icon: AlertTriangle, phase: 4 },
  { label: 'Payments due', icon: Banknote, phase: 5 },
  { label: 'Future-dated orders', icon: CalendarClock, phase: 4 },
] as const

const PANELS = [
  // two separate cards (Dana, Oct 11)
  { title: 'Future-dated orders', phase: 4, text: 'Pre-bookings shipping more than 30 days out.' },
  { title: 'Recent activity', phase: 3, text: 'Who changed what, across vendors, orders and payments.' },
  { title: 'Overdue orders', phase: 4, text: 'Orders 30 days past their quoted ship date.' },
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
  const ordersQ = useSupabaseQuery(async (): Promise<Record<string, number>> => (organization ? countOrdersByStatus(organization.id) : {}), [organization?.id])
  const openOrders = (ordersQ.data?.open ?? 0) + (ordersQ.data?.awaiting_confirmation ?? 0) + (ordersQ.data?.confirmed ?? 0) + (ordersQ.data?.shipped ?? 0)
  const awaitingPayment = (ordersQ.data?.entered ?? 0) + (ordersQ.data?.ready_to_pay ?? 0)

  return (
    <div>
      <DashboardCards
        title={first ? `Good to see you, ${first}` : 'Dashboard'}
        description="The numbers below go live as each phase lands. Navigation, roles and the shell are in place now."
        items={[...KPIS.map(({ label, icon: Icon, phase }) => ({ id: `kpi_${label.toLowerCase().replace(/[^a-z]+/g, '_')}`, label, size: 'tile' as const, node: (
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-600">{label}</p>
              <Icon className="size-5 text-stone-400" aria-hidden="true" />
            </div>
            {label === 'Open orders' ? <p className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">{ordersQ.data ? openOrders : '—'}</p> : label === 'Payments due' ? <p className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">{ordersQ.data ? awaitingPayment : '—'}</p> : <p className="mt-3 text-3xl font-semibold tracking-tight text-stone-300">—</p>}
            {label === 'Open orders' ? <p className="mt-1 text-xs text-stone-400">placed, not yet received</p> : label === 'Payments due' ? <p className="mt-1 text-xs text-stone-400">entered, not yet paid</p> : <p className="mt-1 text-xs text-stone-400">Live in Phase {phase}</p>}
          </div>
        ) })),
        { id: 'mail', label: 'Mail for you', node: <MailForYouPanel /> },
        { id: 'paperwork', label: 'Confirmations & invoices to review', node: <PaperworkPanel /> },
        { id: 'art', label: 'Artwork approvals', node: <ArtApprovalsPanel /> },
        { id: 'working', label: "Orders I'm working on", node: <WorkingOrdersPanel /> },
        { id: 'freight_allowance', label: 'Freight allowances', node: <FreightAllowancePanel /> },
        { id: 'review', label: 'Review queue', node: (
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-stone-900">Review queue</h2>
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-stone-50 p-4">
              <ClipboardCheck className={pending ? 'mt-0.5 size-5 shrink-0 text-amber-500' : 'mt-0.5 size-5 shrink-0 text-stone-400'} aria-hidden="true" />
              <div>
                {canReview ? (
                  <>
                    <p className="text-sm text-stone-600">
                      {reviewQ.isLoading ? 'Checking…' : pending ? `${pending} item${pending === 1 ? '' : 's'} waiting for a decision${whose && mine ? `, ${mine} assigned ${whose}` : ''}.` : 'Nothing waiting. Imports, the mailbox and the vendor form add items here.'}
                    </p>
                    <Link to={ROUTES.review} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Open the review queue</Link>
                  </>
                ) : (
                  <p className="text-sm text-stone-600">Admins, managers and buyers settle the review queue.</p>
                )}
              </div>
            </div>
          </div>
        ) },
        { id: 'recent_activity', label: 'Recent activity', node: <PlaceholderPanel p={PANELS[1]} /> },
        { id: 'freight', label: 'Freight', node: <FreightForYouPanel /> },
        { id: 'overdue_orders', label: 'Overdue orders', node: <PlaceholderPanel p={PANELS[2]} /> },
        { id: 'future_orders', label: 'Future-dated orders', node: <PlaceholderPanel p={PANELS[0]} /> },
      ]} />
    </div>
  )
}

function PlaceholderPanel({ p }: { p: (typeof PANELS)[number] }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-stone-900">{p.title}</h2>
      <div className="mt-4 flex items-start gap-3 rounded-xl bg-stone-50 p-4">
        <Inbox className="mt-0.5 size-5 shrink-0 text-stone-400" aria-hidden="true" />
        <div>
          <p className="text-sm text-stone-600">{p.text}</p>
          <p className="mt-1 text-xs text-stone-400">Phase {p.phase}</p>
        </div>
      </div>
    </div>
  )
}
