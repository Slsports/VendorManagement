import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, Mail, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { addVendorEmail, deleteVendorEmail, updateVendor, updateVendorEmail } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { CONTACT_TYPE_LABELS } from '@/lib/vendors'
import { cn, errorMessage } from '@/lib/utils'
import type { ContactType } from '@/types'
import { peopleFor, type ContactsVendor, type PersonRow } from '@/lib/contacts'
import { Badge, Button, FormField, Input } from '@/components/ui'
import { FoldSection } from '@/components/shared/FoldSection'
import { PhoneLinks, PhonesEditor } from '@/components/shared/Phones'
import { cleanPhones, type ContactPhone } from '@/lib/phones'

/**
 * Reps & contacts: any number of people, one starred as our assigned rep (follow-ups go to them). Each person can be
 * several kinds at once, ticked as boxes (Dana, Oct 12: Barry at Royal Deluxe is the rep and the owner).
 */
export function VendorContactsSection({ vendor: v, canEdit, onChange, onEmail, defaultOpen = false, addRep = 0 }: { vendor: ContactsVendor; canEdit: boolean; onChange: () => Promise<unknown>; onEmail: (email: string) => void; defaultOpen?: boolean; addRep?: number }) {
  const [adding, setAdding] = useState(false)
  /** Opened from "Add our rep": the new contact becomes our assigned rep. */
  const [asOurRep, setAsOurRep] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  /** The contact being edited (its id), or null when adding a new one. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const blank = { contact_name: '', email: '', phones: [] as ContactPhone[], title: '', roles: ['rep'] as ContactType[] }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const people = peopleFor(v)

  // "Add our rep" at the top of the vendor page: open this section on a new contact with Rep ticked, and scroll to it.
  const [seenAddRep, setSeenAddRep] = useState(addRep)
  if (addRep !== seenAddRep) {
    setSeenAddRep(addRep)
    if (canEdit) {
      setForm({ contact_name: '', email: '', phones: [], title: '', roles: ['rep'] })
      setEditingId(null)
      setAsOurRep(true)
      setAdding(true)
      setOpen(true)
    }
  }
  useEffect(() => {
    if (addRep) requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [addRep])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.contact_name.trim() && !form.email.trim() && !cleanPhones(form.phones).length) { toast.error('Add a name, email or phone.'); return }
    if (!form.roles.length) { toast.error('Tick at least one box: Rep, Owner, Orders…'); return }
    setSaving(true)
    try {
      const fields = { email: form.email.trim().toLowerCase() || null, contact_name: form.contact_name.trim() || null, phones: cleanPhones(form.phones), title: form.title.trim() || null, roles: form.roles, contact_type: form.roles[0]! }
      if (editingId) await updateVendorEmail(editingId, fields)
      else {
        const made = await addVendorEmail({ vendor_id: v.id, ...fields, source: 'manual' })
        if (asOurRep) await updateVendor(v.id, { assigned_rep_contact_id: made.id, assigned_rep_group_contact_id: null })
      }
      toast.success(editingId ? 'Contact saved' : asOurRep ? 'Our rep added' : 'Contact added')
      setForm(blank)
      setAdding(false)
      setAsOurRep(false)
      setEditingId(null)
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

  function edit(p: PersonRow) {
    setForm({ contact_name: p.name ?? '', email: p.email ?? '', phones: p.phones, title: p.title ?? '', roles: p.roles })
    setEditingId(p.id)
    setAdding(true)
  }
  const toggleRole = (r: ContactType) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }))

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
    <div ref={box} className="scroll-mt-4 lg:col-span-2">
    <FoldSection title="Reps & contacts" open={open} onOpenChange={setOpen}
      summary={people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : 'None'}
      actions={canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => { setForm(blank); setEditingId(null); setAsOurRep(false); setAdding(true); setOpen(true) }} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add contact</Button> : null}>
      {people.length > 0 ? <p className="mt-1 text-xs text-stone-500">The starred rep is our assigned rep: follow-ups go to them, whoever took the order.</p> : null}
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="c-name"><Input id="c-name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} autoFocus /></FormField>
          <FormField label="Email" htmlFor="c-email"><Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <div className="sm:col-span-2"><PhonesEditor idPrefix="c" value={form.phones} onChange={(phones) => setForm({ ...form, phones })} /></div>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-stone-700">They are our… (tick all that fit)</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
              {(Object.keys(CONTACT_TYPE_LABELS) as ContactType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm text-stone-700">
                  <input type="checkbox" checked={form.roles.includes(t)} onChange={() => toggleRole(t)} className="size-4 accent-brand" /> {CONTACT_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
          {asOurRep ? <p className="text-xs text-stone-500 sm:col-span-2">Saved as our assigned rep (starred), shown at the top of the vendor page.</p> : null}
          <FormField label="Job title (optional)" htmlFor="c-title" className="sm:col-span-2"><Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Show rep, Regional Sales Manager" /></FormField>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>Save contact</Button>
            <Button type="button" variant="ghost" onClick={() => { setAdding(false); setEditingId(null); setAsOurRep(false) }}>Cancel</Button>
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
                    {p.name || p.email || p.phones[0]?.number}
                    {p.starred ? <Badge tone="warning" className="ml-1">Our rep</Badge> : null}
                    <Badge tone="neutral" className="ml-1">{p.kind === 'group' ? <Link to={`${ROUTES.repGroups}/${v.rep_groups!.id}`} className="hover:underline">{p.type}</Link> : p.type}</Badge>
                    {p.title ? <span className="ml-2 text-xs font-normal text-stone-500">{p.title}</span> : null}
                    {p.learned ? <span className="ml-2 text-xs font-normal text-stone-400" title={p.note ?? undefined}>Learned from email</span> : null}
                  </p>
                  <p className="flex flex-wrap gap-x-4 text-stone-600">
                    {p.email ? (canEdit
                      ? <button type="button" onClick={() => onEmail(p.email!)} className="inline-flex items-center gap-1 hover:text-brand" title="Write an email from VMS"><Mail className="size-3.5" aria-hidden="true" />{p.email}</button>
                      : <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" aria-hidden="true" />{p.email}</a>) : null}
                    <PhoneLinks phones={p.phones} />
                  </p>
                </div>
              </div>
              {canEdit && p.kind === 'vendor' ? (
                <span className="flex shrink-0 items-center">
                <button type="button" onClick={() => edit(p)} aria-label={`Edit ${p.name || p.email}`} title="Edit" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                  <Pencil className="size-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void remove(p.id)} aria-label={`Remove ${p.name || p.email}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!people.some((p) => p.email) ? <p className="mt-2 inline-flex items-center gap-1 text-xs text-stone-400"><AlertTriangle className="size-3.5" aria-hidden="true" /> The discrepancy and status emails need a contact with an email.</p> : null}
    </FoldSection>
    </div>
  )
}
