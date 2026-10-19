import { useState, type FormEvent } from 'react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { History, Mail, Pencil, Plus, RotateCcw, Trash2, UserPlus, UserX } from 'lucide-react'
import { addRepGroupContact, deleteRepGroupContact, updateRepGroupContact } from '@/services/lines'
import { mailWithUrl } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { listRepsOnGroupVendors, moveContactToRepGroup, setRepGroupContact } from '@/services/vendors'
import { cn, errorMessage } from '@/lib/utils'
import { cleanPhones, phonesOf, type ContactPhone } from '@/lib/phones'
import { PhoneLinks, PhonesEditor } from '@/components/shared/Phones'
import type { RepGroupContact } from '@/types'
import { Button, FormField, Input } from '@/components/ui'

/**
 * The reps at a rep group. Mail from any of their addresses files to the rep group. Click a rep to change them (Dana, Oct 15).
 * Adding one offers the reps already typed on its vendors, so nobody is typed twice (Dana, Oct 16).
 */
export function RepGroupPeople({ repGroupId, people, canEdit, onChange }: { repGroupId: string; people: RepGroupContact[]; canEdit: boolean; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  /** The rep being changed, or null when adding one. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', title: '', email: '', phones: [] as ContactPhone[] })
  const [saving, setSaving] = useState(false)
  const typedQ = useSupabaseQuery(() => (canEdit && adding && !editingId ? listRepsOnGroupVendors(repGroupId) : Promise.resolve([])), [repGroupId, canEdit, adding, editingId])
  const typed = (typedQ.data ?? []).filter((t) => !people.some((p) => p.email && t.email && p.email.toLowerCase() === t.email.toLowerCase()))

  async function pick(id: string, name: string) {
    try {
      await moveContactToRepGroup(id)
      toast.success(`${name} added: shows on every vendor this group reps`)
      setAdding(false)
      await typedQ.refetch()
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

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

  /** No longer with the group (Dana, Oct 19): kept under Former reps, so their old mail can be found by name. */
  async function setFormer(p: RepGroupContact, isFormer: boolean) {
    try {
      await setRepGroupContact(p.id, isFormer ? 'former' : 'current')
      toast.success(isFormer ? `${p.name || p.email} moved to Former reps` : `${p.name || p.email} is a current rep again`)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function remove(p: RepGroupContact) {
    if (!window.confirm(`Delete ${p.name || p.email || 'this rep'}?\n\nOnly for a mistake. Someone who has left goes under "No longer with them", so their old emails can still be found.`)) return
    try {
      await deleteRepGroupContact(p.id)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const current = people.filter((p) => !p.former_at)
  const former = people.filter((p) => p.former_at)
  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Reps <span className="font-normal text-stone-400">({current.length})</span></h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => { setForm({ name: '', title: '', email: '', phones: [] }); setEditingId(null); setAdding(true) }} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add rep</Button> : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">Mail from any of these addresses files to this rep group. They are the main rep on the vendors they rep, unless someone else is picked there.{canEdit ? ' Click a rep to change them.' : ''}</p>
      {adding && !editingId && typed.length ? (
        <div className="mt-3 rounded-xl bg-stone-50 p-4">
          <p className="text-sm font-medium text-stone-700">Already on its vendors</p>
          <p className="text-xs text-stone-500">Pick one instead of typing them again. They move here and show on every vendor this group reps.</p>
          <ul className="mt-2 divide-y divide-stone-200">
            {typed.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0"><span className="font-medium text-stone-900">{t.name || t.email}</span>{t.email && t.name ? <span className="ml-2 text-stone-500">{t.email}</span> : null}<span className="ml-2 text-xs text-stone-400">on {t.vendor}</span></span>
                <Button size="sm" variant="secondary" onClick={() => void pick(t.id, t.name || t.email || 'Rep')} leftIcon={<UserPlus className="size-3.5" aria-hidden="true" />}>Add to this group</Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">Someone new? Type them below.</p>
        </div>
      ) : null}
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
      {current.length === 0 && !adding ? <p className="mt-3 text-sm text-stone-500">No reps on file yet.</p> : (
        <ul className="mt-3 divide-y divide-stone-100">
          {current.map((p) => (
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
                  <button type="button" onClick={() => void setFormer(p, true)} aria-label={`${p.name || p.email} is no longer with them`} title="No longer with them (kept under Former reps)" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                    <UserX className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => void remove(p)} aria-label={`Delete ${p.name || p.email}`} title="Delete (a mistake only)" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {former.length ? (
        <details className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none font-medium text-stone-700"><History className="mr-1 inline size-4 align-[-3px] text-stone-400" aria-hidden="true" />Former reps ({former.length})</summary>
          <ul className="mt-2 divide-y divide-stone-200">
            {former.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-stone-800">{p.name || p.email || p.phone}{p.title ? <span className="ml-2 text-xs font-normal text-stone-500">{p.title}</span> : null}</p>
                  <p className="flex flex-wrap gap-x-4 text-stone-600">
                    {p.email ? <Link to={mailWithUrl(ROUTES.mailWith, p.email)} className="inline-flex items-center gap-1 hover:text-brand" title="All mail with them"><Mail className="size-3.5" aria-hidden="true" />{p.email}</Link> : null}
                    <PhoneLinks phones={phonesOf(p)} />
                  </p>
                  <p className="text-xs text-stone-500">
                    {p.first_mail_at && p.last_mail_at ? `Emailed ${monthYear(p.first_mail_at)}${monthYear(p.first_mail_at) !== monthYear(p.last_mail_at) ? ` to ${monthYear(p.last_mail_at)}` : ''}` : 'No email with them on file'}
                    {' · '}no longer with them since {new Date(p.former_at!).toLocaleDateString()}
                  </p>
                </div>
                {canEdit ? <Button size="sm" variant="ghost" onClick={() => void setFormer(p, false)} leftIcon={<RotateCcw className="size-3.5" aria-hidden="true" />}>Current again</Button> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

const monthYear = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
