import { useState } from 'react'
import toast from 'react-hot-toast'
import { Mail, Pencil, Star } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getVendor } from '@/services/vendors'
import { updateOrder } from '@/services/orders'
import { peopleFor } from '@/lib/contacts'
import { errorMessage } from '@/lib/utils'
import { Button, Input } from '@/components/ui'

/** Who took the order (often the show rep) and our assigned rep, who gets the follow-ups. */
export function OrderRepsCard({ orderId, vendorId, takenBy, canEdit, onChange }: { orderId: string; vendorId: string; takenBy: string | null; canEdit: boolean; onChange: () => Promise<void> }) {
  const vq = useSupabaseQuery(() => getVendor(vendorId), [vendorId])
  const people = vq.data ? peopleFor(vq.data) : []
  const ourRep = people.find((p) => p.starred)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(takenBy ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateOrder(orderId, { taken_by: value.trim() || null })
      setEditing(false)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Reps</h2>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="text-xs font-medium text-stone-500">Order taken by</dt>
          {editing ? (
            <dd className="mt-1 flex gap-2">
              <Input list={`taken-${orderId}`} value={value} onChange={(e) => setValue(e.target.value)} className="h-9" aria-label="Order taken by" placeholder="e.g. the rep at the show" autoFocus />
              <datalist id={`taken-${orderId}`}>{people.filter((p) => p.name).map((p) => <option key={p.key} value={p.name!} />)}</datalist>
              <Button size="sm" loading={saving} onClick={() => void save()}>Save</Button>
            </dd>
          ) : (
            <dd className="flex items-center gap-2 text-stone-900">
              {takenBy ?? <span className="text-stone-400">Not recorded</span>}
              {canEdit ? <button type="button" onClick={() => { setValue(takenBy ?? ''); setEditing(true) }} aria-label="Change who took the order" className="rounded p-1 text-stone-400 hover:bg-stone-100"><Pencil className="size-3.5" aria-hidden="true" /></button> : null}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-medium text-stone-500">Our assigned rep (follow-ups)</dt>
          <dd className="text-stone-900">
            {ourRep ? (
              <span className="inline-flex flex-wrap items-center gap-x-2">
                <Star className="size-3.5 fill-amber-400 text-amber-500" aria-hidden="true" />{ourRep.name || ourRep.email}
                {ourRep.email ? <a href={`mailto:${ourRep.email}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail className="size-3.5" aria-hidden="true" />{ourRep.email}</a> : null}
              </span>
            ) : <span className="text-stone-400">None starred yet; star one on the vendor page.</span>}
          </dd>
        </div>
      </dl>
    </section>
  )
}
