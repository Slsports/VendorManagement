import { threadState, THREAD_STATE_LABELS, SHIP_STATUS_LABELS } from '@/lib/mail'
import type { EmailThreadStatus } from '@/types'
import type { ShipStatus } from '@/services/mail'
import { Badge } from '@/components/ui'

/** Where a conversation stands, and a shipment's status when a carrier reported one (Delivered…). */
export function ThreadStatusBadge({ thread }: { thread: { status: EmailThreadStatus; follow_up_at: string | null; ship_status?: ShipStatus | null } }) {
  const s = THREAD_STATE_LABELS[threadState(thread)]
  const ship = thread.ship_status ? SHIP_STATUS_LABELS[thread.ship_status] : null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ship ? <Badge tone={ship.tone}>{ship.label}</Badge> : null}
      {ship && thread.status === 'handled' ? null : <Badge tone={s.tone}>{s.label}</Badge>}
    </span>
  )
}
