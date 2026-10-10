import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOrderers } from '@/services/reviews'
import { setVendorAssignee } from '@/services/vendors'
import { errorMessage } from '@/lib/utils'
import { Button, Select } from '@/components/ui'

/** "Who orders from this vendor?": keep the proposed person, or pick another who places orders. */
export function VendorAssignmentActions({ vendorId, proposedId, onDone }: { vendorId: string; proposedId: string | null; onDone: () => void | Promise<void> }) {
  const { organization } = useAuth()
  const people = useSupabaseQuery(async () => (organization ? listOrderers(organization.id) : []), [organization?.id])
  const [choice, setChoice] = useState(proposedId ?? '')
  const [busy, setBusy] = useState(false)
  const name = (people.data ?? []).find((p) => p.id === choice)?.full_name

  async function save() {
    setBusy(true)
    try {
      await setVendorAssignee(vendorId, choice || null)
      toast.success(choice ? `Assigned to ${name ?? 'them'}` : 'Left unassigned')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Who orders from this vendor" className="h-9 sm:w-56">
        <option value="">Nobody yet</option>
        {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </Select>
      <Button size="sm" loading={busy} onClick={() => void save()} leftIcon={<Check className="size-4" aria-hidden="true" />}>
        {choice && choice === proposedId ? `Keep ${name ?? ''}`.trim() : 'Assign'}
      </Button>
    </div>
  )
}
