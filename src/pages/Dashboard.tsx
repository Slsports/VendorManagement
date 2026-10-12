import { useAuth } from '@/hooks/useAuth'
import { ORDER_VIEW_LABELS, type OrderView } from '@/services/orders'
import { MailForYouPanel } from '@/components/mail/MailForYouPanel'
import { FreightForYouPanel } from '@/components/freight/FreightForYouPanel'
import { ArtApprovalsPanel } from '@/components/mail/ArtApprovalsPanel'
import { ReviewCard } from '@/components/review/ReviewCard'
import { useViewAs } from '@/hooks/useViewAs'
import { DashboardCards } from '@/components/dashboard/DashboardCards'
import { CountCard } from '@/components/dashboard/CountCard'
import { OrderCountCard } from '@/components/dashboard/OrderCountCard'
import { TasksCard } from '@/components/tasks/TasksCard'
import { OrderingCard } from '@/components/ordering/OrderingCard'
import { TaskNotices } from '@/components/tasks/TaskNotices'

// The order number boxes (ids kept from the first dashboard so saved layouts still match).
// Open and Overdue now live on the Ordering card (Dana, Oct 12); Payments due and Future-dated stay boxes.
const ORDER_BOXES: { id: string; view: OrderView }[] = [
  { id: 'kpi_payments_due', view: 'payments_due' },
  { id: 'kpi_future_dated_orders', view: 'future' },
]

const PANELS = [
  { title: 'Recent activity', phase: 3, text: 'Who changed what, across vendors, orders and payments.' },
] as const

export default function DashboardPage() {
  const { profile } = useAuth()
  const first = profile?.full_name?.split(' ')[0]
  const { isMe } = useViewAs()
  return (
    <div>
      <DashboardCards
        title={first ? `Good to see you, ${first}` : 'Dashboard'}
        description="Each box shows how many; click it to see them."
        top={isMe ? <TaskNotices /> : null}
        items={[
        // each box is a count; click it for the orders (Dana, Oct 11)
        ...ORDER_BOXES.map((v) => ({ id: v.id, label: ORDER_VIEW_LABELS[v.view].title, size: 'tile' as const, node: <OrderCountCard view={v.view} /> })),
        { id: 'ordering', label: 'Ordering', node: <OrderingCard /> },
        // one Review card for paperwork checks and the review queue (Dana, Oct 12)
        { id: 'review', label: 'Review', node: <ReviewCard /> },
        { id: 'tasks', label: 'My tasks', node: <TasksCard /> },
        { id: 'mail', label: 'Mail for you', node: <MailForYouPanel /> },
        { id: 'art', label: 'Artwork approvals', node: <ArtApprovalsPanel /> },
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
