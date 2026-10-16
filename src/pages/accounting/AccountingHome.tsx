import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, CalendarDays, Contact, FileSignature, ListTodo, Mail, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { listMailboxes, listThreads } from '@/services/mail'
import { countAccountingContacts } from '@/services/accounting'
import { listAccountingTasks } from '@/services/tasks'
import { listPolicies, listRecipients } from '@/services/insurance'
import { listContracts, nextPayment } from '@/services/contracts'
import { daysUntil } from '@/lib/insurance'
import { todayLocal } from '@/lib/tasks'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { TaskList } from '@/components/tasks/TaskList'
import { Alert, Badge, Spinner } from '@/components/ui'

/**
 * Accounting home = what am I missing (Dana, Oct 16): overdue and this week's tasks, mail waiting on an answer,
 * people who asked for proof of insurance, policies renewing soon. Then the doors to each part.
 */
export default function AccountingHome() {
  const { organization } = useAuth()
  const org = organization?.id
  const boxes = useSupabaseQuery(async () => (org ? listMailboxes(org) : []), [org])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting')
  const tasks = useTasksQuery(async () => (org ? listAccountingTasks(org, { view: 'open' }) : []), [org])
  const needs = useSupabaseQuery(async () => (org && box ? listThreads(org, undefined, { view: 'attention', who: 'all', status: 'needs', mailbox: box.id }, 50) : []), [org, box?.id])
  const noAnswer = useSupabaseQuery(async () => (org && box ? listThreads(org, undefined, { view: 'attention', who: 'all', status: 'no_answer', mailbox: box.id }, 50) : []), [org, box?.id])
  const contacts = useSupabaseQuery(async () => (org ? countAccountingContacts(org) : null), [org])
  const policies = useSupabaseQuery(async () => (org ? listPolicies(org) : []), [org])
  const recipients = useSupabaseQuery(async () => (org ? listRecipients(org) : []), [org])
  const contracts = useSupabaseQuery(async () => (org ? listContracts(org) : []), [org])

  const today = todayLocal()
  const [week] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })
  const open = tasks.data ?? []
  const overdue = open.filter((t) => t.due_date && t.due_date < today)
  const thisWeek = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= week)
  const asked = (recipients.data ?? []).filter((r) => r.status !== 'ignored' && r.asked_at)
  const toConfirm = (recipients.data ?? []).filter((r) => r.status === 'proposed').length
  const renewing = (policies.data ?? []).filter((p) => { const d = daysUntil(p.renewal_date); return d != null && d <= 45 })
  const quiet = !overdue.length && !thisWeek.length && !(needs.data?.length) && !(noAnswer.data?.length) && !asked.length

  return (
    <div>
      <PageHeader title="Accounting" description="What needs you, then the parts: tasks, calendar, mail, contacts, insurance, procedures. Private to people with the Accounting tick." />
      {boxes.error ? <Alert variant="error">{boxes.error}</Alert> : null}
      {!boxes.isLoading && !box ? <Alert variant="warning">The billing@ mailbox is not connected to VMS yet.</Alert> : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-stone-900">What am I missing?</h2>
        {tasks.isLoading || needs.isLoading ? <div className="py-6"><Spinner label="Looking…" className="text-brand" /></div> : quiet ? (
          <p className="mt-2 text-sm text-stone-600">Nothing overdue, nothing due this week, no mail waiting on you, nobody waiting for proof of insurance.</p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {overdue.length ? <div><h3 className="mb-1 text-sm font-semibold text-red-700">Overdue ({overdue.length})</h3><TaskList tasks={overdue} showWho={false} /></div> : null}
            {thisWeek.length ? <div><h3 className="mb-1 text-sm font-semibold text-amber-700">Due this week ({thisWeek.length})</h3><TaskList tasks={thisWeek} showWho={false} /></div> : null}
            {(needs.data?.length || noAnswer.data?.length) ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-stone-900">Mail</h3>
                <ul className="space-y-1 text-sm">
                  {needs.data?.length ? <li><Link to={`${ROUTES.accountingMail}?status=needs`} className="text-stone-800 hover:text-brand"><span className="font-semibold">{needs.data.length}</span> need an answer</Link></li> : null}
                  {noAnswer.data?.length ? <li><Link to={`${ROUTES.accountingMail}?status=no_answer`} className="text-stone-800 hover:text-brand"><span className="font-semibold">{noAnswer.data.length}</span> waiting on them past the follow-up date</Link></li> : null}
                </ul>
              </div>
            ) : null}
            {asked.length ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-stone-900">Asked for proof of insurance</h3>
                <ul className="space-y-1 text-sm">
                  {asked.map((r) => <li key={r.id}><Link to={`${ROUTES.accountingInsurance}/who/${r.id}`} className="text-stone-800 hover:text-brand">{r.company || r.person || r.email}</Link> <span className="text-stone-500">on {new Date(r.asked_at!).toLocaleDateString()}</span></li>)}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Door to={ROUTES.accountingTasks} icon={ListTodo} title="Tasks" line={`${open.length} open`} sub="Renewals, filings, payments, follow-ups. Each opens its procedure." />
        <Door to={ROUTES.accountingCalendar} icon={CalendarDays} title="Calendar" line="Week, month, year" sub="Everything by the day it is due." />
        <Door to={ROUTES.accountingMail} icon={Mail} title="Mail" line={box ? `${box.messages_synced.toLocaleString()} emails` : 'not connected'} sub={box ? (box.backfill_done ? 'billing@, new mail every minute.' : 'billing@, still bringing in the last 12 months.') : ''}
          badge={box?.last_error ? <Badge tone="danger">Problem</Badge> : undefined} />
        <Door to={ROUTES.accountingContacts} icon={Contact} title="Contacts" line={contacts.data ? `${contacts.data.confirmed} confirmed` : '…'} sub={contacts.data?.proposed ? `${contacts.data.proposed} found in the mail, waiting for you to confirm.` : 'Who you deal with, by category.'} />
        <Door to={ROUTES.accountingInsurance} icon={ShieldCheck} title="Insurance" line={`${(policies.data ?? []).length} policies`} sub={renewing.length ? `${renewing.length} renewing within 45 days.${toConfirm ? ` ${toConfirm} proof requester${toConfirm === 1 ? '' : 's'} to confirm.` : ''}` : toConfirm ? `${toConfirm} proof requester${toConfirm === 1 ? '' : 's'} to confirm.` : 'Policies, renewals, who needs proof.'} />
        <Door to={ROUTES.accountingContracts} icon={FileSignature} title="Contracts" line={`${(contracts.data ?? []).length} on file`} sub={(() => { const next = (contracts.data ?? []).map((c) => ({ c, p: nextPayment(c) })).filter((x) => x.p).sort((a, b) => a.p!.due_on.localeCompare(b.p!.due_on))[0]; return next ? `Next payment: ${next.c.label} on ${new Date(`${next.p!.due_on}T00:00:00`).toLocaleDateString()}.` : 'Licenses, leases, the loan: payments and renewals.' })()} />
        <Door to={ROUTES.accountingProcedures} icon={BookOpen} title="Procedures" line="The handbook" sub="How each job is done, so someone else could do it." />
      </div>
    </div>
  )
}

function Door({ to, icon: Icon, title, line, sub, badge }: { to: string; icon: typeof Mail; title: string; line: string; sub: string; badge?: React.ReactNode }) {
  return (
    <Link to={to} className="rounded-2xl border border-stone-200 bg-white p-4 hover:border-brand hover:shadow-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-semibold text-stone-900"><Icon className="size-4 text-brand" aria-hidden="true" /> {title}</span>
        {badge}
      </span>
      <span className="mt-1 block text-sm font-medium text-stone-800">{line}</span>
      <span className="block text-xs text-stone-500">{sub}</span>
    </Link>
  )
}
