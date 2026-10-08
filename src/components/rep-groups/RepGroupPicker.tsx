import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { clearPickerCache, listRepGroupNames, type NamedRef } from '@/services/mail'
import { addRepGroupContact, createRepGroup } from '@/services/lines'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { FormField, Input, Select } from '@/components/ui'

const ADD = '__add__'

/** What a new rep group starts with when added from the picker (guessed from the email being filed). */
export interface NewRepGroupPrefill { name?: string; repName?: string; email?: string }

/** Rep group dropdown with "+ Add new rep group…" as its first choice (a small pop-up, picked on save). */
export function RepGroupPicker({ value, onChange, prefill, className, emptyLabel = 'Which rep group?' }: {
  value: string
  emptyLabel?: string
  onChange: (id: string, group?: NamedRef) => void
  prefill?: NewRepGroupPrefill
  className?: string
}) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listRepGroupNames(organization.id) : []), [organization?.id])
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Select value={value} aria-label="Rep group" className={className ?? 'h-9 sm:w-72'} onChange={(e) => {
        if (e.target.value === ADD) { setAdding(true); return }
        onChange(e.target.value, (q.data ?? []).find((g) => g.id === e.target.value))
      }}>
        <option value="">{q.isLoading ? 'Loading rep groups…' : emptyLabel}</option>
        <option value={ADD}>+ Add new rep group…</option>
        {(q.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </Select>
      {adding ? (
        <QuickRepGroupDialog prefill={prefill} onClose={() => setAdding(false)} onDone={async (g) => {
          setAdding(false)
          await q.refetch()
          onChange(g.id, g)
        }} />
      ) : null}
    </>
  )
}

function QuickRepGroupDialog({ prefill, onClose, onDone }: { prefill?: NewRepGroupPrefill; onClose: () => void; onDone: (g: NamedRef) => void | Promise<void> }) {
  const { organization } = useAuth()
  const [name, setName] = useState(prefill?.name ?? '')
  const [repName, setRepName] = useState(prefill?.repName ?? '')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add a new rep group" submitLabel="Add rep group" busy={busy} onClose={onClose} onSubmit={async () => {
      if (!organization) return
      if (!name.trim()) { toast.error('Name is required.'); return }
      if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { toast.error('That email does not look right.'); return }
      setBusy(true)
      try {
        const g = await createRepGroup({ organization_id: organization.id, name: name.trim() })
        if (repName.trim() || email.trim() || phone.trim()) await addRepGroupContact({ rep_group_id: g.id, name: repName.trim() || null, email: email.trim().toLowerCase() || null, phone: phone.trim() || null })
        clearPickerCache()
        toast.success(`${g.name} added`)
        await onDone({ id: g.id, name: g.name })
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <FormField label="Rep group name" htmlFor="qr-name"><Input id="qr-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></FormField>
      <FormField label="Rep" htmlFor="qr-rep"><Input id="qr-rep" value={repName} onChange={(e) => setRepName(e.target.value)} /></FormField>
      <FormField label="Email" htmlFor="qr-email"><Input id="qr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
      <FormField label="Phone" htmlFor="qr-phone"><Input id="qr-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></FormField>
      <p className="text-xs text-stone-500">Add more reps and the vendors they carry later on the rep group page.</p>
    </Modal>
  )
}
