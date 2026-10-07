import { threadState, THREAD_STATE_LABELS } from '@/lib/mail'
import type { EmailThreadStatus } from '@/types'
import { Badge } from '@/components/ui'

export function ThreadStatusBadge({ thread }: { thread: { status: EmailThreadStatus; follow_up_at: string | null } }) {
  const s = THREAD_STATE_LABELS[threadState(thread)]
  return <Badge tone={s.tone}>{s.label}</Badge>
}
