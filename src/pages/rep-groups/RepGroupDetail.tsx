import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ExternalLink, Pencil } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getRepGroup, updateRepGroup } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { RouteBadges } from '@/components/vendors/RouteBadges'
import { LineCard } from '@/components/lines/LineCard'
import { Alert, Badge, Button, FormField, Input, Spinner, Textarea } from '@/components/ui'

export default function RepGroupDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(() => getRepGroup(id), [id])
  const [editing, setEditing] = useState(false)
  const g = q.data

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading rep group…" className="text-brand" /></div>
  if (q.error || !g) return <Alert variant="error">{q.error ?? 'Rep group not found'}</Alert>

  return (
    <div>
      <BackLink fallback={ROUTES.repGroups} fallbackLabel="Rep groups" />
      <PageHeader
        eyebrow="Rep group"
        title={g.name}
        description={[g.contact_name, g.phone, g.email].filter(Boolean).join(' · ') || 'No contact on file'}
        actions={canEdit && !editing ? <Button variant="secondary" onClick={() => setEditing(true)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button> : undefined}
      />

      {editing ? (
        <RepGroupForm group={g} onDone={async () => { setEditing(false); await q.refetch() }} onCancel={() => setEditing(false)} />
      ) : (
        <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {[['Contact', g.contact_name], ['Email', g.email], ['Phone', g.phone], ['Website', g.website], ['Address', g.address]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-xs font-medium text-stone-500">{k}</dt><dd className="text-sm text-stone-900">{k === 'Email' ? <a href={`mailto:${v}`} className="text-brand hover:underline">{v}</a> : v}</dd></div>
            ))}
          </dl>
          {g.notes ? <p className="mt-3 whitespace-pre-line text-sm text-stone-700">{g.notes}</p> : null}
        </section>
      )}

      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Vendors we buy from <span className="font-normal text-stone-400">({g.vendors.length})</span></h2>
        {g.vendors.length === 0 ? <p className="mt-2 text-sm text-stone-500">None yet.</p> : (
          <ul className="mt-2 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {g.vendors.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <Link to={`${ROUTES.vendors}/${v.id}`} className="font-medium text-stone-900 hover:text-brand">{v.name}</Link>
                <span className="flex items-center gap-2">
                  <RouteBadges routes={v.vendor_billing_routes} emptyLabel={null} />
                  {v.wwd_zero_upcharge ? <Badge tone="success">WWD 0% upcharge</Badge> : null}
                  {v.do_not_order ? <Badge tone="danger">Do not order</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Other lines they carry <span className="font-normal text-stone-400">({g.lines.length})</span></h2>
        <p className="mb-2 text-sm text-stone-600">Catalogs to look at. Nothing here is a vendor record until you make it one.</p>
        {g.lines.length === 0 ? <p className="text-sm text-stone-500">None recorded.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {g.lines.map((l) => <LineCard key={l.id} line={l} canEdit={canEdit} onPromoted={(vendorId) => navigate(`${ROUTES.vendors}/${vendorId}`)} />)}
          </ul>
        )}
      </section>
      {g.website ? <a href={g.website.startsWith('http') ? g.website : `https://${g.website}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline"><ExternalLink className="size-4" aria-hidden="true" /> {g.website}</a> : null}
    </div>
  )
}

function RepGroupForm({ group, onDone, onCancel }: { group: { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; address: string | null; notes: string | null }; onDone: () => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({ name: group.name, contact_name: group.contact_name ?? '', email: group.email ?? '', phone: group.phone ?? '', website: group.website ?? '', address: group.address ?? '', notes: group.notes ?? '' })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateRepGroup(group.id, { name: form.name.trim(), contact_name: form.contact_name.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, website: form.website.trim() || null, address: form.address.trim() || null, notes: form.notes.trim() || null })
      toast.success('Saved')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={submit} className="mb-6 grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 sm:grid-cols-2">
      <FormField label="Name" htmlFor="rg-name"><Input id="rg-name" required value={form.name} onChange={(e) => set('name', e.target.value)} /></FormField>
      <FormField label="Contact" htmlFor="rg-contact"><Input id="rg-contact" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} /></FormField>
      <FormField label="Email" htmlFor="rg-email"><Input id="rg-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></FormField>
      <FormField label="Phone" htmlFor="rg-phone"><Input id="rg-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></FormField>
      <FormField label="Website" htmlFor="rg-web"><Input id="rg-web" value={form.website} onChange={(e) => set('website', e.target.value)} /></FormField>
      <FormField label="Address" htmlFor="rg-addr"><Input id="rg-addr" value={form.address} onChange={(e) => set('address', e.target.value)} /></FormField>
      <FormField label="Notes" htmlFor="rg-notes" className="sm:col-span-2"><Textarea id="rg-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={saving}>Save</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
