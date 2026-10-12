import { useState } from 'react'
import toast from 'react-hot-toast'
import { ClipboardList, PackageSearch } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOrderers } from '@/services/reviews'
import { FLAG_PROMPT, flagVendor, ORDERING_STAGE_LABELS, type OrderingStage } from '@/services/ordering'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { Button, FormField, Select, Textarea } from '@/components/ui'

/** "Check if we need it" and "Remind me to order" (Dana, Oct 11), on a vendor page or a review card. */
export function FlagButtons({ vendor, threadId, assignedBuyerId, onDone, size = 'sm' }: {
  vendor: { id: string; name: string }
  threadId?: string | null
  assignedBuyerId?: string | null
  onDone?: () => void
  size?: 'sm' | 'md'
}) {
  const [asking, setAsking] = useState<OrderingStage | null>(null)
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setAsking('check')} leftIcon={<PackageSearch className="size-4" aria-hidden="true" />}>{FLAG_PROMPT.check.button}</Button>
      <Button size={size} variant="secondary" onClick={() => setAsking('to_order')} leftIcon={<ClipboardList className="size-4" aria-hidden="true" />}>{FLAG_PROMPT.to_order.button}</Button>
      {asking ? <FlagDialog vendor={vendor} stage={asking} threadId={threadId} assignedBuyerId={assignedBuyerId} onClose={() => setAsking(null)} onDone={onDone} /> : null}
    </>
  )
}

/** Flag one vendor (who handles it, a note). */
export function FlagDialog({ vendor, stage, threadId, assignedBuyerId, onClose, onDone }: {
  vendor: { id: string; name: string }; stage: OrderingStage; threadId?: string | null; assignedBuyerId?: string | null; onClose: () => void; onDone?: () => void
}) {
  const { organization, profile } = useAuth()
  const people = useSupabaseQuery(async () => (organization ? listOrderers(organization.id) : []), [organization?.id])
  const [note, setNote] = useState('')
  const [who, setWho] = useState(assignedBuyerId ?? profile?.id ?? '')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!organization) return
    setBusy(true)
    try {
      await flagVendor({ organizationId: organization.id, vendorId: vendor.id, stage, note: note.trim() || null, assignedTo: who || null, threadId })
      toast.success(`${vendor.name}: on the Ordering card under ${ORDERING_STAGE_LABELS[stage]}`)
      onDone?.()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`${FLAG_PROMPT[stage].title} · ${vendor.name}`} submitLabel="Add to Ordering" busy={busy} onSubmit={save} onClose={onClose}>
      <p className="text-stone-600">{FLAG_PROMPT[stage].help}</p>
      <FormField label="Who handles it" htmlFor="flag-who">
        <Select id="flag-who" value={who} onChange={(e) => setWho(e.target.value)}>
          {profile && !(people.data ?? []).some((p) => p.id === profile.id) ? <option value={profile.id}>{profile.full_name} (me)</option> : null}
          {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.id === profile?.id ? `${p.full_name} (me)` : p.full_name}</option>)}
        </Select>
      </FormField>
      <FormField label="Note (optional)" htmlFor="flag-note">
        <Textarea id="flag-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. low on 26 inch saucers" autoFocus />
      </FormField>
    </Modal>
  )
}
