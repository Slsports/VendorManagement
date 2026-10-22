import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { mergePeople, repGroupFromSender, senderPeople, type NamedVendor, type RepPerson } from '@/services/repAgency'
import { clearPickerCache } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { Button, FormField, Input } from '@/components/ui'

/**
 * New rep group from a "Who is this?" card (Dana, Oct 21: Turner Group Reps, 33 emails naming six of our vendors). The
 * name, website and phone Claude read, the people who wrote (Claude's reading of the signatures and the From lines) and
 * every vendor the mail names are filled in; untick what is wrong, then Create. The sender's mail is filed to the group
 * and tagged to each vendor it names; a line with another rep group comes back as a card.
 */
export function NewRepGroupFromMail({ senderId, company, website, phone, people, named, onDone, onCancel }: {
  senderId: string; company: string; website: string | null; phone: string | null; people: RepPerson[]; named: NamedVendor[]
  onDone: () => void | Promise<void>; onCancel: () => void
}) {
  const [name, setName] = useState(company)
  const [site, setSite] = useState(website ?? '')
  const [tel, setTel] = useState(phone ?? '')
  const fromMail = useSupabaseQuery(() => senderPeople(senderId), [senderId])
  const all = mergePeople(people, fromMail.data ?? [])
  const [skipPeople, setSkipPeople] = useState<Set<string>>(new Set())
  const [vendors, setVendors] = useState<{ id: string; name: string; n?: number; rep_group?: string | null }[]>(named)
  const [skipVendors, setSkipVendors] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const key = (p: RepPerson) => p.email ?? p.name
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }

  async function create() {
    setBusy(true)
    try {
      const r = await repGroupFromSender(senderId, name.trim(), site.trim(), tel.trim(), all.filter((p) => !skipPeople.has(key(p))), vendors.filter((v) => !skipVendors.has(v.id)).map((v) => v.id))
      clearPickerCache()
      const parts = [
        r.people ? `${r.people} ${r.people === 1 ? 'person' : 'people'} saved` : null,
        r.lines_added.length ? `lines added: ${r.lines_added.join(', ')}` : null,
        r.tagged ? `${r.tagged} email${r.tagged === 1 ? '' : 's'} tagged to the vendors they name` : null,
        r.asked ? `${r.asked} line${r.asked === 1 ? '' : 's'} with another rep group sent to Review` : null,
      ].filter(Boolean)
      toast.success(`${name.trim()} ${r.created ? 'added to Rep Groups' : 'was already in Rep Groups'}${parts.length ? `: ${parts.join('; ')}` : ''}`, { duration: 8000 })
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <FormField label="Rep group name" htmlFor={`rg-name-${senderId}`}><Input id={`rg-name-${senderId}`} value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Website" htmlFor={`rg-site-${senderId}`}><Input id={`rg-site-${senderId}`} value={site} onChange={(e) => setSite(e.target.value)} /></FormField>
        <FormField label="Phone" htmlFor={`rg-tel-${senderId}`}><Input id={`rg-tel-${senderId}`} value={tel} onChange={(e) => setTel(e.target.value)} /></FormField>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-stone-700">People (from their signatures and emails)</legend>
        {all.length ? (
          <ul className="mt-1 space-y-1">
            {all.map((p) => (
              <li key={key(p)}>
                <label className="flex items-start gap-2 text-sm text-stone-800">
                  <input type="checkbox" checked={!skipPeople.has(key(p))} onChange={() => setSkipPeople((s) => toggle(s, key(p)))} className="mt-0.5 size-4 accent-brand" />
                  <span>{[p.name || null, p.title, p.email, p.phone].filter(Boolean).join(' · ')}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-xs text-stone-500">{fromMail.isLoading ? 'Looking…' : 'No one found in the mail.'}</p>}
      </fieldset>
      <fieldset>
        <legend className="text-xs font-medium text-stone-700">Lines they rep (vendors their mail names)</legend>
        <ul className="mt-1 space-y-1">
          {vendors.map((v) => (
            <li key={v.id}>
              <label className="flex items-start gap-2 text-sm text-stone-800">
                <input type="checkbox" checked={!skipVendors.has(v.id)} onChange={() => setSkipVendors((s) => toggle(s, v.id))} className="mt-0.5 size-4 accent-brand" />
                <span>{v.name}{v.n ? <span className="text-stone-500"> · named in {v.n} email{v.n === 1 ? '' : 's'}</span> : null}{v.rep_group ? <span className="text-amber-800"> · with {v.rep_group} now (you'll be asked)</span> : null}</span>
              </label>
            </li>
          ))}
        </ul>
        <VendorPicker className="mt-1 sm:w-72" placeholder="Add another line" onPick={(v) => setVendors((x) => (x.some((y) => y.id === v.id) ? x : [...x, { id: v.id, name: v.name }]))} />
      </fieldset>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={!name.trim()} onClick={() => void create()} leftIcon={<Check className="size-4" aria-hidden="true" />}>Create rep group</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
