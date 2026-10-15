import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Mail, Pencil, Plus, Trash2 } from 'lucide-react'
import { addRepGroupContact, deleteRepGroupContact, updateRepGroupContact } from '@/services/lines'
import { cn, errorMessage } from '@/lib/utils'
import { cleanPhones, phonesOf, type ContactPhone } from '@/lib/phones'
import { PhoneLinks, PhonesEditor } from '@/components/shared/Phones'
import type { RepGroupContact } from '@/types'
import { Button, FormField, Input } from '@/components/ui'

/** The reps at a rep group. Mail from any of their addresses files to the rep group. Click a rep to change them (Dana, Oct 15). */
export function RepGroupPeople({ repGroupId, people, canEdit, onChange }: { repGroupId: string; people: RepGroupContact[]; canEdit: boolean; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  /** The rep being changed, or null when adding one. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', title: '', email: '', phones: [] as ContactPhone[] })
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() && !form.email.trim() && !cleanPhones(form.phones).length) { toast.error('Add a name, email or phone.'); return }
    setSaving(true)
    try {
      const fields = { name: form.name.trim() || null, title: form.title.trim() || null, email: form.email.trim().toLowerCase() || null, phones: cleanPhones(form.phones) }
      if (editingId) await updateRepGroupContact(editingId, fields)
      else await addRepGroupContact({ rep_group_id: repGroupId, ...fields })
      setForm({ name: '', title: '', email: '', phones: [] })
      setAdding(false)
      toast.success(editingId ? 'Rep saved' : 'Rep added')
      setEditingId(null)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function edit(p: RepGroupContact) {
    setForm({ name: p.name ?? '', title: p.title ?? '', email: p.email ?? '', phones: phonesOf(p) })
    setEditingId(p.id)
    setAdding(true)
  }

  async function remove(p: RepGroupContact) {
    if (!window.confirm(`Remove ${p.name || p.email || 'this rep'}?`)) return
    try {
      await deleteRepGroupContact(p.id)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Reps <span className="font-normal text-stone-400">({people.length})</span></h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => { setForm({ name: '', title: '', email: '', phones: [] }); setEditingId(null); setAdding(true) }} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add rep</Button> : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">Mail from any of these addresses files to this rep group. They are the main rep on the vendors they rep, unless someone else is picked there.{canEdit ? ' Click a rep to change them.' : ''}</p>
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="rp-name"><Input id="rp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></FormField>
          <FormField label="Title (optional)" htmlFor="rp-title"><Input id="rp-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Show rep" /></FormField>
          <FormField label="Email" htmlFor="rp-email"><Input id="rp-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <div className="sm:col-span-2"><PhonesEditor idPrefix="rp" value={form.phones} onChange={(phones) => setForm({ ...form, phones })} /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>{editingId ? 'Save changes' : 'Save rep'}</Button>
            <Button type="button" variant="ghost" onClick={() => { setAdding(false); setEditingId(null) }}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {people.length === 0 && !adding ? <p className="mt-3 text-sm text-stone-500">No reps on file yet.</p> : (
        <ul className="mt-3 divide-y divide-stone-100">
          {people.map((p) => (
            <li key={p.id} onClick={canEdit ? () => edit(p) : undefined} className={cn('flex items-start justify-between gap-3 py-2.5 text-sm', canEdit && 'cursor-pointer rounded-lg hover:bg-stone-50')}>
              <div className="min-w-0">
                <p className="font-medium text-stone-900">
                  {canEdit ? <button type="button" onClick={(e) => { e.stopPropagation(); edit(p) }} className="text-left hover:text-brand hover:underline" title="Change">{p.name || p.email || p.phone}</button> : p.name || p.email || p.phone}
                  {p.title ? <span className="ml-2 text-xs font-normal text-stone-500">{p.title}</span> : null}
                </p>
                <p className="flex flex-wrap gap-x-4 text-stone-600" onClick={(e) => e.stopPropagation()}>
                  {p.email ? <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" aria-hidden="true" />{p.email}</a> : null}
                  <PhoneLinks phones={phonesOf(p)} />
                </p>
              </div>
              {canEdit ? (
                <span className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => edit(p)} aria-label={`Change ${p.name || p.email}`} title="Change" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => void remove(p)} aria-label={`Remove ${p.name || p.email}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
