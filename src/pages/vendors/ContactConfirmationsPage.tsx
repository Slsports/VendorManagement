import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { CONFIRM_STATE_LABELS, confirmStates, listConfirmations, prepareConfirmations, saveConfirmEmail, type ConfirmState } from '@/services/vendorConfirmations'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { FoldSection } from '@/components/shared/FoldSection'
import { Alert, Badge, Button, FormField, Input, Spinner, Textarea } from '@/components/ui'

type Show = 'all' | 'waiting' | 'confirmed' | 'bounced' | 'drafts'

/**
 * Contact confirmations (Dana, Oct 13): the "please confirm your contact info" emails — one per person at the vendors we
 * buy from, prepared in Mail › Drafts — and who answered: confirmed (with or without changes), waiting, bounced.
 */
export default function ContactConfirmationsPage() {
  const { organization, role, refreshProfile } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listConfirmations(organization.id) : []), [organization?.id])
  const states = useSupabaseQuery(async () => (organization ? confirmStates(organization.id) : new Map<string, ConfirmState>()), [organization?.id])
  const [show, setShow] = useState<Show>('all')
  const [busy, setBusy] = useState(false)

  const rows = (q.data ?? []).filter((c) => show === 'all' ? true : show === 'waiting' ? c.sent_at && !c.confirmed_at && !c.bounced_at
    : show === 'confirmed' ? !!c.confirmed_at : show === 'bounced' ? !!c.bounced_at : !c.sent_at)
  const { sorted, sort, toggle } = useTableSort(rows, {
    vendor: (c) => c.vendor?.name ?? '', name: (c) => c.contact_name ?? '', email: (c) => c.email, sent: (c) => c.sent_at, opened: (c) => c.opened_at, confirmed: (c) => c.confirmed_at,
  }, { param: 'cc_sort', descFirst: ['sent', 'opened', 'confirmed'] })

  const counts: Record<ConfirmState, number> = { confirmed: 0, waiting: 0, no_answer: 0, bad_email: 0, not_asked: 0 }
  for (const s of states.data?.values() ?? []) counts[s]++

  async function prepare() {
    if (!organization) return
    if (!window.confirm('Prepare an email for every contact at the vendors we buy from? They wait in Mail › Drafts until you send them.')) return
    setBusy(true)
    try {
      const n = await prepareConfirmations(organization.id)
      toast.success(n ? `${n} email${n === 1 ? '' : 's'} ready in Mail › Drafts` : 'Everyone already has one waiting or confirmed')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-16">
      <BackLink fallback={ROUTES.vendors} fallbackLabel="Vendors" />
      <PageHeader title="Contact confirmations" description="Vendors check the information we have for them on a short form. Each answer marks them Confirmed."
        actions={canEdit ? <Button loading={busy} onClick={() => void prepare()} leftIcon={<Mail className="size-4" aria-hidden="true" />}>Prepare emails</Button> : undefined} />

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(Object.keys(CONFIRM_STATE_LABELS) as ConfirmState[]).map((s) => (
          <Link key={s} to={`${ROUTES.vendors}?confirm=${s}`} className="rounded-2xl border border-stone-200 bg-white p-4 hover:border-brand">
            <p className="text-2xl font-semibold text-stone-900">{counts[s]}</p>
            <p className="text-xs text-stone-600">vendors {CONFIRM_STATE_LABELS[s].toLowerCase()}</p>
          </Link>
        ))}
      </section>

      {organization && canEdit ? <EmailText organizationId={organization.id} subject={organization.confirm_email_subject} body={organization.confirm_email_body} onSaved={() => void refreshProfile()} /> : null}
      <p className="mb-3 text-sm text-stone-600">After preparing, open <Link to={`${ROUTES.mail}?view=drafts`} className="font-medium text-brand hover:underline">Mail › Drafts</Link>, check a few, then click <strong>Send all</strong>. One reminder goes a week later to anyone who hasn't answered.</p>

      <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1 sm:inline-flex">
        {([['all', 'Everyone'], ['waiting', 'Waiting'], ['confirmed', 'Confirmed'], ['bounced', 'Bad email'], ['drafts', 'Drafts not sent']] as [Show, string][]).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setShow(v)} aria-current={show === v ? 'page' : undefined}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', show === v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{label}</button>
        ))}
      </div>
      {q.isLoading ? <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div> : q.error ? <Alert variant="error">{q.error}</Alert> : sorted.length ? (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Email" sortKey="email" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Sent" sortKey="sent" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Opened" sortKey="opened" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Answer" sortKey="confirmed" sort={sort} onSort={toggle} className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.vendor ? <Link to={`${ROUTES.vendors}/${c.vendor.id}`} className="font-medium text-stone-900 hover:text-brand">{c.vendor.name}</Link> : '—'}</td>
                  <td className="px-3 py-2 text-stone-700">{c.contact_name ?? '—'}</td>
                  <td className="px-3 py-2 text-stone-700">{c.email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{c.sent_at ? shortDate(c.sent_at) : <Badge tone="neutral">In Drafts</Badge>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{c.opened_at ? shortDate(c.opened_at) : ''}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.confirmed_at ? <Badge tone="success">{c.changed ? 'Changed' : 'Looks good'} {shortDate(c.confirmed_at)}</Badge> : c.bounced_at ? <Badge tone="danger">Bad email</Badge> : c.sent_at ? <Badge tone="warning">Waiting{c.reminded_at ? ', reminded' : ''}</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-stone-500">Nobody here yet.</p>}
    </div>
  )
}

function EmailText({ organizationId, subject: s0, body: b0, onSaved }: { organizationId: string; subject: string; body: string; onSaved: () => void }) {
  const [subject, setSubject] = useState(s0)
  const [body, setBody] = useState(b0)
  const [saving, setSaving] = useState(false)
  const changed = subject !== s0 || body !== b0
  async function save() {
    if (!body.includes('{form_link}')) return toast.error('Keep {form_link} in the email: it is the link to their form.')
    setSaving(true)
    try { await saveConfirmEmail(organizationId, subject, body); toast.success('Email saved'); onSaved() } catch (err) { toast.error(errorMessage(err)) } finally { setSaving(false) }
  }
  return (
    <FoldSection title="The email" summary={s0} className="mb-4">
      <p className="mb-2 text-xs text-stone-500">{'{first_name}'} is the person's first name and {'{form_link}'} is the link to their form. Changes apply to emails prepared after saving.</p>
      <FormField label="Subject" htmlFor="cc-subject"><Input id="cc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
      <FormField label="Message" htmlFor="cc-body" className="mt-3"><Textarea id="cc-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></FormField>
      {changed ? <Button className="mt-3" loading={saving} onClick={() => void save()}>Save email</Button> : null}
    </FoldSection>
  )
}
