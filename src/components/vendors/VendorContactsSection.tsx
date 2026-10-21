import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, History, Mail, Pencil, Plus, RotateCcw, Star, Trash2, UserX } from 'lucide-react'
import { addVendorEmail, moveContactToRepGroup, setRepGroupContact, setVendorContact, updateVendor, updateVendorEmail } from '@/services/vendors'
import { updateRepGroupContact } from '@/services/lines'
import { threadsOfEmails } from '@/services/orders'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { ROUTES } from '@/lib/constants'
import { CONTACT_TYPE_LABELS } from '@/lib/vendors'
import { cn, errorMessage } from '@/lib/utils'
import type { ContactType } from '@/types'
import { formerFor, ourReps, peopleFor, type ContactsVendor, type PersonRow } from '@/lib/contacts'
import { mailWithUrl } from '@/lib/mail'
import { Badge, Button, FormField, Input } from '@/components/ui'
import { FoldSection } from '@/components/shared/FoldSection'
import { PhoneLinks, PhonesEditor } from '@/components/shared/Phones'
import { cleanPhones, type ContactPhone } from '@/lib/phones'

/**
 * Reps & contacts: any number of people, one of them our main rep, the person we place orders through (shown at the top
 * of the vendor page; with a rep group it is the group's rep unless another is picked). Everyone else is there for
 * customer service, shipping or billing. Each person can be several kinds at once, ticked as boxes (Dana, Oct 12: Barry
 * at Royal Deluxe is the rep and the owner). Click any card to change it (Dana, Oct 15), rep group people included.
 */
export function VendorContactsSection({ vendor: v, canEdit, onChange, onEmail, defaultOpen = false, addRep = 0 }: { vendor: ContactsVendor; canEdit: boolean; onChange: () => Promise<unknown>; onEmail: (email: string) => void; defaultOpen?: boolean; addRep?: number }) {
  const [adding, setAdding] = useState(false)
  /** Opened from "Add our rep": the new contact becomes our assigned rep. */
  const [asOurRep, setAsOurRep] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(defaultOpen)
  /** The contact being edited (its id), or null when adding a new one. */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Editing someone at the rep group (no role boxes: they are the group's rep). */
  const [editingGroup, setEditingGroup] = useState(false)
  const blank = { contact_name: '', email: '', phones: [] as ContactPhone[], title: '', roles: ['rep'] as ContactType[] }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  /**
   * A rep typed here works for the vendor's rep group: save them on the group once, shown on every vendor it reps
   * (Dana, Oct 16: "I need a way to only have to enter it once"). Ticked for a new rep; an existing card can be moved.
   */
  const [toGroup, setToGroup] = useState(false)
  const group = v.rep_groups
  const showToGroup = !!group && !editingGroup && form.roles.includes('rep')
  const people = peopleFor(v)
  const former = formerFor(v)
  const main = new Set(ourReps(v).map((p) => p.key))
  // the conversation of each email a contact was learned from, to open that exact email (Dana, Oct 21)
  const learnedIds = [...new Set(people.map((p) => p.learnedEmailId).filter((id): id is string => !!id))]
  const learnedThreads = useSupabaseQuery(() => threadsOfEmails(learnedIds), [learnedIds.join()])
  const learnedThread = (p: PersonRow) => (p.learnedEmailId ? learnedThreads.data?.get(p.learnedEmailId) ?? null : null)

  // "Add our rep" at the top of the vendor page: open this section on a new contact with Rep ticked, and scroll to it.
  const [seenAddRep, setSeenAddRep] = useState(addRep)
  if (addRep !== seenAddRep) {
    setSeenAddRep(addRep)
    if (canEdit) {
      setForm({ contact_name: '', email: '', phones: [], title: '', roles: ['rep'] })
      setEditingId(null)
      setToGroup(!!v.rep_groups)
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
    if (!editingGroup && !form.roles.length) { toast.error('Tick at least one box: Rep, Owner, Orders…'); return }
    setSaving(true)
    try {
      const fields = { email: form.email.trim().toLowerCase() || null, contact_name: form.contact_name.trim() || null, phones: cleanPhones(form.phones), title: form.title.trim() || null, roles: form.roles, contact_type: form.roles[0]! }
      const moving = showToGroup && toGroup
      if (editingId && editingGroup) await updateRepGroupContact(editingId, { name: fields.contact_name, email: fields.email, phones: fields.phones, title: fields.title })
      else if (editingId) {
        await updateVendorEmail(editingId, fields)
        if (moving) await moveContactToRepGroup(editingId)
      } else {
        const made = await addVendorEmail({ vendor_id: v.id, ...fields, source: 'manual' })
        if (asOurRep) await updateVendor(v.id, { assigned_rep_contact_id: made.id, assigned_rep_group_contact_id: null })
        if (moving) await moveContactToRepGroup(made.id)
      }
      toast.success(moving ? `Saved on ${group!.name}: shows on every vendor they rep` : editingId ? 'Contact saved' : asOurRep ? 'Our rep added' : 'Contact added')
      setForm(blank)
      setAdding(false)
      setAsOurRep(false)
      setEditingId(null)
      setEditingGroup(false)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function makeMain(p: PersonRow) {
    try {
      await updateVendor(v.id, { assigned_rep_contact_id: p.kind === 'vendor' ? p.id : null, assigned_rep_group_contact_id: p.kind === 'group' ? p.id : null })
      toast.success(`${p.name || p.email} is our main rep`)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  function edit(p: PersonRow) {
    setForm({ contact_name: p.name ?? '', email: p.email ?? '', phones: p.phones, title: p.title ?? '', roles: p.roles })
    setEditingId(p.id)
    setEditingGroup(p.kind === 'group')
    setToGroup(false)
    setAsOurRep(false)
    setAdding(true)
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const toggleRole = (r: ContactType) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }))

  /** Someone who has left (Dana, Oct 19): kept, folded under Former contacts, so their old mail can still be found by name. */
  async function setFormer(p: PersonRow, isFormer: boolean) {
    try {
      if (p.kind === 'vendor') await setVendorContact(p.id, isFormer ? 'former' : 'current')
      else await setRepGroupContact(p.id, isFormer ? 'former' : 'current')
      toast.success(isFormer ? `${p.name || p.email} moved to Former contacts` : `${p.name || p.email} is a current contact again`)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  /** Delete is for mistakes only: an import never adds them back. */
  async function remove(p: PersonRow) {
    if (!window.confirm(`Delete ${p.name || p.email}?\n\nOnly for a mistake (they were never this vendor's contact). Someone who has left goes under "No longer their rep" instead, so you can still find their old emails.`)) return
    try {
      await setVendorContact(p.id, 'delete')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div ref={box} className="scroll-mt-4 lg:col-span-2">
    <FoldSection title="Reps & contacts" open={open} onOpenChange={setOpen}
      summary={people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : 'None'}
      actions={canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => { setForm(blank); setEditingId(null); setEditingGroup(false); setToGroup(!!v.rep_groups); setAsOurRep(false); setAdding(true); setOpen(true) }} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add contact</Button> : null}>
      {people.length > 0 ? <p className="mt-1 text-xs text-stone-500">The <strong>Main rep</strong> is who we place orders through, shown at the top of the page. Everyone else is for customer service, shipping or billing questions.{canEdit ? ' Click anyone to change them.' : ''}</p> : null}
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="c-name"><Input id="c-name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} autoFocus /></FormField>
          <FormField label="Email" htmlFor="c-email"><Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <div className="sm:col-span-2"><PhonesEditor idPrefix="c" value={form.phones} onChange={(phones) => setForm({ ...form, phones })} /></div>
          {editingGroup ? <p className="text-xs text-stone-500 sm:col-span-2">A rep at {v.rep_groups?.name ?? 'the rep group'}: changes show on every vendor they rep.</p> : (
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
          )}
          {showToGroup ? (
            <label className="flex items-start gap-2 rounded-lg bg-white p-2.5 text-sm text-stone-700 ring-1 ring-stone-200 sm:col-span-2">
              <input type="checkbox" checked={toGroup} onChange={(e) => setToGroup(e.target.checked)} className="mt-0.5 size-4 accent-brand" />
              <span><strong>Works for {group!.name}</strong><span className="block text-xs text-stone-500">Saved once on the rep group and shown on every vendor {group!.name} reps, so you never type them twice.</span></span>
            </label>
          ) : null}
          {asOurRep ? <p className="text-xs text-stone-500 sm:col-span-2">Saved as our main rep, shown at the top of the vendor page.</p> : null}
          <FormField label="Job title (optional)" htmlFor="c-title" className="sm:col-span-2"><Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Show rep, Regional Sales Manager" /></FormField>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>Save contact</Button>
            <Button type="button" variant="ghost" onClick={() => { setAdding(false); setEditingId(null); setEditingGroup(false); setAsOurRep(false) }}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {people.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-stone-500">No contacts yet. They arrive from the mailbox and the vendor form, or add one here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {people.map((p) => (
            <li key={p.key} onClick={canEdit ? () => edit(p) : undefined} className={cn('flex items-start justify-between gap-3 py-2.5 text-sm', canEdit && 'cursor-pointer rounded-lg hover:bg-stone-50')}>
              <div className="flex min-w-0 items-start gap-2">
                {main.has(p.key) ? <Star className="mt-1 size-4 shrink-0 fill-amber-400 text-amber-500" aria-hidden="true" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">
                    {canEdit
                      ? <button type="button" onClick={(e) => { e.stopPropagation(); edit(p) }} className="text-left hover:text-brand hover:underline" title="Change">{p.name || p.email || p.phones[0]?.number}</button>
                      : p.name || p.email || p.phones[0]?.number}
                    {main.has(p.key) ? <Badge tone="warning" className="ml-1">Main rep</Badge> : null}
                    <Badge tone="neutral" className="ml-1">{p.kind === 'group' ? <Link to={`${ROUTES.repGroups}/${v.rep_groups!.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{p.type}</Link> : p.type}</Badge>
                    {p.title ? <span className="ml-2 text-xs font-normal text-stone-500">{p.title}</span> : null}
                    {p.confirmedAt ? <Badge tone="success" className="ml-1">Confirmed {new Date(p.confirmedAt).toLocaleDateString()}</Badge> : null}
                    {p.badEmail ? <Badge tone="danger" className="ml-1">Bad email</Badge> : null}
                    {/* where it was learned, one click (Dana, Oct 21): the exact email; learned before Oct 21, the mail with that address */}
                    {p.learned ? (learnedThread(p)
                      ? <Link to={`${ROUTES.mail}/${learnedThread(p)}?email=${p.learnedEmailId}`} onClick={(e) => e.stopPropagation()} className="ml-2 text-xs font-normal text-brand hover:underline" title={p.note ?? 'The email they were learned from'}>Learned from email</Link>
                      : p.email
                      ? <Link to={mailWithUrl(ROUTES.mailWith, p.email)} onClick={(e) => e.stopPropagation()} className="ml-2 text-xs font-normal text-brand hover:underline" title={p.note ?? 'All mail with them'}>Learned from email</Link>
                      : <span className="ml-2 text-xs font-normal text-stone-400" title={p.note ?? undefined}>Learned from email</span>) : null}
                    {p.portalUnconfirmed ? <span title="Only the WWD portal lists them: no email with them about this vendor in 24 months. Never shown as Main rep until confirmed."><Badge tone="warning" className="ml-1">From WWD · not confirmed</Badge></span> : null}
                  </p>
                  {/* links inside the card do their own thing, not open the editor */}
                  <p className="flex flex-wrap gap-x-4 text-stone-600" onClick={(e) => e.stopPropagation()}>
                    {p.email ? (canEdit
                      ? <button type="button" onClick={() => onEmail(p.email!)} className="inline-flex items-center gap-1 hover:text-brand" title="Write an email from VMS"><Mail className="size-3.5" aria-hidden="true" />{p.email}</button>
                      : p.learned
                        ? <Link to={mailWithUrl(ROUTES.mailWith, p.email)} className="inline-flex items-center gap-1 hover:text-brand" title="All mail with them"><Mail className="size-3.5" aria-hidden="true" />{p.email}</Link>
                        : <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail className="size-3.5" aria-hidden="true" />{p.email}</a>) : null}
                    <PhoneLinks phones={p.phones} />
                  </p>
                </div>
              </div>
              {canEdit ? (
                <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {!main.has(p.key) ? <Button size="sm" variant="ghost" onClick={() => void makeMain(p)} leftIcon={<Star className="size-3.5" aria-hidden="true" />}>Make main rep</Button> : null}
                  <button type="button" onClick={() => edit(p)} aria-label={`Change ${p.name || p.email}`} title="Change" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => void setFormer(p, true)} aria-label={`${p.name || p.email} is no longer there`} title={p.roles.includes('rep') ? 'No longer their rep (kept under Former contacts)' : 'No longer there (kept under Former contacts)'} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                    <UserX className="size-4" aria-hidden="true" />
                  </button>
                  {p.kind === 'vendor' ? (
                    <button type="button" onClick={() => void remove(p)} aria-label={`Delete ${p.name || p.email}`} title="Delete (a mistake only)" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {former.length ? <FormerContacts people={former} canEdit={canEdit} onCurrent={(p) => void setFormer(p, false)} /> : null}
      {!people.some((p) => p.email) ? <p className="mt-2 inline-flex items-center gap-1 text-xs text-stone-400"><AlertTriangle className="size-3.5" aria-hidden="true" /> The discrepancy and status emails need a contact with an email.</p> : null}
    </FoldSection>
    </div>
  )
}

const monthYear = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/**
 * Former contacts (Dana, Oct 19: "if we don't know the previous rep's name, it's harder to search for them"): folded,
 * with when we emailed them; the email opens all mail with them.
 */
function FormerContacts({ people, canEdit, onCurrent }: { people: PersonRow[]; canEdit: boolean; onCurrent: (p: PersonRow) => void }) {
  return (
    <details className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium text-stone-700"><History className="mr-1 inline size-4 align-[-3px] text-stone-400" aria-hidden="true" />Former contacts ({people.length})</summary>
      <ul className="mt-2 divide-y divide-stone-200">
        {people.map((p) => (
          <li key={p.key} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-stone-800">{p.name || p.email || p.phones[0]?.number}<span className="ml-2 text-xs font-normal text-stone-500">{p.type}{p.title ? ` · ${p.title}` : ''}</span></p>
              <p className="flex flex-wrap gap-x-4 text-stone-600">
                {p.email ? <Link to={mailWithUrl(ROUTES.mailWith, p.email)} className="inline-flex items-center gap-1 hover:text-brand" title="All mail with them"><Mail className="size-3.5" aria-hidden="true" />{p.email}</Link> : null}
                <PhoneLinks phones={p.phones} />
              </p>
              <p className="text-xs text-stone-500">
                {p.firstMailAt && p.lastMailAt ? `Emailed ${monthYear(p.firstMailAt)}${monthYear(p.firstMailAt) !== monthYear(p.lastMailAt) ? ` to ${monthYear(p.lastMailAt)}` : ''}` : 'No email with them on file'}
                {' · '}no longer there since {new Date(p.formerAt!).toLocaleDateString()}
              </p>
            </div>
            {canEdit ? <Button size="sm" variant="ghost" onClick={() => onCurrent(p)} leftIcon={<RotateCcw className="size-3.5" aria-hidden="true" />}>Current again</Button> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
