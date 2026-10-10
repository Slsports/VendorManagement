import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { addPartnerContact, deletePartnerContact, getPartner, updatePartner, updatePartnerContact, upsertPartner } from '@/services/partners'
import { errorMessage } from '@/lib/utils'
import type { PartnerContact } from '@/types'
import { Alert, Button, FormField, Input, Spinner } from '@/components/ui'

/** Worldwide Distributors: our member number, their main line, and their roster. Ticked people are the key contacts, listed first on the WWD contacts page. */
export default function PartnerSettings() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? getPartner(organization.id, 'worldwide') : null), [organization?.id])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', department: '', title: '', extension: '', email: '', show_on_vendor: false })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const p = q.data

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!organization) return null

  async function createPartner() {
    try {
      await upsertPartner({ organization_id: organization!.id, route: 'worldwide', name: 'Worldwide Distributors' })
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function saveField(field: 'member_number' | 'main_phone' | 'website' | 'notes', value: string) {
    if (!p) return
    try {
      await updatePartner(p.id, { [field]: value.trim() || null })
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function toggle(c: PartnerContact, show: boolean) {
    try {
      await updatePartnerContact(c.id, { show_on_vendor: show })
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function remove(c: PartnerContact) {
    if (!window.confirm(`Remove ${c.name}?`)) return
    try {
      await deletePartnerContact(c.id)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!p) return
    setSaving(true)
    try {
      await addPartnerContact({ organization_id: organization!.id, partner_id: p.id, name: form.name.trim(), department: form.department.trim() || null, title: form.title.trim() || null, extension: form.extension.trim() || null, email: form.email.trim() || null, show_on_vendor: form.show_on_vendor, sort_order: form.show_on_vendor ? 50 : 100 })
      setForm({ name: '', department: '', title: '', extension: '', email: '', show_on_vendor: false })
      setAdding(false)
      toast.success('Contact added')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!p) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-stone-600">Worldwide Distributors is not set up yet. Load their roster with <code className="rounded bg-stone-100 px-1">npm run import:wwd-roster</code>, or start by hand.</p>
        <Button onClick={() => void createPartner()}>Set up Worldwide</Button>
      </div>
    )
  }

  const contacts = p.partner_contacts.filter((c) => !filter || `${c.name} ${c.department} ${c.title} ${c.email}`.toLowerCase().includes(filter.toLowerCase()))
  const byDept = new Map<string, PartnerContact[]>()
  for (const c of contacts) byDept.set(c.department ?? 'Other', [...(byDept.get(c.department ?? 'Other') ?? []), c])

  return (
    <div className="space-y-6">
      <section className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Our member number" htmlFor="pw-member"><Input id="pw-member" key={p.member_number ?? ''} defaultValue={p.member_number ?? ''} onBlur={(e) => void saveField('member_number', e.target.value)} /></FormField>
        <FormField label="Main phone" htmlFor="pw-phone"><Input id="pw-phone" key={p.main_phone ?? ''} defaultValue={p.main_phone ?? ''} onBlur={(e) => void saveField('main_phone', e.target.value)} /></FormField>
        <FormField label="Website" htmlFor="pw-web"><Input id="pw-web" key={p.website ?? ''} defaultValue={p.website ?? ''} onBlur={(e) => void saveField('website', e.target.value)} /></FormField>
        <FormField label="Notes" htmlFor="pw-notes"><Input id="pw-notes" key={p.notes ?? ''} defaultValue={p.notes ?? ''} onBlur={(e) => void saveField('notes', e.target.value)} /></FormField>
        <p className="text-xs text-stone-500 sm:col-span-2 lg:col-span-4">Changes save when you leave the box. Ticked people are the key contacts, listed first on the WWD contacts page that everyone sees.</p>
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Roster <span className="font-normal text-stone-400">({p.partner_contacts.length})</span></h2>
          <div className="flex gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" aria-label="Filter roster" className="h-9 sm:w-56" />
            {!adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add person</Button> : null}
          </div>
        </div>
        {adding ? (
          <form onSubmit={submit} className="mb-4 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-3">
            <FormField label="Name" htmlFor="pc-name"><Input id="pc-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
            <FormField label="Department" htmlFor="pc-dept"><Input id="pc-dept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></FormField>
            <FormField label="Title" htmlFor="pc-title"><Input id="pc-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
            <FormField label="Extension" htmlFor="pc-ext"><Input id="pc-ext" value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })} /></FormField>
            <FormField label="Email" htmlFor="pc-email"><Input id="pc-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={form.show_on_vendor} onChange={(e) => setForm({ ...form, show_on_vendor: e.target.checked })} /> Key contact</label>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" loading={saving}>Save</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        ) : null}
        {[...byDept.entries()].map(([dept, list]) => (
          <div key={dept} className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">{dept}</h3>
            <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={c.show_on_vendor} onChange={(e) => void toggle(c, e.target.checked)} aria-label={`${c.name} is a key contact`} /></label>
                  <span className="w-40 font-medium text-stone-900">{c.name}</span>
                  <span className="min-w-0 flex-1 text-stone-600">{c.title}</span>
                  <span className="text-stone-600">{c.extension ? `ext ${c.extension}` : ''}</span>
                  {c.email ? <a href={`mailto:${c.email}`} className="text-brand hover:underline">{c.email}</a> : null}
                  <button type="button" onClick={() => void remove(c)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-600" aria-label={`Remove ${c.name}`}><Trash2 className="size-4" aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
