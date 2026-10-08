import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { createCarrier, listCarrierOwners, listCarriers, updateCarrier } from '@/services/freight'
import { domainsFrom } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import type { Carrier } from '@/types'
import { Modal } from '@/components/shared/Modal'
import { FormField, Input, Select } from '@/components/ui'

/**
 * Add or edit a freight carrier: name, parcel or LTL, the email domains its mail comes from, website,
 * account number and who gets its mail (Trevor by default). Saving claims the mail already in VMS from
 * those domains, so its bills and delivery receipts are read too.
 */
export function CarrierDialog({ carrier, prefillName, domain, onClose, onDone }: {
  carrier?: Carrier
  prefillName?: string
  domain?: string
  onClose: () => void
  onDone: (c: Carrier) => void | Promise<void>
}) {
  const { organization } = useAuth()
  const people = useSupabaseQuery(async () => (organization ? listCarrierOwners(organization.id) : []), [organization?.id])
  const others = useSupabaseQuery(async () => (organization && !carrier ? listCarriers(organization.id) : []), [organization?.id, carrier?.id])
  const [name, setName] = useState(carrier?.name ?? prefillName ?? '')
  const [mode, setMode] = useState<'parcel' | 'ltl'>(carrier?.mode ?? 'parcel')
  const [domains, setDomains] = useState((carrier?.email_domains ?? (domain ? [domain] : [])).join(', '))
  const [website, setWebsite] = useState(carrier?.website ?? (domain ? `https://www.${domain}` : ''))
  const [account, setAccount] = useState(carrier?.account_number ?? '')
  const [owner, setOwner] = useState<string | null | undefined>(carrier ? carrier.owner_id : undefined)
  const [active, setActive] = useState(carrier?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  // New carriers go to whoever owns the others (Trevor) unless someone is picked.
  const ownerId = owner !== undefined ? owner : ((others.data ?? []).find((o) => o.owner_id)?.owner_id ?? null)

  return (
    <Modal title={carrier ? `Edit ${carrier.name}` : 'Add a freight carrier'} submitLabel={carrier ? 'Save' : 'Add carrier'} busy={busy} onClose={onClose} onSubmit={async () => {
      if (!organization) return
      if (!name.trim()) { toast.error('Name is required.'); return }
      setBusy(true)
      try {
        const fields = { name: name.trim(), mode, email_domains: domainsFrom(domains), website: website.trim() || null, account_number: account.trim() || null, owner_id: ownerId }
        const c = carrier
          ? await updateCarrier(carrier.id, { ...fields, is_active: active })
          : await createCarrier({ organization_id: organization.id, ...fields })
        toast.success(carrier ? `${c.name} saved` : `${c.name} added`)
        await onDone(c)
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <FormField label="Name" htmlFor="cd-name"><Input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></FormField>
      <fieldset>
        <legend className="text-sm font-medium text-stone-800">Ships</legend>
        <div className="mt-1 flex gap-4 text-stone-700">
          <label className="flex items-center gap-2"><input type="radio" name="cd-mode" checked={mode === 'parcel'} onChange={() => setMode('parcel')} className="accent-brand" /> Parcel</label>
          <label className="flex items-center gap-2"><input type="radio" name="cd-mode" checked={mode === 'ltl'} onChange={() => setMode('ltl')} className="accent-brand" /> LTL</label>
        </div>
      </fieldset>
      <FormField label="Email domains" htmlFor="cd-domains" hint="Where its emails come from, like xpo.com. Separate several with commas.">
        <Input id="cd-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="xpo.com" />
      </FormField>
      <FormField label="Website to log in" htmlFor="cd-web"><Input id="cd-web" value={website} onChange={(e) => setWebsite(e.target.value)} /></FormField>
      <FormField label="Our account number" htmlFor="cd-acct"><Input id="cd-acct" value={account} onChange={(e) => setAccount(e.target.value)} /></FormField>
      <FormField label="Its mail goes to" htmlFor="cd-owner">
        <Select id="cd-owner" value={ownerId ?? ''} onChange={(e) => setOwner(e.target.value || null)}>
          <option value="">Nobody in particular</option>
          {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
      </FormField>
      {carrier ? (
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-brand" /> Active (uncheck to retire a carrier we no longer use)
        </label>
      ) : null}
    </Modal>
  )
}
