import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Mail, Pencil } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { addNote, getVendor, listNotes, listReviewQueue, setVendorAssignee, updateVendor, type VendorDetail } from '@/services/vendors'
import { listOrderers } from '@/services/reviews'
import { clearPickerCache } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_HELP, ORDERING_FREQUENCY_LABELS, freeShippingRule, standingWhy, STANDING_BADGE, LS_STATUS_LABELS, LS_STATUS_TONE, lsItemsText } from '@/lib/vendors'
import { errorMessage, shortDate } from '@/lib/utils'
import { VendorPoUseBadge } from '@/components/vendors/VendorPoUseBadge'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { FoldSection } from '@/components/shared/FoldSection'
import { RouteBadges } from '@/components/vendors/RouteBadges'
import { ReviewItemCard, VENDOR_DELETED } from '@/components/vendors/ReviewItemCard'
import { ItemChangeList } from '@/components/review/ItemChangeList'
import { VendorDocumentsSection } from '@/components/vendors/VendorDocumentsSection'
import { VendorLightspeedBox } from '@/components/vendors/VendorLightspeedBox'
import { VendorPortalSection } from '@/components/vendors/VendorPortalSection'
import { RecordTasks } from '@/components/tasks/RecordTasks'
import { VendorOrderingPanel } from '@/components/ordering/VendorOrderingPanel'
import { VendorRepGroupCard } from '@/components/vendors/VendorRepGroupCard'
import { VendorContactsSection } from '@/components/vendors/VendorContactsSection'
import { ourReps, peopleFor } from '@/lib/contacts'
import { VendorShowsSection } from '@/components/vendors/VendorShowsSection'
import { VendorOrdersSection } from '@/components/vendors/VendorOrdersSection'
import { VendorMailSection } from '@/components/vendors/VendorMailSection'
import { VendorPaymentsSection } from '@/components/vendors/VendorPaymentsSection'
import { VendorFreightSection } from '@/components/vendors/VendorFreightSection'
import { VendorShipmentSection } from '@/components/vendors/VendorShipmentSection'
import { WwdInvoiceList } from '@/components/payments/WwdInvoiceList'
import { ComposeDialog, type ComposeDraft } from '@/components/mail/ComposeDialog'
import { VendorScorecard } from '@/components/scores/VendorScorecard'
import { VendorItemRulesSection } from '@/components/vendors/VendorItemRulesSection'
import { PhoneLinks } from '@/components/shared/Phones'
import { VendorRoutingLetter } from '@/components/vendors/VendorRoutingLetter'
import { VendorConfirmBox } from '@/components/vendors/VendorConfirmBox'
import { VendorRecentActivity } from '@/components/vendors/VendorRecentActivity'
import { Alert, Badge, Button, Select, Spinner, Textarea } from '@/components/ui'
import { NameCheckNote } from '@/components/vendors/NameCheckNote'
import { latestNameCheck } from '@/services/repAgency'

export default function VendorDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role, profile, organization } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const vendorQ = useSupabaseQuery(() => getVendor(id), [id])
  const notesQ = useSupabaseQuery(() => listNotes('vendor', id), [id])
  // after a name or alias change: what the re-check of the old mail and review cards found (Dana, Oct 21)
  const nameCheckQ = useSupabaseQuery(() => latestNameCheck(id), [id])
  const reviewQ = useSupabaseQuery(async () => (organization ? (await listReviewQueue(organization.id)).filter((r) => r.entity_id === id || r.other?.id === id) : []), [id, organization?.id])
  const orderersQ = useSupabaseQuery(async () => (organization ? listOrderers(organization.id) : []), [organization?.id])
  const v = vendorQ.data
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  /** "Add our rep" opens the add-contact form in Reps & contacts right here (Dana, Oct 13). */
  const [addRep, setAddRep] = useState(0)

  if (vendorQ.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading vendor…" className="text-brand" /></div>
  if (vendorQ.error || !v) return <Alert variant="error">{vendorQ.error ?? 'Vendor not found'}</Alert>

  const people = peopleFor(v)
  const ourRep = people.find((p) => p.starred) ?? null
  /** Every address on the record for the To suggestions, our assigned rep first. */
  const suggestions = [
    ...people.filter((p) => p.starred && p.email).map((p) => ({ email: p.email!, label: `★ Our rep ${p.name ?? ''} ${p.email}`.replace(/\s+/g, ' ') })),
    ...(v.email ? [{ email: v.email, label: `Orders ${v.email}` }] : []),
    ...(v.shipping_contact_email ? [{ email: v.shipping_contact_email, label: `${v.shipping_contact || 'Shipping'} ${v.shipping_contact_email}` }] : []),
    ...people.filter((p) => p.email).map((p) => ({ email: p.email!, label: `${p.name || p.email}${p.name ? ` ${p.email}` : ''}` })),
  ].filter((s, i, all) => all.findIndex((x) => x.email.toLowerCase() === s.email.toLowerCase()) === i)
  /** Write to this address from VMS (orders@, your signature, filed to this vendor). */
  const compose = (to: string[]) => setDraft({ to, subject: '', body: '', vendor_id: v.id })
  const mail = (address: string | null) => (address
    ? canEdit
      ? <button type="button" onClick={() => compose([address])} className="text-brand hover:underline" title="Write an email from VMS">{address}</button>
      : <a href={`mailto:${address}`} className="text-brand hover:underline">{address}</a>
    : null)
  /** "Name · phone · email", the email clickable; null when all three are blank. */
  const contact = (name: string | null, phone: string | null, email: string | null) => {
    const text = [name, phone].filter(Boolean).join(' · ')
    if (!text && !email) return null
    return <>{text}{text && email ? ' · ' : ''}{mail(email)}</>
  }
  /** Who orders from this vendor (and gets its reviews and mail). */
  async function assign(profileId: string | null) {
    try {
      await setVendorAssignee(v!.id, profileId)
      toast.success(profileId ? `Assigned to ${(orderersQ.data ?? []).find((p) => p.id === profileId)?.full_name ?? 'them'}` : 'Unassigned')
      await Promise.all([vendorQ.refetch(), reviewQ.refetch()])
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const assignedTo: ReactNode = canEdit
    ? <Select value={v.assigned_buyer_id ?? ''} onChange={(e) => void assign(e.target.value || null)} aria-label="Assigned to" className="h-8 w-48 text-sm">
        <option value="">Nobody yet</option>
        {(orderersQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </Select>
    : (orderersQ.data ?? []).find((p) => p.id === v.assigned_buyer_id)?.full_name ?? null
  const wwdLink: ReactNode = v.vendor_billing_routes.some((r) => r.route === 'worldwide') ? <Link to={ROUTES.wwdContacts} className="text-brand hover:underline">Worldwide people and phone numbers</Link> : null
  const facts: [string, ReactNode][] = [
    ['Inactive because', !v.is_active && v.inactive_reason ? `${v.inactive_reason}${v.inactive_at ? ` (${new Date(v.inactive_at).toLocaleDateString()})` : ''}` : null],
    ['Lightspeed name', v.lightspeed_name],
    ['Items in Lightspeed', v.ls_status ? `${lsItemsText(v)} (checked ${new Date(v.ls_items_checked_at!).toLocaleDateString()})` : null],
    ['Assigned to', assignedTo],
    ['WWD contacts', wwdLink],
    ['Aliases', v.aliases.length ? v.aliases.join(', ') : null],
    ['Name re-check', nameCheckQ.data ? <NameCheckNote key="name-check" check={nameCheckQ.data} /> : null],
    ['Our rep', ourRep ? contact(ourRep.name, ourRep.phone, ourRep.email) : null],
    ['Payment terms', v.payment_terms?.name],
    ['Orders email', mail(v.email)],
    ['Phone', v.phone],
    ['Fax', v.fax],
    ['Website', v.website],
    ['Account #', v.account_number],
    ['Catalog', v.catalog],
    ['Address', [v.address, [v.city, v.state].filter(Boolean).join(', '), v.postal_code].filter(Boolean).join(', ') || null],
    ['Ordering', v.ordering_frequency ? ORDERING_FREQUENCY_LABELS[v.ordering_frequency] : null],
    ['Minimum order', v.minimum_order],
    ['PO abbreviation', v.po_code],
    ['Free shipping', freeShippingRule(v)],
    ['Freight program', v.free_shipping_policy ? v.freight_program : null],
    ['Freight routing', v.freight_routing],
    ['Freight allowance', v.freight_allowance_on_time ? 'Credits the freight back when paid on time' : null],
    ['Item names', v.vid_in_description ? 'Vendor ID last: NAME VENDORID' : 'No Vendor ID in item names'],
    ['Product types', v.product_types],
    ['Pickup', [v.pickup_address, v.pickup_times].filter(Boolean).join(' · ') || null],
    ['Shipping contact', contact(v.shipping_contact, v.shipping_contact_phone, v.shipping_contact_email)],
  ]

  /** Inactive vendors drop out of lists but keep their orders, files and items; pickers still offer them grayed out. */
  async function setActive(on: boolean) {
    try {
      await updateVendor(v!.id, { is_active: on })
      clearPickerCache()
      toast.success(on ? `${v!.name} is active` : `${v!.name} is inactive`)
      await vendorQ.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

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
      <BackLink fallback={ROUTES.vendors} fallbackLabel="Vendors" />
      <PageHeader
        eyebrow="Vendor"
        title={v.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <RouteBadges routes={v.vendor_billing_routes} />
            {STANDING_BADGE[v.standing] ? <Badge tone={STANDING_BADGE[v.standing]!.tone}>{STANDING_BADGE[v.standing]!.label}</Badge> : null}
            {v.ls_status ? <Badge tone={LS_STATUS_TONE[v.ls_status]}>{LS_STATUS_LABELS[v.ls_status]}</Badge> : null}
            {v.wwd_zero_upcharge ? <Badge tone="success">WWD 0% upcharge</Badge> : null}
            {v.is_fishing ? <Badge tone="info">Fishing</Badge> : null}
            {v.billcom_send ? <Badge tone="success">Invoices to Bill.com</Badge> : null}
            {v.web_orders ? <Badge tone="info">Web orders, no confirmation</Badge> : null}
            {v.is_retail_store ? <Badge tone="info">Retail store</Badge> : null}
            {v.is_slh_vendor ? <Badge tone="info">Bought for SLH</Badge> : null}
            {v.ask_before_pictures ? <Badge tone="neutral">Pictures saved by hand</Badge> : null}
            {v.is_delivery_vendor ? <Badge tone="neutral">Delivery vendor</Badge> : null}
            {v.wwd_active === false ? <Badge tone="warning">No longer with WWD{v.wwd_active_as_of ? ` (Edenred, ${shortDate(v.wwd_active_as_of)})` : ''}</Badge> : null}
            <VendorPoUseBadge vendorId={v.id} />
            {!v.is_active ? <Badge tone="danger">Inactive</Badge> : null}
          </span>
        }
        actions={canEdit ? (
          <div className="flex items-center gap-3">
            <ActiveSwitch active={v.is_active} onChange={(on) => void setActive(on)} />
            <Button variant="secondary" onClick={() => navigate(`${ROUTES.vendors}/${v.id}/edit`)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button>
          </div>
        ) : undefined}
      />

      {/* Our rep, always at the top (Dana, Oct 12): name, email and phone. */}
      <OurRepStrip vendor={v} canEdit={canEdit} onEmail={(email) => compose([email])} onAddRep={() => setAddRep((n) => n + 1)} />

      {v.standing !== 'ok' ? (
        <Alert variant={v.standing === 'do_not_order' ? 'error' : v.standing === 'hold' ? 'info' : 'warning'} title={v.standing === 'do_not_order' ? 'Do not order from this vendor' : v.standing === 'hold' ? `On hold${v.standing_review_date ? `: look again on ${new Date(v.standing_review_date + 'T12:00:00').toLocaleDateString()}` : ''}` : 'Last resort: order only if the items are nowhere else'} className="mb-6">
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

      {/* unavailable items: one card with a row each, not a card each (Dana, Oct 31) */}
      {reviewQ.data && reviewQ.data.some((r) => r.kind === 'item_change') ? (
        <div className="mb-6">
          <ItemChangeList changeIds={reviewQ.data.filter((r) => r.kind === 'item_change').map((r) => String((r.details as Record<string, unknown> | null)?.change_id ?? '')).filter(Boolean)}
            canEdit={canEdit} onDone={async () => { await reviewQ.refetch() }} />
        </div>
      ) : null}

      {reviewQ.data && reviewQ.data.some((r) => r.kind !== 'item_change') ? (
        <section className="mb-6 space-y-2">
          {reviewQ.data.filter((r) => r.kind !== 'item_change').map((item) => {
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
                  if (resultId === VENDOR_DELETED) navigate(ROUTES.vendors, { replace: true })
                  else if (resultId && resultId !== v.id) navigate(`${ROUTES.vendors}/${resultId}`)
                  else await Promise.all([vendorQ.refetch(), reviewQ.refetch()])
                }}
              />
            )
          })}
        </section>
      ) : null}

      {/* What happened lately, newest first (Dana, Oct 20) */}
      <VendorRecentActivity vendorId={v.id} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Overview</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.filter(([, val]) => val).map(([k, val]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-stone-500">{k}</dt>
                <dd className="text-sm text-stone-900">{k === 'Website' && typeof val === 'string' ? <a href={normalizeUrl(val)} target="_blank" rel="noreferrer" className="text-brand hover:underline">{val}</a> : val}</dd>
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

        <VendorConfirmBox vendorId={v.id} organizationId={v.organization_id} canEdit={canEdit} infoConfirmedAt={v.info_confirmed_at} />
        <VendorRoutingLetter vendorId={v.id} organizationId={v.organization_id} />
        <VendorLightspeedBox vendor={v} canEdit={canEdit} onChange={() => void vendorQ.refetch()} />

        <VendorOrderingPanel vendor={{ id: v.id, name: v.name, aliases: v.aliases }} assignedBuyerId={v.assigned_buyer_id} canEdit={canEdit} windows={v.vendor_order_windows} />
        <RecordTasks fold preset={{ vendor: { id: v.id, name: v.name } }} />
        <VendorDocumentsSection vendorId={v.id} vendorName={v.name} organizationId={v.organization_id} userId={profile?.id ?? null} canEdit={canEdit} />
        <VendorMailSection vendorId={v.id} organizationId={v.organization_id} onNewEmail={canEdit ? () => compose(suggestions[0] ? [suggestions[0].email] : []) : undefined} />
        <VendorRepGroupCard vendorId={v.id} group={v.rep_groups} />

        <VendorContactsSection vendor={v} canEdit={canEdit} addRep={addRep} onChange={vendorQ.refetch} onEmail={(email) => compose([email])} />
        <VendorShowsSection vendorId={v.id} />
        <VendorPortalSection vendorId={v.id} />
        <VendorScorecard organizationId={v.organization_id} vendorId={v.id} userId={profile?.id ?? null} canEdit={canEdit} />
        <VendorItemRulesSection organizationId={v.organization_id} vendorId={v.id} userId={profile?.id ?? null} canEdit={canEdit} />
        <VendorOrdersSection vendorId={v.id} vendorName={v.name} canAdd={canEdit} />
        <VendorPaymentsSection vendorId={v.id} />
        <VendorShipmentSection vendorId={v.id} />
        <VendorFreightSection vendorId={v.id} />
        <WwdInvoiceList fold vendorId={v.id} />

        <FoldSection title="Notes" summary={notesQ.isLoading ? null : notesQ.data?.length ? `${notesQ.data.length} note${notesQ.data.length === 1 ? '' : 's'}` : 'None'} className="lg:col-span-1">
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
        </FoldSection>
      </div>
      {draft ? <ComposeDialog draft={draft} suggestions={suggestions} onClose={() => setDraft(null)} onSent={() => void vendorQ.refetch()} /> : null}
    </div>
  )

}

function normalizeUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
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

/** Active / Inactive switch for the vendor page header. */
function ActiveSwitch({ active, onChange }: { active: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={active} aria-label="Active vendor" onClick={() => onChange(!active)}
      className="inline-flex items-center gap-2 rounded-full text-sm font-medium text-stone-700">
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${active ? 'bg-brand' : 'bg-stone-300'}`}>
        <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
      {active ? 'Active' : 'Inactive'}
    </button>
  )
}

function OurRepStrip({ vendor: v, canEdit, onEmail, onAddRep }: { vendor: VendorDetail; canEdit: boolean; onEmail: (email: string) => void; onAddRep: () => void }) {
  const reps = ourReps(v)
  return (
    <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-3 text-sm">
      {reps.length === 0 ? (
        <p className="text-stone-600">
          <span className="font-semibold text-stone-800">Main rep:</span> none yet.
          {canEdit ? <> <button type="button" onClick={onAddRep} className="font-medium text-brand hover:underline">Add main rep</button></> : null}
          {v.rep_groups ? <span className="text-stone-500"> · Rep group: <Link to={`${ROUTES.repGroups}/${v.rep_groups.id}`} className="hover:underline">{v.rep_groups.name}</Link></span> : null}
        </p>
      ) : reps.map((p) => (
        <p key={p.key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span><span className="font-semibold text-stone-800">Main rep:</span> <span className="font-medium text-stone-900">{p.name || p.email || p.phone}</span>
            {p.kind === 'group' && v.rep_groups ? <span className="text-stone-500"> · <Link to={`${ROUTES.repGroups}/${v.rep_groups.id}`} className="hover:underline">{v.rep_groups.name}</Link></span> : null}</span>
          {p.email ? <button type="button" onClick={() => onEmail(p.email!)} className="inline-flex items-center gap-1 text-brand hover:underline" title="Write an email from VMS"><Mail className="size-3.5" aria-hidden="true" />{p.email}</button> : null}
          <PhoneLinks phones={p.phones} className="text-brand hover:underline" />
          {!p.email && !p.phones.length && canEdit ? <Link to={`${ROUTES.vendors}/${v.id}/edit`} className="text-xs text-brand hover:underline">Add email and phone</Link> : null}
        </p>
      ))}
    </section>
  )
}
