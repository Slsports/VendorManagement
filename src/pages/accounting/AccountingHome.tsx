import { Link } from 'react-router-dom'
import { Contact, Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMailboxes, listThreads } from '@/services/mail'
import { countAccountingContacts } from '@/services/accounting'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Spinner } from '@/components/ui'

/**
 * Accounting (Dana, Oct 16; docs/accounting-plan.md): her bookkeeping in one place, seen only by people with the
 * Accounting tick. Mail and contacts are in; filing, bills, tasks and the "what am I missing" view follow.
 */
export default function AccountingHome() {
  const { organization } = useAuth()
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting')
  const needs = useSupabaseQuery(async () => (organization && box ? listThreads(organization.id, undefined, { view: 'attention', who: 'all', status: 'needs', mailbox: box.id }, 50) : []), [organization?.id, box?.id])
  const noAnswer = useSupabaseQuery(async () => (organization && box ? listThreads(organization.id, undefined, { view: 'attention', who: 'all', status: 'no_answer', mailbox: box.id }, 50) : []), [organization?.id, box?.id])
  const contacts = useSupabaseQuery(async () => (organization ? countAccountingContacts(organization.id) : null), [organization?.id])

  return (
    <div>
      <PageHeader title="Accounting" description="Bookkeeping mail, contacts, documents, bills and tasks. Private: only people with the Accounting tick see any of it." />
      {boxes.error ? <Alert variant="error">{boxes.error}</Alert> : null}
      {boxes.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div> : null}
      {!boxes.isLoading && !box ? <Alert variant="warning">The billing@ mailbox is not connected to VMS yet.</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {box ? (
          <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900"><Mail className="size-4 text-brand" aria-hidden="true" /> Mail</h2>
              <Badge tone={box.last_error ? 'danger' : box.backfill_done ? 'success' : 'info'}>{box.last_error ? 'Problem' : box.backfill_done ? 'Up to date' : 'Importing'}</Badge>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              <li><Link to={`${ROUTES.accountingMail}?status=needs`} className="text-stone-800 hover:text-brand"><span className="font-semibold">{needs.data?.length ?? '…'}</span> need an answer</Link></li>
              <li><Link to={`${ROUTES.accountingMail}?status=no_answer`} className="text-stone-800 hover:text-brand"><span className="font-semibold">{noAnswer.data?.length ?? '…'}</span> waiting on them past the follow-up date</Link></li>
            </ul>
            <p className="mt-3 text-xs text-stone-500">
              {box.address} · {box.messages_synced.toLocaleString()} emails in VMS.
              {box.backfill_done ? ' New mail arrives every minute.' : ' Still bringing in the last 12 months.'}
              {box.last_error ? ` Last problem: ${box.last_error}` : ''}
            </p>
            <Link to={ROUTES.accountingMail} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open the mail</Link>
          </section>
        ) : null}
        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900"><Contact className="size-4 text-brand" aria-hidden="true" /> Contacts</h2>
          {contacts.error ? <Alert variant="error" className="mt-2">{contacts.error}</Alert> : (
            <ul className="mt-3 space-y-1 text-sm">
              <li><Link to={`${ROUTES.accountingContacts}?status=proposed`} className="text-stone-800 hover:text-brand"><span className="font-semibold">{contacts.data?.proposed ?? '…'}</span> found in the mail, waiting for you to confirm</Link></li>
              <li><Link to={`${ROUTES.accountingContacts}?status=confirmed`} className="text-stone-800 hover:text-brand"><span className="font-semibold">{contacts.data?.confirmed ?? '…'}</span> confirmed</Link></li>
            </ul>
          )}
          <p className="mt-3 text-xs text-stone-500">Give each one a category (taxes, insurance, banking…) and their mail sorts itself.</p>
          <Link to={ROUTES.accountingContacts} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open contacts</Link>
        </section>
      </div>
      <section className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
        <h2 className="font-semibold text-stone-800">Being built, in this order</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Automatic filing of every document into its folder, plus a drop box for the files on your computer.</li>
          <li>Bills that are not vendor invoices, with due dates and paid status.</li>
          <li>Accounting tasks, reminders, the "what am I missing" page and a calendar.</li>
        </ol>
      </section>
    </div>
  )
}
