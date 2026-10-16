import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Merge, Save } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getAccountingContact, listAccountingContacts, listContactThreads, mergeAccountingContacts, saveAccountingContact, type ContactAddress, type ContactInput, type ContactStatus } from '@/services/accounting'
import { listMailboxes } from '@/services/mail'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_CATEGORY_LABELS, contactName } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { AccountingCategory, AccountingContact } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

const EMPTY: ContactInput = { company: '', person: '', role: '', category: 'other', phones: [], notes: '', status: 'confirmed', addresses: [] }

/** One contact's card (Dana, Oct 16): who they are, how to reach them, and the mail with them. Short form, plain Save. */
export default function AccountingContactPage() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = useSupabaseQuery(async () => (isNew ? null : getAccountingContact(id)), [id])
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting') ?? null
  const mail = useSupabaseQuery(async () => (organization && box && !isNew ? listContactThreads(organization.id, box.id, id) : []), [organization?.id, box?.id, id])
  const others = useSupabaseQuery(async () => (organization ? listAccountingContacts(organization.id) : []), [organization?.id])
  const [mergeInto, setMergeInto] = useState('')
  const [merging, setMerging] = useState(false)
  const loaded = q.data

  async function merge() {
    if (!organization || !mergeInto || isNew) return
    const target = (others.data ?? []).find((c) => c.id === mergeInto)
    if (!target || !window.confirm(`Merge this contact into ${contactName(target)}? Its emails and conversations move there; this card is kept as merged.`)) return
    setMerging(true)
    try {
      await mergeAccountingContacts(id, mergeInto)
      toast.success(`Merged into ${contactName(target)}`)
      navigate(`${ROUTES.accountingContacts}/${mergeInto}`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setMerging(false)
    }
  }

  if (!isNew && q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!isNew && !loaded) return <Alert variant="error">Contact not found.</Alert>
  if (!organization) return null
  const c = loaded?.contact ?? null
  const title = isNew ? 'New contact' : contactName(c)

  return (
    <div>
      <BackLink fallback={ROUTES.accountingContacts} fallbackLabel="Accounting contacts" />
      <PageHeader title={title} description={c ? `${c.message_count} emails${c.last_contact_at ? ` · last ${new Date(c.last_contact_at).toLocaleDateString()}` : ''}` : 'Someone you deal with in billing@.'}
        actions={c ? <Badge tone={c.status === 'confirmed' ? 'success' : c.status === 'ignored' ? 'neutral' : 'warning'}>{c.status === 'proposed' ? 'To confirm' : c.status === 'ignored' ? 'Ignored' : 'Confirmed'}</Badge> : undefined} />
      {c?.merged_into ? <Alert variant="info" className="mb-4">This card was merged into <Link to={`${ROUTES.accountingContacts}/${c.merged_into}`} className="font-medium underline">another contact</Link>.</Alert> : null}
      <ContactForm
        key={c ? `${c.id}:${c.updated_at}` : 'new'}
        organizationId={organization.id}
        contactId={isNew ? null : id}
        contact={c}
        addresses={loaded?.addresses ?? []}
        confirming={params.get('confirm') === '1'}
        onSaved={async (savedId) => {
          if (isNew) navigate(`${ROUTES.accountingContacts}/${savedId}`, { replace: true })
          else await Promise.all([q.refetch(), mail.refetch()])
        }}
        onCancel={() => navigate(ROUTES.accountingContacts)}
      />
      {!isNew ? (
        <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
          <h2 className="text-base font-semibold text-stone-900">Same person or company twice?</h2>
          <p className="mt-1 text-sm text-stone-600">Merge this card into the other one. Emails, conversations and counts move over.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="sm:w-80">
              <option value="">Pick the contact to keep…</option>
              {(others.data ?? []).filter((o) => o.id !== id).map((o) => <option key={o.id} value={o.id}>{contactName(o)}</option>)}
            </Select>
            <Button type="button" variant="secondary" disabled={!mergeInto} loading={merging} onClick={() => void merge()} leftIcon={<Merge className="size-4" aria-hidden="true" />}>Merge</Button>
          </div>
        </section>
      ) : null}
      {!isNew ? (
        <section className="mt-6">
          <h2 className="mb-2 text-base font-semibold text-stone-900">Mail with them</h2>
          {mail.isLoading ? <Spinner label="Loading mail…" className="text-brand" />
            : mail.error ? <Alert variant="error">{mail.error}</Alert>
            : (mail.data ?? []).length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-8 text-center text-sm text-stone-600">No conversations matched yet. Save the email addresses above and VMS links the mail.</p>
            : <ThreadTable rows={mail.data ?? []} showVendor={false} onChanged={mail.refetch} />}
        </section>
      ) : null}
    </div>
  )
}

/** The card's fields. Mounted fresh (by key) whenever the saved contact changes, so its state starts from the saved values. */
function ContactForm({ organizationId, contactId, contact, addresses, confirming, onSaved, onCancel }: {
  organizationId: string; contactId: string | null; contact: AccountingContact | null; addresses: ContactAddress[]; confirming: boolean
  onSaved: (id: string) => Promise<void>; onCancel: () => void
}) {
  const [form, setForm] = useState<ContactInput>(() => contact
    ? { company: contact.company, person: contact.person, role: contact.role, category: contact.category, phones: contact.phones, notes: contact.notes, status: contact.status === 'proposed' && confirming ? 'confirmed' : contact.status, addresses: addresses.map((a) => a.address) }
    : EMPTY)
  const [addrText, setAddrText] = useState(() => addresses.map((a) => a.address).join('\n'))
  const [phoneText, setPhoneText] = useState(() => (contact?.phones ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proposed = contact?.status === 'proposed' && form.status !== 'confirmed'

  async function save(e: FormEvent | null, status?: ContactStatus) {
    e?.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const input: ContactInput = { ...form, status: status ?? form.status, addresses: addrText.split(/[\n,;]+/), phones: phoneText.split(/\n+/) }
      if (!input.company.trim() && !input.person.trim()) throw new Error('Enter a company or a person')
      const savedId = await saveAccountingContact(organizationId, contactId, input)
      toast.success(status === 'confirmed' ? 'Confirmed' : 'Saved')
      await onSaved(savedId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
      {error ? <Alert variant="error" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Company" htmlFor="c-company"><Input id="c-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></FormField>
        <FormField label="Person" htmlFor="c-person"><Input id="c-person" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} /></FormField>
        <FormField label="Role" htmlFor="c-role" hint="Agent, CPA, banker, adjuster…"><Input id="c-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></FormField>
        <FormField label="Category" htmlFor="c-category" hint="Sorts their mail and, later, their files.">
          <Select id="c-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as AccountingCategory })}>
            {ACCOUNTING_CATEGORIES.map((k) => <option key={k} value={k}>{ACCOUNTING_CATEGORY_LABELS[k]}</option>)}
          </Select>
        </FormField>
        <FormField label="Email addresses" htmlFor="c-addresses" hint="One per line. A bare company domain (mbsaccountancy.com) means everyone there.">
          <Textarea id="c-addresses" rows={4} value={addrText} onChange={(e) => setAddrText(e.target.value)} />
        </FormField>
        <FormField label="Phone numbers" htmlFor="c-phones" hint="One per line."><Textarea id="c-phones" rows={4} value={phoneText} onChange={(e) => setPhoneText(e.target.value)} /></FormField>
        <FormField label="Notes" htmlFor="c-notes" className="sm:col-span-2"><Textarea id="c-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
        <FormField label="Status" htmlFor="c-status">
          <Select id="c-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ContactStatus })}>
            <option value="confirmed">Confirmed</option>
            <option value="proposed">To confirm</option>
            <option value="ignored">Ignored (newsletters, noise)</option>
          </Select>
        </FormField>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {proposed ? <Button type="button" loading={saving} onClick={() => void save(null, 'confirmed')} leftIcon={<Save className="size-4" aria-hidden="true" />}>Confirm and save</Button> : null}
        <Button type="submit" variant={proposed ? 'secondary' : 'primary'} loading={saving} leftIcon={<Save className="size-4" aria-hidden="true" />}>Save</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
