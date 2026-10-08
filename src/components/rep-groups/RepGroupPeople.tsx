import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Mail, Phone, Plus, Trash2 } from 'lucide-react'
import { addRepGroupContact, deleteRepGroupContact } from '@/services/lines'
import { errorMessage } from '@/lib/utils'
import type { RepGroupContact } from '@/types'
import { Button, FormField, Input } from '@/components/ui'

/** The reps at a rep group. Mail from any of their addresses files to the rep group. */
export function RepGroupPeople({ repGroupId, people, canEdit, onChange }: { repGroupId: string; people: RepGroupContact[]; canEdit: boolean; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', title: '', email: '', phone: '' })
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() && !form.email.trim() && !form.phone.trim()) { toast.error('Add a name, email or phone.'); return }
    setSaving(true)
    try {
      await addRepGroupContact({ rep_group_id: repGroupId, name: form.name.trim() || null, title: form.title.trim() || null, email: form.email.trim().toLowerCase() || null, phone: form.phone.trim() || null })
      setForm({ name: '', title: '', email: '', phone: '' })
      setAdding(false)
      toast.success('Rep added')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
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
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add rep</Button> : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">Mail from any of these addresses files to this rep group. Star our assigned rep on each vendor's page.</p>
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="rp-name"><Input id="rp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></FormField>
          <FormField label="Title (optional)" htmlFor="rp-title"><Input id="rp-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Show rep" /></FormField>
          <FormField label="Email" htmlFor="rp-email"><Input id="rp-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <FormField label="Phone" htmlFor="rp-phone"><Input id="rp-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>Save rep</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {people.length === 0 && !adding ? <p className="mt-3 text-sm text-stone-500">No reps on file yet.</p> : (
        <ul className="mt-3 divide-y divide-stone-100">
          {people.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-stone-900">{p.name || p.email || p.phone}{p.title ? <span className="ml-2 text-xs font-normal text-stone-500">{p.title}</span> : null}</p>
                <p className="flex flex-wrap gap-x-4 text-stone-600">
                  {p.email ? <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" aria-hidden="true" />{p.email}</a> : null}
                  {p.phone ? <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-brand"><Phone className="size-3.5" aria-hidden="true" />{p.phone}</a> : null}
                </p>
              </div>
              {canEdit ? (
                <button type="button" onClick={() => void remove(p)} aria-label={`Remove ${p.name || p.email}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
