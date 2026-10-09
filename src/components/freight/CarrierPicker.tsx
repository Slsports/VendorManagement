import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listCarriers } from '@/services/freight'
import { Select } from '@/components/ui'
import { CarrierDialog } from './CarrierDialog'

const ADD = '__add__'

/** Carrier dropdown with "+ Add new carrier…" first (the same box as on the Freight bills page). */
export function CarrierPicker({ value, onChange, prefillName, domain, billingOnly = false }: { value: string; onChange: (id: string) => void; prefillName?: string; domain?: string; billingOnly?: boolean }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listCarriers(organization.id) : []), [organization?.id])
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Select value={value} aria-label="Carrier" className="h-9 sm:w-64" onChange={(e) => { if (e.target.value === ADD) setAdding(true); else onChange(e.target.value) }}>
        <option value="">{q.isLoading ? 'Loading carriers…' : 'Which carrier?'}</option>
        <option value={ADD}>+ Add new carrier…</option>
        {(q.data ?? []).filter((c) => !billingOnly || c.role === 'billing').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.mode === 'ltl' ? 'LTL' : 'Parcel'})</option>)}
      </Select>
      {adding ? <CarrierDialog prefillName={prefillName} domain={domain} onClose={() => setAdding(false)} onDone={async (c) => { setAdding(false); await q.refetch(); onChange(c.id) }} /> : null}
    </>
  )
}
