import { Badge } from '@/components/ui'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/constants'

const TONE: Record<OrderStatus, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = {
  open: 'warning',
  awaiting_confirmation: 'warning',
  confirmed: 'info',
  shipped: 'info',
  received: 'info',
  entered: 'brand',
  ready_to_pay: 'warning',
  paid: 'success',
  cancelled: 'neutral',
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
}
