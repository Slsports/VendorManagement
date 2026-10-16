import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMailboxes } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Spinner } from '@/components/ui'

/**
 * Accounting (Dana, Oct 16; docs/accounting-plan.md): her bookkeeping in one place, seen only by people with the
 * Accounting tick. Step 1 is the private billing@ mailbox; mail views, filing, contacts, bills and tasks follow.
 */
export default function AccountingHome() {
  const { organization } = useAuth()
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting')

  return (
    <div>
      <PageHeader title="Accounting" description="Bookkeeping mail, documents, bills, contacts and tasks. Private: only people with the Accounting tick see any of it." />
      {boxes.error ? <Alert variant="error">{boxes.error}</Alert> : null}
      {boxes.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div> : null}
      {!boxes.isLoading && !box ? <Alert variant="warning">The billing@ mailbox is not connected to VMS yet.</Alert> : null}
      {box ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900"><Mail className="size-4 text-brand" aria-hidden="true" /> {box.address}</h2>
              <p className="mt-1 text-sm text-stone-600">
                {box.messages_synced.toLocaleString()} emails in VMS
                {box.last_sync_at ? ` · last checked ${new Date(box.last_sync_at).toLocaleString()}` : ''}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {box.backfill_done ? 'The last 12 months are in; new mail arrives every minute.' : 'Bringing in the last 12 months. This runs on its own and takes a while for a big mailbox.'}
              </p>
              {box.last_error ? <p className="mt-1 text-xs text-red-700">Last problem: {box.last_error}</p> : null}
            </div>
            <Badge tone={box.last_error ? 'danger' : box.backfill_done ? 'success' : 'info'}>{box.last_error ? 'Problem' : box.backfill_done ? 'Up to date' : 'Importing'}</Badge>
          </div>
          <Link to={`${ROUTES.mail}?box=${box.id}`} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open the billing@ mail</Link>
        </section>
      ) : null}
      <section className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
        <h2 className="font-semibold text-stone-800">Being built, in this order</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Mail views for billing@ (Needs an answer, Waiting, Documents, Other) and the contacts list.</li>
          <li>Automatic filing of every document into its folder, plus a drop box for the files on your computer.</li>
          <li>Bills that are not vendor invoices, with due dates and paid status.</li>
          <li>Accounting tasks, reminders, the "what am I missing" page and a calendar.</li>
        </ol>
      </section>
    </div>
  )
}
