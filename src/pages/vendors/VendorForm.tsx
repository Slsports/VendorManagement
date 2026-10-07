import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { createVendor, deleteOrderWindow, getVendor, listPaymentTerms, listRepGroups, saveOrderWindow, setVendorRoutes, updateVendor, type VendorDetail } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_HELP, BILLING_ROUTE_LABELS, MONTHS, ORDERING_FREQUENCY_LABELS, ORDER_WINDOW_KIND_LABELS, FREE_SHIPPING_POLICY_LABELS, STANDING_LABELS, STANDING_TAGS, STANDING_TAG_LABELS } from '@/lib/vendors'
import { cn, errorMessage } from '@/lib/utils'
import type { BillingRoute, OrderingFrequency, OrderWindowKind, PaymentTerms, RepGroup, TablesInsert, FreeShippingPolicy, VendorStanding, StandingTag } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { resolveEmailSender, setEmailVendor } from '@/services/mail'
import { useHasInAppHistory } from '@/hooks/useHasInAppHistory'
import { Alert, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

const ROUTE_KEYS = Object.keys(BILLING_ROUTE_LABELS) as BillingRoute[]
const FREQ_KEYS = Object.keys(ORDERING_FREQUENCY_LABELS) as OrderingFrequency[]
const KIND_KEYS = Object.keys(ORDER_WINDOW_KIND_LABELS) as OrderWindowKind[]

interface WindowDraft {
  id?: string
  kind: OrderWindowKind
  label: string
  months: number[]
  notes: string
}

interface FormState {
  name: string
  aliases: string
  routes: BillingRoute[]
  defaultRoute: BillingRoute | ''
  rep_group_id: string
  payment_terms_id: string
  ordering_frequency: OrderingFrequency | ''
  is_delivery_vendor: boolean
  is_active: boolean
  needs_review: boolean
  review_note: string
  standing: VendorStanding
  standing_tags: StandingTag[]
  standing_review_date: string
  do_not_order_reason: string
  wwd_zero_upcharge: boolean
  is_fishing: boolean
  website: string
  phone: string
  email: string
  fax: string
  account_number: string
  catalog: string
  address: string
  city: string
  state: string
  postal_code: string
  rep_name: string
  rep_phone: string
  rep_email: string
  pickup_address: string
  pickup_times: string
  shipping_contact: string
  shipping_contact_phone: string
  shipping_contact_email: string
  minimum_order: string
  freight_program: string
  free_shipping_policy: FreeShippingPolicy | ''
  free_shipping_threshold: string
  freight_routing: string
  product_types: string
  notes: string
  return_notes: string
  windows: WindowDraft[]
}

const EMPTY: FormState = {
  name: '', aliases: '', routes: [], defaultRoute: '', rep_group_id: '', payment_terms_id: '', ordering_frequency: '',
  is_delivery_vendor: false, is_active: true, needs_review: false, review_note: '', standing: 'ok', standing_tags: [], standing_review_date: '', do_not_order_reason: '', wwd_zero_upcharge: false, is_fishing: false,
  website: '', phone: '', email: '', fax: '', account_number: '', catalog: '', address: '', city: '', state: '', postal_code: '',
  rep_name: '', rep_phone: '', rep_email: '', pickup_address: '', pickup_times: '', shipping_contact: '', shipping_contact_phone: '', shipping_contact_email: '', minimum_order: '', freight_program: '', free_shipping_policy: '', free_shipping_threshold: '', freight_routing: '', product_types: '',
  notes: '', return_notes: '', windows: [],
}

const nz = (s: string) => (s.trim() ? s.trim() : null)

function formFromVendor(v: VendorDetail): FormState {
  return {
    name: v.name,
    aliases: v.aliases.join(', '),
    routes: v.vendor_billing_routes.map((r) => r.route),
    defaultRoute: v.vendor_billing_routes.find((r) => r.is_default)?.route ?? '',
    rep_group_id: v.rep_group_id ?? '',
    payment_terms_id: v.payment_terms_id ?? '',
    ordering_frequency: v.ordering_frequency ?? '',
    is_delivery_vendor: v.is_delivery_vendor,
    is_active: v.is_active,
    needs_review: v.needs_review,
    review_note: v.review_note ?? '',
    standing: v.standing,
    standing_tags: v.standing_tags as StandingTag[],
    standing_review_date: v.standing_review_date ?? '',
    wwd_zero_upcharge: v.wwd_zero_upcharge,
    is_fishing: v.is_fishing,
    do_not_order_reason: v.do_not_order_reason ?? '',
    website: v.website ?? '', phone: v.phone ?? '', email: v.email ?? '', fax: v.fax ?? '', account_number: v.account_number ?? '', catalog: v.catalog ?? '',
    address: v.address ?? '', city: v.city ?? '', state: v.state ?? '', postal_code: v.postal_code ?? '',
    rep_name: v.rep_name ?? '', rep_phone: v.rep_phone ?? '', rep_email: v.rep_email ?? '', pickup_address: v.pickup_address ?? '', pickup_times: v.pickup_times ?? '',
    shipping_contact: v.shipping_contact ?? '', shipping_contact_phone: v.shipping_contact_phone ?? '', shipping_contact_email: v.shipping_contact_email ?? '', minimum_order: v.minimum_order ?? '', freight_program: v.freight_program ?? '', free_shipping_policy: v.free_shipping_policy ?? '', free_shipping_threshold: v.free_shipping_threshold !== null ? String(v.free_shipping_threshold) : '', freight_routing: v.freight_routing ?? '', product_types: v.product_types ?? '',
    notes: v.notes ?? '', return_notes: v.return_notes ?? '',
    windows: v.vendor_order_windows.map((w) => ({ id: w.id, kind: w.kind, label: w.label ?? '', months: w.months, notes: w.notes ?? '' })),
  }
}

/** Loads the vendor (when editing) and reference lists, then renders the form keyed by vendor id. */
export default function VendorFormPage() {
  const { id } = useParams()
  const { organization } = useAuth()
  const vendorQ = useSupabaseQuery(async () => (id ? getVendor(id) : null), [id])
  const repGroupsQ = useSupabaseQuery(async () => (organization ? listRepGroups(organization.id) : []), [organization?.id])
  const termsQ = useSupabaseQuery(async () => (organization ? listPaymentTerms(organization.id) : []), [organization?.id])

  if (id && vendorQ.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading vendor…" className="text-brand" /></div>
  if (id && (vendorQ.error || !vendorQ.data)) return <Alert variant="error">{vendorQ.error ?? 'Vendor not found'}</Alert>

  return <VendorFormBody key={id ?? 'new'} vendor={vendorQ.data ?? null} repGroups={repGroupsQ.data ?? []} terms={termsQ.data ?? []} />
}

function VendorFormBody({ vendor: v, repGroups, terms }: { vendor: VendorDetail | null; repGroups: RepGroup[]; terms: PaymentTerms[] }) {
  const id = v?.id
  const isEdit = !!v
  const navigate = useNavigate()
  const hasHistory = useHasInAppHistory()
  const { organization, profile } = useAuth()
  // A new vendor started from an email arrives with its details in the address (Mail > New vendor).
  const [params] = useSearchParams()
  const fromEmail = isEdit ? null : params.get('from_email')
  const fromSender = isEdit ? null : params.get('from_sender')
  const [form, setForm] = useState<FormState>(() => (v ? formFromVendor(v) : { ...EMPTY, name: params.get('name') ?? '', email: params.get('email') ?? '', website: params.get('website') ?? '' }))
  const [removedWindows, setRemovedWindows] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  function toggleRoute(route: BillingRoute) {
    setForm((f) => {
      const routes = f.routes.includes(route) ? f.routes.filter((r) => r !== route) : [...f.routes, route]
      const defaultRoute = routes.includes(f.defaultRoute as BillingRoute) ? f.defaultRoute : (routes[0] ?? '')
      return { ...f, routes, defaultRoute }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!organization || !profile) return
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    const badEmail = ([['Orders email', form.email], ['Rep email', form.rep_email], ['Shipping contact email', form.shipping_contact_email]] as const).find(([, e]) => e.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()))
    if (badEmail) {
      setError(`${badEmail[0]} does not look like an email address.`)
      return
    }
    setSaving(true)
    setError(null)
    const payload: TablesInsert<'vendors'> = {
      organization_id: organization.id,
      name: form.name.trim(),
      aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
      rep_group_id: form.rep_group_id || null,
      payment_terms_id: form.payment_terms_id || null,
      ordering_frequency: form.ordering_frequency || null,
      is_delivery_vendor: form.is_delivery_vendor,
      is_active: form.is_active,
      needs_review: form.needs_review,
      review_note: form.needs_review ? nz(form.review_note) : null,
      standing: form.standing,
      standing_tags: form.standing === 'ok' ? [] : form.standing_tags,
      standing_review_date: form.standing !== 'ok' && form.standing_review_date ? form.standing_review_date : null,
      wwd_zero_upcharge: form.wwd_zero_upcharge,
      is_fishing: form.is_fishing,
      do_not_order_reason: form.standing !== 'ok' ? nz(form.do_not_order_reason) : null,
      website: nz(form.website), phone: nz(form.phone), email: nz(form.email), fax: nz(form.fax), account_number: nz(form.account_number), catalog: nz(form.catalog),
      address: nz(form.address), city: nz(form.city), state: nz(form.state), postal_code: nz(form.postal_code),
      rep_name: nz(form.rep_name), rep_phone: nz(form.rep_phone), rep_email: nz(form.rep_email), pickup_address: nz(form.pickup_address), pickup_times: nz(form.pickup_times),
      shipping_contact: nz(form.shipping_contact), shipping_contact_phone: nz(form.shipping_contact_phone), shipping_contact_email: nz(form.shipping_contact_email), minimum_order: nz(form.minimum_order), freight_program: nz(form.freight_program), free_shipping_policy: form.free_shipping_policy || null, free_shipping_threshold: form.free_shipping_threshold.trim() ? Number(form.free_shipping_threshold.replace(/[^0-9.]/g, '')) : null, freight_routing: nz(form.freight_routing), product_types: nz(form.product_types),
      notes: nz(form.notes), return_notes: nz(form.return_notes),
    }
    try {
      let vendorId = id
      if (isEdit && vendorId) {
        const { organization_id: _org, ...changes } = payload
        void _org
        await updateVendor(vendorId, changes)
      } else {
        const created = await createVendor({ ...payload, created_by: profile.id })
        vendorId = created.id
        if (fromSender) await resolveEmailSender(fromSender, 'vendor', vendorId)
        else if (fromEmail) await setEmailVendor(fromEmail, vendorId)
      }
      await setVendorRoutes(vendorId!, form.routes.map((r) => ({ route: r, is_default: r === form.defaultRoute })))
      for (const wid of removedWindows) await deleteOrderWindow(wid)
      for (const [i, w] of form.windows.entries()) {
        await saveOrderWindow({ ...(w.id ? { id: w.id } : {}), vendor_id: vendorId!, kind: w.kind, label: nz(w.label), months: w.months, notes: nz(w.notes), sort_order: i })
      }
      toast.success(isEdit ? 'Vendor saved' : fromSender ? 'Vendor created; their mail is filed to it' : fromEmail ? 'Vendor created; the email is filed to it' : 'Vendor created')
      navigate(`${ROUTES.vendors}/${vendorId}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink fallback={isEdit ? `${ROUTES.vendors}/${id}` : ROUTES.vendors} fallbackLabel={isEdit ? 'Vendor' : 'Vendors'} />
      <PageHeader eyebrow="Vendor" title={isEdit ? `Edit ${v?.name ?? ''}` : 'New vendor'} />
      {fromEmail || fromSender ? <Alert variant="info" className="mb-4">Started from an email. Check the name: it is a guess from their web address. When you save, {fromSender ? 'all mail from this sender is' : 'the email is'} filed to this vendor.</Alert> : null}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {error ? <Alert variant="error">{error}</Alert> : null}

        <Section title="Basics">
          <FormField label="Name" htmlFor="name" className="sm:col-span-2"><Input id="name" required value={form.name} onChange={(e) => set('name', e.target.value)} /></FormField>
          <FormField label="Aliases" htmlFor="aliases" hint="Other names, abbreviations or the Lightspeed name, separated by commas." className="sm:col-span-2">
            <Input id="aliases" value={form.aliases} onChange={(e) => set('aliases', e.target.value)} />
          </FormField>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-stone-800">Billing routes</legend>
            <p className="text-sm text-stone-500">Tick every way SLSI can be billed for this vendor, and pick the usual one.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {ROUTE_KEYS.map((r) => {
                const on = form.routes.includes(r)
                return (
                  <label key={r} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', on ? 'border-brand bg-brand-soft' : 'border-stone-200 bg-white')}>
                    <input type="checkbox" checked={on} onChange={() => toggleRoute(r)} className="mt-0.5 size-4 accent-brand" />
                    <span>
                      <span className="font-medium text-stone-900">{BILLING_ROUTE_LABELS[r]}</span>
                      <span className="block text-xs text-stone-500">{BILLING_ROUTE_HELP[r]}</span>
                      {on && form.routes.length > 1 ? (
                        <label className="mt-1 flex items-center gap-1 text-xs text-stone-700">
                          <input type="radio" name="defaultRoute" checked={form.defaultRoute === r} onChange={() => set('defaultRoute', r)} className="accent-brand" /> Usual route
                        </label>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <FormField label="Rep group" htmlFor="rep_group">
            <Select id="rep_group" value={form.rep_group_id} onChange={(e) => set('rep_group_id', e.target.value)}>
              <option value="">None</option>
              {repGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Payment terms" htmlFor="terms">
            <Select id="terms" value={form.payment_terms_id} onChange={(e) => set('payment_terms_id', e.target.value)}>
              <option value="">Organization default</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Ordering frequency" htmlFor="freq">
            <Select id="freq" value={form.ordering_frequency} onChange={(e) => set('ordering_frequency', e.target.value as OrderingFrequency | '')}>
              <option value="">Not set</option>
              {FREQ_KEYS.map((f) => <option key={f} value={f}>{ORDERING_FREQUENCY_LABELS[f]}</option>)}
            </Select>
          </FormField>
          <FormField label="Minimum order" htmlFor="min"><Input id="min" value={form.minimum_order} onChange={(e) => set('minimum_order', e.target.value)} placeholder="e.g. $250 or 12 units" /></FormField>
          <FormField label="Freight program" htmlFor="freight"><Input id="freight" value={form.freight_program} onChange={(e) => set('freight_program', e.target.value)} placeholder="e.g. Free freight over $500" /></FormField>
          <FormField label="Free shipping" htmlFor="fsp">
            <Select id="fsp" value={form.free_shipping_policy} onChange={(e) => set('free_shipping_policy', e.target.value as FreeShippingPolicy | '')}>
              <option value="">Not set</option>
              {(Object.keys(FREE_SHIPPING_POLICY_LABELS) as FreeShippingPolicy[]).map((k) => <option key={k} value={k}>{FREE_SHIPPING_POLICY_LABELS[k]}</option>)}
            </Select>
          </FormField>
          <FormField label="Free shipping over (order value at cost)" htmlFor="fst"><Input id="fst" inputMode="decimal" value={form.free_shipping_threshold} onChange={(e) => set('free_shipping_threshold', e.target.value)} placeholder="e.g. 500" disabled={form.free_shipping_policy === 'never'} /></FormField>
          <FormField label="Freight routing instructions" htmlFor="froute" className="sm:col-span-2"><Input id="froute" value={form.freight_routing} onChange={(e) => set('freight_routing', e.target.value)} placeholder="e.g. UPS Ground collect on our account; never air" /></FormField>
          <FormField label="Product types" htmlFor="products" className="sm:col-span-2"><Input id="products" value={form.product_types} onChange={(e) => set('product_types', e.target.value)} placeholder="e.g. Fly line, leader, tippet" /></FormField>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={form.is_delivery_vendor} onChange={(e) => set('is_delivery_vendor', e.target.checked)} /> Delivery vendor (drops goods with a paper invoice, no order placed ahead)</label>
            <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={form.wwd_zero_upcharge} onChange={(e) => set('wwd_zero_upcharge', e.target.checked)} /> WWD zero-upcharge vendor (no 1.5% drop-ship upcharge through Worldwide)</label>
            <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={form.is_fishing} onChange={(e) => set('is_fishing', e.target.checked)} /> Fishing vendor (Jarrett runs these reports)</label>
            {isEdit ? <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active</label> : null}
            <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={form.needs_review} onChange={(e) => set('needs_review', e.target.checked)} /> Flag for review</label>
            {form.needs_review ? <Input aria-label="Review note" value={form.review_note} onChange={(e) => set('review_note', e.target.value)} placeholder="What needs checking?" /> : null}
            <FormField label="Standing" htmlFor="standing" hint="A warning on every screen, never a block.">
              <Select id="standing" value={form.standing} onChange={(e) => set('standing', e.target.value as VendorStanding)}>
                {(Object.keys(STANDING_LABELS) as VendorStanding[]).map((k) => <option key={k} value={k}>{STANDING_LABELS[k]}</option>)}
              </Select>
            </FormField>
            {form.standing !== 'ok' ? (
              <>
                <fieldset>
                  <legend className="text-sm font-medium text-stone-800">Why? Shows beside the stars.</legend>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {STANDING_TAGS.map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm text-stone-800">
                        <input type="checkbox" className="size-4 accent-brand" checked={form.standing_tags.includes(t)} onChange={(e) => set('standing_tags', e.target.checked ? [...form.standing_tags, t] : form.standing_tags.filter((x) => x !== t))} /> {STANDING_TAG_LABELS[t]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <FormField label="Look at this again on" htmlFor="standing-review" hint="Optional. A hold until January, for example."><Input id="standing-review" type="date" value={form.standing_review_date} onChange={(e) => set('standing_review_date', e.target.value)} className="sm:w-48" /></FormField>
                <Textarea aria-label="Reason" rows={2} value={form.do_not_order_reason} onChange={(e) => set('do_not_order_reason', e.target.value)} placeholder="In your words: e.g. ordered twice, could not deliver either time, shipping was outrageous" />
              </>
            ) : null}
          </div>
        </Section>

        <Section title="Contact and address">
          <FormField label="Website" htmlFor="website"><Input id="website" value={form.website} onChange={(e) => set('website', e.target.value)} /></FormField>
          <FormField label="Orders email" htmlFor="email" hint="Where orders go"><Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></FormField>
          <FormField label="Phone" htmlFor="phone"><Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></FormField>
          <FormField label="Fax" htmlFor="fax"><Input id="fax" value={form.fax} onChange={(e) => set('fax', e.target.value)} /></FormField>
          <FormField label="Account #" htmlFor="account"><Input id="account" value={form.account_number} onChange={(e) => set('account_number', e.target.value)} /></FormField>
          <FormField label="Catalog" htmlFor="catalog" className="sm:col-span-2"><Input id="catalog" value={form.catalog} onChange={(e) => set('catalog', e.target.value)} /></FormField>
          <FormField label="Address" htmlFor="address" className="sm:col-span-2"><Input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} /></FormField>
          <FormField label="City" htmlFor="city"><Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="State" htmlFor="state"><Input id="state" value={form.state} onChange={(e) => set('state', e.target.value)} /></FormField>
            <FormField label="ZIP" htmlFor="zip"><Input id="zip" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} /></FormField>
          </div>
        </Section>

        <Section title="Rep and logistics">
          <FormField label="Rep name" htmlFor="rep_name"><Input id="rep_name" value={form.rep_name} onChange={(e) => set('rep_name', e.target.value)} /></FormField>
          <FormField label="Rep phone" htmlFor="rep_phone"><Input id="rep_phone" value={form.rep_phone} onChange={(e) => set('rep_phone', e.target.value)} /></FormField>
          <FormField label="Rep email" htmlFor="rep_email" className="sm:col-span-2"><Input id="rep_email" type="email" value={form.rep_email} onChange={(e) => set('rep_email', e.target.value)} /></FormField>
          <FormField label="Will-call pickup address" htmlFor="pickup"><Input id="pickup" value={form.pickup_address} onChange={(e) => set('pickup_address', e.target.value)} /></FormField>
          <FormField label="Pickup hours" htmlFor="pickup_times"><Input id="pickup_times" value={form.pickup_times} onChange={(e) => set('pickup_times', e.target.value)} placeholder="e.g. M–F 8–4" /></FormField>
          <FormField label="Shipping contact" htmlFor="ship"><Input id="ship" value={form.shipping_contact} onChange={(e) => set('shipping_contact', e.target.value)} /></FormField>
          <FormField label="Shipping contact phone" htmlFor="ship_phone"><Input id="ship_phone" value={form.shipping_contact_phone} onChange={(e) => set('shipping_contact_phone', e.target.value)} /></FormField>
          <FormField label="Shipping contact email" htmlFor="ship_email" className="sm:col-span-2"><Input id="ship_email" type="email" value={form.shipping_contact_email} onChange={(e) => set('shipping_contact_email', e.target.value)} /></FormField>
        </Section>

        <Section title="Ordering windows" description="When you typically order from this vendor. Drives the ordering guide and the show visit lists.">
          <div className="space-y-3 sm:col-span-2">
            {form.windows.map((w, i) => (
              <div key={w.id ?? `new-${i}`} className="rounded-xl border border-stone-200 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Kind" htmlFor={`w-kind-${i}`}>
                    <Select id={`w-kind-${i}`} value={w.kind} onChange={(e) => updateWindow(i, { kind: e.target.value as OrderWindowKind })}>
                      {KIND_KEYS.map((k) => <option key={k} value={k}>{ORDER_WINDOW_KIND_LABELS[k]}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="Label" htmlFor={`w-label-${i}`}><Input id={`w-label-${i}`} value={w.label} onChange={(e) => updateWindow(i, { label: e.target.value })} placeholder="e.g. Winter goods" /></FormField>
                </div>
                <div className="mt-3">
                  <p className="text-sm font-medium text-stone-800">Months</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {MONTHS.map((m, idx) => {
                      const n = idx + 1
                      const on = w.months.includes(n)
                      return (
                        <button key={m} type="button" aria-pressed={on} onClick={() => updateWindow(i, { months: on ? w.months.filter((x) => x !== n) : [...w.months, n] })} className={cn('rounded-md border px-2.5 py-1 text-xs font-medium', on ? 'border-brand bg-brand text-brand-foreground' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50')}>
                          {m}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <div className="flex-1"><FormField label="Notes" htmlFor={`w-notes-${i}`}><Input id={`w-notes-${i}`} value={w.notes} onChange={(e) => updateWindow(i, { notes: e.target.value })} placeholder="e.g. order by Oct 15 for Nov delivery" /></FormField></div>
                  <Button type="button" variant="ghost" aria-label="Remove window" onClick={() => removeWindow(i)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => set('windows', [...form.windows, { kind: 'custom', label: '', months: [], notes: '' }])} leftIcon={<Plus className="size-4" aria-hidden="true" />}>
              Add window
            </Button>
          </div>
        </Section>

        <Section title="Notes">
          <FormField label="Notes" htmlFor="notes" className="sm:col-span-2"><Textarea id="notes" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
          <FormField label="Return notes" htmlFor="return_notes" hint="How returns and claims work with this vendor: RA numbers, photos, deadlines." className="sm:col-span-2">
            <Textarea id="return_notes" rows={3} value={form.return_notes} onChange={(e) => set('return_notes', e.target.value)} />
          </FormField>
        </Section>

        <StickySaveBar saving={saving} label={isEdit ? 'Save changes' : 'Create vendor'} error={error}
          onCancel={() => (hasHistory ? navigate(-1) : navigate(isEdit ? `${ROUTES.vendors}/${id}` : ROUTES.vendors))} />
      </form>
    </div>
  )

  function updateWindow(i: number, patch: Partial<WindowDraft>) {
    setForm((f) => ({ ...f, windows: f.windows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)) }))
  }
  function removeWindow(i: number) {
    const w = form.windows[i]
    if (w?.id) setRemovedWindows((r) => [...r, w.id!])
    set('windows', form.windows.filter((_, idx) => idx !== i))
  }
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      {description ? <p className="mt-1 text-sm text-stone-500">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}
