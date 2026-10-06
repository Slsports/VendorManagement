import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowLeft, Check, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { addNote, addVendorEmail, deleteVendorEmail, getVendor, listNotes, listReviewQueue, updateVendor } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_HELP, CONTACT_TYPE_LABELS, ORDERING_FREQUENCY_LABELS, ORDER_WINDOW_KIND_LABELS, monthsLabel, freeShippingRule, standingWhy } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import type { ContactType } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { RouteBadges } from '@/components/vendors/RouteBadges'
import { ReviewItemCard } from '@/components/vendors/ReviewItemCard'
import { VendorLinksSection } from '@/components/vendors/VendorLinksSection'
import { VendorRepGroupCard } from '@/components/vendors/VendorRepGroupCard'
import { VendorShowsSection } from '@/components/vendors/VendorShowsSection'
import { PartnerContactsCard } from '@/components/vendors/PartnerContactsCard'
import { VendorOrdersSection } from '@/components/vendors/VendorOrdersSection'
import { VendorScorecard } from '@/components/scores/VendorScorecard'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

export default function VendorDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role, profile, organization } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const vendorQ = useSupabaseQuery(() => getVendor(id), [id])
  const notesQ = useSupabaseQuery(() => listNotes('vendor', id), [id])
  const reviewQ = useSupabaseQuery(async () => (organization ? (await listReviewQueue(organization.id)).filter((r) => r.entity_id === id || r.other?.id === id) : []), [id, organization?.id])
  const v = vendorQ.data

  if (vendorQ.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading vendor…" className="text-brand" /></div>
  if (vendorQ.error || !v) return <Alert variant="error">{vendorQ.error ?? 'Vendor not found'}</Alert>

  const facts: [string, string | null | undefined][] = [
    ['Lightspeed name', v.lightspeed_name],
    ['Report owner', v.report_owner],
    ['Aliases', v.aliases.length ? v.aliases.join(', ') : null],
    ['Rep', [v.rep_name, v.rep_phone].filter(Boolean).join(' · ') || null],
    ['Payment terms', v.payment_terms?.name],
    ['Phone', v.phone],
    ['Fax', v.fax],
    ['Website', v.website],
    ['Account #', v.account_number],
    ['Catalog', v.catalog],
    ['Address', [v.address, [v.city, v.state].filter(Boolean).join(', '), v.postal_code].filter(Boolean).join(', ') || null],
    ['Ordering', v.ordering_frequency ? ORDERING_FREQUENCY_LABELS[v.ordering_frequency] : null],
    ['Minimum order', v.minimum_order],
    ['Free shipping', freeShippingRule(v)],
    ['Freight program', v.free_shipping_policy ? v.freight_program : null],
    ['Freight routing', v.freight_routing],
    ['Product types', v.product_types],
    ['Pickup', [v.pickup_address, v.pickup_times].filter(Boolean).join(' · ') || null],
    ['Shipping contact', [v.shipping_contact, v.shipping_contact_phone].filter(Boolean).join(' · ') || null],
  ]

  async function clearReview() {
    try {
      await updateVendor(v!.id, { needs_review: false, review_note: null })
      toast.success('Review flag cleared')
      await vendorQ.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div>
      <Link to={ROUTES.vendors} className="mb-3 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
        <ArrowLeft className="size-4" aria-hidden="true" /> All vendors
      </Link>
      <PageHeader
        eyebrow="Vendor"
        title={v.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <RouteBadges routes={v.vendor_billing_routes} />
            {v.standing === 'do_not_order' ? <Badge tone="danger">Do not order</Badge> : v.standing === 'last_resort' ? <Badge tone="warning">Last resort</Badge> : null}
            {v.wwd_zero_upcharge ? <Badge tone="success">WWD 0% upcharge</Badge> : null}
            {v.is_fishing ? <Badge tone="info">Fishing</Badge> : null}
            {v.is_delivery_vendor ? <Badge tone="neutral">Delivery vendor</Badge> : null}
            {!v.is_active ? <Badge tone="danger">Inactive</Badge> : null}
          </span>
        }
        actions={canEdit ? <Button variant="secondary" onClick={() => navigate(`${ROUTES.vendors}/${v.id}/edit`)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button> : undefined}
      />

      {v.standing !== 'ok' ? (
        <Alert variant={v.standing === 'do_not_order' ? 'error' : 'warning'} title={v.standing === 'do_not_order' ? 'Do not order from this vendor' : 'Last resort: order only if the items are nowhere else'} className="mb-6">
          {v.standing_tags.length ? <p className="font-medium">{standingWhy(v.standing_tags)}</p> : null}
          <p>{v.do_not_order_reason ?? 'No reason recorded.'}</p>
          <p className="mt-1 text-xs opacity-80">Ordering is still possible if you change your mind; this is a warning, not a block.</p>
        </Alert>
      ) : null}

      {v.merged_into_id ? (
        <Alert variant="info" title="Merged into another vendor" className="mb-6">
          <p>This record was folded into <Link to={`${ROUTES.vendors}/${v.merged_into_id}`} className="underline">another vendor</Link> and is kept for history.</p>
        </Alert>
      ) : null}

      {v.needs_review ? (
        <Alert variant="warning" title="Flagged for review" className="mb-6">
          <p>{v.review_note ?? 'This vendor needs a look.'}</p>
          {reviewQ.data && reviewQ.data.length > 0 ? (
            <p className="mt-1 text-xs opacity-80">Answer the question below and the flag clears itself.</p>
          ) : canEdit ? (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void clearReview()} leftIcon={<Check className="size-4" aria-hidden="true" />}>
              Checked, clear the flag
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {reviewQ.data && reviewQ.data.length > 0 ? (
        <section className="mb-6 space-y-2">
          {reviewQ.data.map((item) => {
            // Show the pair from this vendor's point of view.
            const mine = item.entity_id === v.id
            return (
              <ReviewItemCard
                key={item.id}
                item={item}
                vendor={mine ? item.vendor : item.other}
                other={mine ? item.other : item.vendor}
                canEdit={canEdit}
                onDone={async (resultId) => {
                  if (resultId && resultId !== v.id) navigate(`${ROUTES.vendors}/${resultId}`)
                  else await Promise.all([vendorQ.refetch(), reviewQ.refetch()])
                }}
              />
            )
          })}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Overview</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.filter(([, val]) => val).map(([k, val]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-stone-500">{k}</dt>
                <dd className="text-sm text-stone-900">{k === 'Website' ? <a href={normalizeUrl(val!)} target="_blank" rel="noreferrer" className="text-brand hover:underline">{val}</a> : val}</dd>
              </div>
            ))}
          </dl>
          {facts.filter(([, val]) => val).length <= 1 ? <p className="mt-3 text-sm text-stone-500">Only the name so far. Contacts and details fill in from the mailbox scan and the vendor form, or edit them here.</p> : null}
          {v.notes ? <p className="mt-4 whitespace-pre-line rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{v.notes}</p> : null}
          {v.return_notes ? (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-stone-500">Return notes</h3>
              <p className="whitespace-pre-line text-sm text-stone-800">{v.return_notes}</p>
            </div>
          ) : null}
          <div className="mt-4 text-xs text-stone-500">
            {v.vendor_billing_routes.map((r) => <p key={r.route}>{BILLING_ROUTE_HELP[r.route]}{r.is_default ? ' (default)' : ''}</p>)}
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Ordering windows</h2>
          {v.vendor_order_windows.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">None recorded. Add them on the edit page.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {v.vendor_order_windows.map((w) => (
                <li key={w.id} className="rounded-lg bg-stone-50 px-3 py-2">
                  <p className="font-medium text-stone-900">{w.label || ORDER_WINDOW_KIND_LABELS[w.kind]}</p>
                  <p className="text-stone-600">{w.months.length ? monthsLabel(w.months) : ORDER_WINDOW_KIND_LABELS[w.kind]}{w.notes ? ` · ${w.notes}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <VendorLinksSection vendorId={v.id} organizationId={v.organization_id} userId={profile?.id ?? null} canEdit={canEdit} />
        <VendorRepGroupCard vendorId={v.id} group={v.rep_groups} />
        {v.vendor_billing_routes.some((r) => r.route === 'worldwide') ? <PartnerContactsCard route="worldwide" vendorName={v.name} /> : null}

        <ContactsSection vendorId={v.id} contacts={v.vendor_emails} canEdit={canEdit} onChange={vendorQ.refetch} />
        <VendorShowsSection vendorId={v.id} />
        <VendorScorecard organizationId={v.organization_id} vendorId={v.id} userId={profile?.id ?? null} canEdit={canEdit} />
        <VendorOrdersSection vendorId={v.id} />

        <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Notes</h2>
          {canEdit && profile && organization ? (
            <NoteForm onSubmit={async (body) => { await addNote({ organization_id: organization.id, entity_type: 'vendor', entity_id: v.id, body, created_by: profile.id }); await notesQ.refetch() }} />
          ) : null}
          {notesQ.data && notesQ.data.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {notesQ.data.map((n) => (
                <li key={n.id} className="text-sm">
                  <p className="whitespace-pre-line text-stone-800">{n.body}</p>
                  <p className="mt-0.5 text-xs text-stone-400">{n.profiles?.full_name || n.profiles?.email || 'Unknown'} · {new Date(n.created_at).toLocaleDateString()}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-stone-500">No notes yet.</p>
          )}
        </section>
      </div>
    </div>
  )

}

function normalizeUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

function ContactsSection({ vendorId, contacts, canEdit, onChange }: { vendorId: string; contacts: { id: string; email: string; contact_name: string | null; title: string | null; phone: string | null; contact_type: ContactType; source: string }[]; canEdit: boolean; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ contact_name: '', email: '', phone: '', title: '', contact_type: 'rep' as ContactType })
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await addVendorEmail({ vendor_id: vendorId, email: form.email.trim(), contact_name: form.contact_name.trim() || null, phone: form.phone.trim() || null, title: form.title.trim() || null, contact_type: form.contact_type, source: 'manual' })
      setForm({ contact_name: '', email: '', phone: '', title: '', contact_type: 'rep' })
      setAdding(false)
      toast.success('Contact added')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this contact?')) return
    try {
      await deleteVendorEmail(id)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Contacts</h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add contact</Button> : null}
      </div>
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="c-name"><Input id="c-name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></FormField>
          <FormField label="Email" htmlFor="c-email"><Input id="c-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <FormField label="Phone" htmlFor="c-phone"><Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
          <FormField label="Title" htmlFor="c-type">
            <Select id="c-type" value={form.contact_type} onChange={(e) => setForm({ ...form, contact_type: e.target.value as ContactType })}>
              {(Object.keys(CONTACT_TYPE_LABELS) as ContactType[]).map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}
            </Select>
          </FormField>
          <FormField label="Job title (optional)" htmlFor="c-title" className="sm:col-span-2"><Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Regional Sales Manager" /></FormField>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>Save contact</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {contacts.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-stone-500">No contacts yet. They arrive from the mailbox scan and the vendor form, or add one here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-stone-900">{c.contact_name || c.email} <Badge tone="neutral" className="ml-1">{CONTACT_TYPE_LABELS[c.contact_type]}</Badge>{c.title ? <span className="ml-2 text-xs font-normal text-stone-500">{c.title}</span> : null}</p>
                <p className="flex flex-wrap gap-x-4 text-stone-600">
                  <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" aria-hidden="true" />{c.email}</a>
                  {c.phone ? <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-brand"><Phone className="size-3.5" aria-hidden="true" />{c.phone}</a> : null}
                </p>
              </div>
              {canEdit ? (
                <button type="button" onClick={() => void remove(c.id)} aria-label={`Remove ${c.email}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {contacts.length === 0 ? <p className="mt-2 inline-flex items-center gap-1 text-xs text-stone-400"><AlertTriangle className="size-3.5" aria-hidden="true" /> The discrepancy and status emails need a rep contact.</p> : null}
    </section>
  )
}

function NoteForm({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!body.trim()) return
        setSaving(true)
        try {
          await onSubmit(body.trim())
          setBody('')
        } catch (err) {
          toast.error(errorMessage(err))
        } finally {
          setSaving(false)
        }
      }}
      className="mt-3 space-y-2"
    >
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" aria-label="New note" />
      <Button type="submit" size="sm" loading={saving} disabled={!body.trim()}>Add note</Button>
    </form>
  )
}
