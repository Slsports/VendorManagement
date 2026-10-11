import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMailboxes } from '@/services/mail'
import { Badge } from '@/components/ui'

/** Personal mailboxes and the old Gmail (Dana, Oct 11): are they syncing, and any error. */
export function MailboxesStatus() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  if (!q.data?.length) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Personal mailboxes and the old Gmail</h2>
      <p className="mt-1 text-xs text-stone-500">Private to each owner and the admin. Personal mailboxes load their last 90 days, then keep up every minute. The old Gmail is what it forwards to oldslsgmail@.</p>
      <ul className="mt-3 divide-y divide-stone-100">
        {q.data.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="font-medium text-stone-900">{b.label}</span>
            <span className="text-stone-500">{b.address}</span>
            {b.kind === 'legacy' ? <Badge tone="neutral">arrives in orders@</Badge>
              : b.last_error ? <Badge tone="danger">Not connected</Badge>
              : b.last_sync_at ? <Badge tone="success">Synced {formatDistanceToNow(new Date(b.last_sync_at), { addSuffix: true })}{b.backfill_done ? '' : ', still loading'}</Badge>
              : <Badge tone="warning">Waiting for its first sync</Badge>}
            {b.last_error ? <p className="w-full text-xs text-red-700">{b.last_error.slice(0, 200)}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
