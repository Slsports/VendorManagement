import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, Mail, Phone, Plus, Star, Trash2 } from 'lucide-react'
import { addVendorEmail, deleteVendorEmail, updateVendor } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { CONTACT_TYPE_LABELS } from '@/lib/vendors'
import { cn, errorMessage } from '@/lib/utils'
import type { ContactType } from '@/types'
import { peopleFor, type ContactsVendor, type PersonRow } from '@/lib/contacts'
import { Badge, Button, FormField, Input, Select } from '@/components/ui'

/** Reps & contacts: any number of people, one starred as our assigned rep (follow-ups go to them). */
export function VendorContactsSection({ vendor: v, canEdit, onChange, onEmail }: { vendor: ContactsVendor; canEdit: boolean; onChange: () => Promise<void>; onEmail: (email: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ contact_name: '', email: '', phone: '', title: '', contact_type: 'rep' as ContactType })
  const [saving, setSaving] = useState(false)
  const people = peopleFor(v)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.contact_name.trim() && !form.email.trim() && !form.phone.trim()) { toast.error('Add a name, email or phone.'); return }
    setSaving(true)
    try {
      await addVendorEmail({ vendor_id: v.id, email: form.email.trim().toLowerCase() || null, contact_name: form.contact_name.trim() || null, phone: form.phone.trim() || null, title: form.title.trim() || null, contact_type: form.contact_type, source: 'manual' })
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

  async function star(p: PersonRow) {
    try {
      await updateVendor(v.id, p.starred
        ? { assigned_rep_contact_id: null, assigned_rep_group_contact_id: null }
        : { assigned_rep_contact_id: p.kind === 'vendor' ? p.id : null, assigned_rep_group_contact_id: p.kind === 'group' ? p.id : null })
      toast.success(p.starred ? 'No assigned rep' : `${p.name || p.email} is our assigned rep`)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Reps &amp; contacts</h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add contact</Button> : null}
      </div>
      {people.length > 0 ? <p className="mt-1 text-xs text-stone-500">The starred rep is our assigned rep: follow-ups go to them, whoever took the order.</p> : null}
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="c-name"><Input id="c-name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} autoFocus /></FormField>
          <FormField label="Email" htmlFor="c-email"><Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <FormField label="Phone" htmlFor="c-phone"><Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
          <FormField label="Kind" htmlFor="c-type">
            <Select id="c-type" value={form.contact_type} onChange={(e) => setForm({ ...form, contact_type: e.target.value as ContactType })}>
              {(Object.keys(CONTACT_TYPE_LABELS) as ContactType[]).map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}
            </Select>
          </FormField>
          <FormField label="Job title (optional)" htmlFor="c-title" className="sm:col-span-2"><Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Show rep, Regional Sales Manager" /></FormField>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>Save contact</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {people.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-stone-500">No contacts yet. They arrive from the mailbox and the vendor form, or add one here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {people.map((p) => (
            <li key={p.key} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                {canEdit ? (
                  <button type="button" onClick={() => void star(p)} aria-pressed={p.starred} aria-label={p.starred ? `${p.name || p.email} is our assigned rep` : `Make ${p.name || p.email || 'this contact'} our assigned rep`}
                    title={p.starred ? 'Our assigned rep' : 'Make our assigned rep'} className="mt-0.5 rounded p-0.5 hover:bg-stone-100">
                    <Star className={cn('size-4', p.starred ? 'fill-amber-400 text-amber-500' : 'text-stone-300')} aria-hidden="true" />
                  </button>
                ) : p.starred ? <Star className="mt-1 size-4 fill-amber-400 text-amber-500" aria-label="Our assigned rep" /> : null}
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">
                    {p.name || p.email || p.phone}
                    {p.starred ? <Badge tone="warning" className="ml-1">Our rep</Badge> : null}
                    <Badge tone="neutral" className="ml-1">{p.kind === 'group' ? <Link to={`${ROUTES.repGroups}/${v.rep_groups!.id}`} className="hover:underline">{p.type}</Link> : p.type}</Badge>
                    {p.title ? <span className="ml-2 text-xs font-normal text-stone-500">{p.title}</span> : null}
                  </p>
                  <p className="flex flex-wrap gap-x-4 text-stone-600">
                    {p.email ? (canEdit
                      ? <button type="button" onClick={() => onEmail(p.email!)} className="inline-flex items-center gap-1 hover:text-brand" title="Write an email from VMS"><Mail className="size-3.5" aria-hidden="true" />{p.email}</button>
                      : <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" aria-hidden="true" />{p.email}</a>) : null}
                    {p.phone ? <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-brand"><Phone className="size-3.5" aria-hidden="true" />{p.phone}</a> : null}
                  </p>
                </div>
              </div>
              {canEdit && p.kind === 'vendor' ? (
                <button type="button" onClick={() => void remove(p.id)} aria-label={`Remove ${p.name || p.email}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!people.some((p) => p.email) ? <p className="mt-2 inline-flex items-center gap-1 text-xs text-stone-400"><AlertTriangle className="size-3.5" aria-hidden="true" /> The discrepancy and status emails need a contact with an email.</p> : null}
    </section>
  )
}
