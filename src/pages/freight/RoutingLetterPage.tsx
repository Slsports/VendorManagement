import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileText, Mail, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { addRoutingLetter, DEFAULT_ROUTING_EMAIL, listRoutingLetters, listRoutingMissing, listRoutingSends, prepareRoutingEmails, routingLetterUrl, updateRoutingEmail, type RoutingWho } from '@/services/routingLetter'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { FoldSection } from '@/components/shared/FoldSection'
import { Alert, Badge, Button, FormField, Input, Spinner, Textarea } from '@/components/ui'
import type { RoutingLetter } from '@/types'

type Show = 'all' | 'waiting' | 'drafts'

/**
 * The freight routing letter (Dana, Oct 13): the current version, a new version, the emails that send it (prepared in
 * Mail › Drafts, one per person), and who it went to — date, name, email — and who confirmed receiving it.
 */
export default function RoutingLetterPage() {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const letters = useSupabaseQuery(async () => (organization ? listRoutingLetters(organization.id) : []), [organization?.id])
  const sends = useSupabaseQuery(async () => (organization ? listRoutingSends(organization.id) : []), [organization?.id])
  const missing = useSupabaseQuery(async () => (organization ? listRoutingMissing(organization.id, 'open_orders') : []), [organization?.id])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<RoutingWho | null>(null)
  const [show, setShow] = useState<Show>('all')
  const current = letters.data?.[0] ?? null

  const rows = (sends.data ?? []).filter((s) => (show === 'waiting' ? s.sent_at && !s.received_at : show === 'drafts' ? !s.sent_at : true))
  const { sorted, sort, toggle } = useTableSort(rows, {
    vendor: (s) => s.vendor?.name ?? '', name: (s) => s.contact_name ?? '', email: (s) => s.email, version: (s) => s.letter?.version ?? 0,
    sent: (s) => s.sent_at, received: (s) => s.received_at,
  }, { param: 'rl_sort', descFirst: ['sent', 'received'] })

  async function prepare(who: RoutingWho) {
    if (!current) return
    setBusy(who)
    try {
      const n = await prepareRoutingEmails(current.id, who)
      toast.success(n ? `${n} email${n === 1 ? '' : 's'} ready in Mail › Drafts` : 'Everyone already has an email for this version')
      await sends.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function open(l: RoutingLetter) {
    try { window.open(await routingLetterUrl(l.storage_path), '_blank', 'noopener') } catch (err) { toast.error(errorMessage(err)) }
  }

  const sent = (sends.data ?? []).filter((s) => s.letter_id === current?.id && s.sent_at)
  const confirmed = sent.filter((s) => s.received_at)
  const drafts = (sends.data ?? []).filter((s) => s.letter_id === current?.id && !s.sent_at)

  return (
    <div className="pb-16">
      <BackLink fallback={ROUTES.freight} fallbackLabel="Freight" />
      <PageHeader title="Routing letter" description="Our freight routing instructions: who it went to, and who confirmed they received it."
        actions={canEdit ? <Button onClick={() => setUploading(true)} leftIcon={<Upload className="size-4" aria-hidden="true" />}>{current ? 'Upload a new version' : 'Upload the letter'}</Button> : undefined} />

      {letters.isLoading ? <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div> : letters.error ? <Alert variant="error">{letters.error}</Alert> : null}

      {uploading && organization ? <UploadLetter organizationId={organization.id} previous={current} onClose={() => setUploading(false)} onDone={async () => { setUploading(false); await letters.refetch() }} /> : null}

      {current ? (
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Version {current.version}{current.effective_on ? <span className="ml-2 text-sm font-normal text-stone-500">effective {shortDate(current.effective_on)}</span> : null}</h2>
              <button type="button" onClick={() => void open(current)} className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><FileText className="size-4" aria-hidden="true" />{current.file_name}</button>
              {current.note ? <p className="mt-1 text-sm text-stone-600">{current.note}</p> : null}
              <p className="mt-2 text-sm text-stone-700">Sent to {sent.length} {sent.length === 1 ? 'person' : 'people'} · {confirmed.length} confirmed · {drafts.length} waiting in Drafts</p>
            </div>
            {canEdit ? (
              <div className="flex flex-col gap-2 sm:items-end">
                <Button loading={busy === 'open_orders'} onClick={() => void prepare('open_orders')} leftIcon={<Mail className="size-4" aria-hidden="true" />}>Prepare emails: vendors with open orders</Button>
                {current.version > 1 ? <Button variant="secondary" loading={busy === 'previous'} onClick={() => void prepare('previous')}>Everyone who had an earlier version</Button> : null}
                <Button variant="ghost" loading={busy === 'all'} onClick={() => { if (window.confirm('Prepare an email for every vendor we have ordered from? They wait in Mail › Drafts until you send them.')) void prepare('all') }}>All vendors we buy from</Button>
                <Link to={`${ROUTES.mail}?view=drafts`} className="text-sm font-medium text-brand hover:underline">Open Mail › Drafts to send them</Link>
              </div>
            ) : null}
          </div>
          {canEdit ? <EmailText letter={current} onSaved={() => void letters.refetch()} /> : null}
        </section>
      ) : !letters.isLoading && !uploading ? <Alert variant="info" className="mb-4">No routing letter yet. Click <strong>Upload the letter</strong> to add the PDF.</Alert> : null}

      {(missing.data ?? []).length ? (
        <FoldSection title="Vendors with open orders and no email address" summary={`${missing.data!.length}`} className="mb-4">
          <p className="mb-2 text-sm text-stone-600">Add an email to each one (or call them). They get the letter as soon as they have an address.</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {missing.data!.map((m) => <li key={m.vendor_id}><Link to={`${ROUTES.vendors}/${m.vendor_id}`} className="font-medium text-stone-900 hover:text-brand">{m.vendor_name}</Link> <span className="text-xs text-stone-500">{m.open_orders} open order{m.open_orders === 1 ? '' : 's'}</span></li>)}
          </ul>
        </FoldSection>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl bg-stone-100 p-1 sm:inline-flex">
        {([['all', 'Everyone'], ['waiting', 'Not confirmed'], ['drafts', 'Drafts not sent']] as [Show, string][]).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setShow(v)} aria-current={show === v ? 'page' : undefined}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', show === v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>{label}</button>
        ))}
      </div>
      {sorted.length ? (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Email" sortKey="email" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Version" sortKey="version" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Sent" sortKey="sent" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Received" sortKey="received" sort={sort} onSort={toggle} className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.vendor ? <Link to={`${ROUTES.vendors}/${s.vendor.id}`} className="font-medium text-stone-900 hover:text-brand">{s.vendor.name}</Link> : '—'}</td>
                  <td className="px-3 py-2 text-stone-700">{s.contact_name ?? '—'}</td>
                  <td className="px-3 py-2 text-stone-700">{s.email}</td>
                  <td className="px-3 py-2 text-stone-700">v{s.letter?.version}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{s.sent_at ? shortDate(s.sent_at) : <Badge tone="neutral">In Drafts</Badge>}</td>
                  <td className="whitespace-nowrap px-3 py-2">{s.received_at ? <Badge tone="success">{shortDate(s.received_at)}</Badge> : s.sent_at ? <Badge tone="warning">Not yet{s.reminded_at ? ', reminded' : ''}</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-stone-500">{sends.isLoading ? 'Loading…' : 'Nobody here yet.'}</p>}
    </div>
  )
}

/** The email that sends this version: {first_name}, {open_orders} and {receipt_link} fill in for each person. */
function EmailText({ letter, onSaved }: { letter: RoutingLetter; onSaved: () => void }) {
  const [subject, setSubject] = useState(letter.email_subject)
  const [body, setBody] = useState(letter.email_body)
  const [saving, setSaving] = useState(false)
  const changed = subject !== letter.email_subject || body !== letter.email_body
  async function save() {
    if (!body.includes('{receipt_link}')) return toast.error('Keep {receipt_link} in the email: it is the "I received it" link.')
    setSaving(true)
    try { await updateRoutingEmail(letter.id, subject, body); toast.success('Email saved'); onSaved() } catch (err) { toast.error(errorMessage(err)) } finally { setSaving(false) }
  }
  return (
    <FoldSection title="The email that sends it" summary={letter.email_subject} className="mt-4">
      <p className="mb-2 text-xs text-stone-500">{'{first_name}'} is the person's first name, {'{open_orders}'} lists their open orders (left out when they have none), {'{receipt_link}'} is the "I received the routing instructions" link. The letter is attached. Changes apply to emails prepared after saving.</p>
      <FormField label="Subject" htmlFor="rl-subject"><Input id="rl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
      <FormField label="Message" htmlFor="rl-body" className="mt-3"><Textarea id="rl-body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></FormField>
      {changed ? <Button className="mt-3" loading={saving} onClick={() => void save()}>Save email</Button> : null}
    </FoldSection>
  )
}

function UploadLetter({ organizationId, previous, onClose, onDone }: { organizationId: string; previous: RoutingLetter | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [effective, setEffective] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!file) return toast.error('Pick the PDF')
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast.error('Upload the letter as a PDF')
    setSaving(true)
    try {
      await addRoutingLetter(organizationId, file, { effective: effective || null, note, subject: previous?.email_subject ?? 'Updated freight routing instructions – Shaver Lake Sports', body: previous?.email_body ?? DEFAULT_ROUTING_EMAIL })
      toast.success(previous ? `Version ${previous.version + 1} saved. Prepare emails for everyone who had an earlier version.` : 'Routing letter saved')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
      setSaving(false)
    }
  }
  return (
    <section className="mb-4 rounded-2xl border border-brand/30 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">{previous ? `New version (${previous.version + 1})` : 'Upload the routing letter'}</h2>
      <p className="mt-1 text-xs text-stone-500">Save it from Word as a PDF first. {previous ? 'Everyone who had an earlier version will need it again to confirm.' : ''}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField label="PDF" htmlFor="rl-file"><input id="rl-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" /></FormField>
        <FormField label="Effective date" htmlFor="rl-date"><Input id="rl-date" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></FormField>
        <FormField label="What changed (optional)" htmlFor="rl-note"><Input id="rl-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
      <div className="mt-3 flex gap-2">
        <Button loading={saving} onClick={() => void save()}>Save</Button>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </section>
  )
}
