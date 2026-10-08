import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { createCarrier, listCarriers } from '@/services/freight'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { FormField, Input, Select } from '@/components/ui'

const ADD = '__add__'

/** Carrier dropdown with "+ Add new carrier…" first (name, parcel or LTL, website; freight mail goes to Trevor). */
export function CarrierPicker({ value, onChange, prefillName, domain }: { value: string; onChange: (id: string) => void; prefillName?: string; domain?: string }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listCarriers(organization.id) : []), [organization?.id])
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Select value={value} aria-label="Carrier" className="h-9 sm:w-64" onChange={(e) => { if (e.target.value === ADD) setAdding(true); else onChange(e.target.value) }}>
        <option value="">{q.isLoading ? 'Loading carriers…' : 'Which carrier?'}</option>
        <option value={ADD}>+ Add new carrier…</option>
        {(q.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.mode === 'ltl' ? 'LTL' : 'Parcel'})</option>)}
      </Select>
      {adding ? <QuickCarrierDialog prefillName={prefillName} domain={domain} onClose={() => setAdding(false)} onDone={async (id) => { setAdding(false); await q.refetch(); onChange(id) }} /> : null}
    </>
  )
}

function QuickCarrierDialog({ prefillName, domain, onClose, onDone }: { prefillName?: string; domain?: string; onClose: () => void; onDone: (id: string) => void | Promise<void> }) {
  const { organization } = useAuth()
  const [name, setName] = useState(prefillName ?? '')
  const [mode, setMode] = useState<'parcel' | 'ltl'>('parcel')
  const [website, setWebsite] = useState(domain ? `https://www.${domain}` : '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add a freight carrier" submitLabel="Add carrier" busy={busy} onClose={onClose} onSubmit={async () => {
      if (!organization) return
      if (!name.trim()) { toast.error('Name is required.'); return }
      setBusy(true)
      try {
        // Freight goes to whoever owns the other carriers (Trevor).
        const others = await listCarriers(organization.id)
        const c = await createCarrier({ organization_id: organization.id, name: name.trim(), mode, website: website.trim() || null, email_domains: domain ? [domain] : [], owner_id: others.find((o) => o.owner_id)?.owner_id ?? null })
        toast.success(`${c.name} added`)
        await onDone(c.id)
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <FormField label="Name" htmlFor="qc-name"><Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></FormField>
      <fieldset>
        <legend className="text-sm font-medium text-stone-800">Ships</legend>
        <div className="mt-1 flex gap-4 text-stone-700">
          <label className="flex items-center gap-2"><input type="radio" name="qc-mode" checked={mode === 'parcel'} onChange={() => setMode('parcel')} className="accent-brand" /> Parcel</label>
          <label className="flex items-center gap-2"><input type="radio" name="qc-mode" checked={mode === 'ltl'} onChange={() => setMode('ltl')} className="accent-brand" /> LTL</label>
        </div>
      </fieldset>
      <FormField label="Website to log in" htmlFor="qc-web"><Input id="qc-web" value={website} onChange={(e) => setWebsite(e.target.value)} /></FormField>
    </Modal>
  )
}
