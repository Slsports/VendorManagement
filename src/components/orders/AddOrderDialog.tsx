import { useEffect, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { createOrder } from '@/services/orders'
import { listPeople } from '@/services/reviews'
import { linkThreadToOrder } from '@/services/mail'
import { PAID_VIA_LABELS } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import type { Order } from '@/types'
import { Button, FormField, Input, Select, Textarea } from '@/components/ui'

type PaidVia = NonNullable<Order['paid_via']>
const today = () => new Date().toISOString().slice(0, 10)

/**
 * An order typed in after the fact (Tyler bought hats online with the company card). The short version:
 * Fable's order plan adds line items, sending and confirmation checks on top of the same record.
 */
export function AddOrderDialog({ vendor, threadId, onClose, onSaved }: { vendor: { id: string; name: string }; threadId?: string; onClose: () => void; onSaved?: (order: Order) => void }) {
  const { organization, profile, stores } = useAuth()
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const [orderDate, setOrderDate] = useState(today())
  const [description, setDescription] = useState('')
  const [storeCodes, setStoreCodes] = useState<string[]>([])
  const [cost, setCost] = useState('')
  const [placedBy, setPlacedBy] = useState(profile?.full_name ?? '')
  const [poNumber, setPoNumber] = useState('')
  const [takenBy, setTakenBy] = useState('')
  const [paid, setPaid] = useState(false)
  const [paidVia, setPaidVia] = useState<PaidVia | ''>('card')
  const [paidDate, setPaidDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!organization) return
    if (!description.trim()) return toast.error('Say what was ordered')
    const amount = cost.trim() ? Number(cost.replace(/[^0-9.]/g, '')) : null
    if (cost.trim() && (amount === null || Number.isNaN(amount))) return toast.error('The cost should be a number')
    const person = (people.data ?? []).find((p) => p.full_name.toLowerCase() === placedBy.trim().toLowerCase())
    setSaving(true)
    try {
      const order = await createOrder({
        organization_id: organization.id,
        vendor_id: vendor.id,
        status: paid ? 'paid' : 'open',
        order_date: orderDate || null,
        description: description.trim(),
        store_codes: storeCodes,
        est_cost: amount,
        final_cost: paid ? amount : null,
        placed_by: placedBy.trim() || null,
        placed_by_id: person?.id ?? null,
        po_number: poNumber.trim() || null,
        taken_by: takenBy.trim() || null,
        paid_date: paid ? paidDate || today() : null,
        paid_via: paidVia || null,
        notes: notes.trim() || null,
        source: threadId ? 'email' : 'manual',
        created_by: profile?.id ?? null,
      })
      if (threadId) await linkThreadToOrder(threadId, order.id)
      toast.success(`Order added to ${vendor.name}`)
      onSaved?.(order)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Add an order">
      <form onSubmit={submit} className="flex max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-base font-semibold text-stone-900">Add an order · {vendor.name}</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="grid gap-3 overflow-y-auto px-4 py-3 sm:grid-cols-2">
          <FormField label="What was ordered" htmlFor="ao-desc" className="sm:col-span-2"><Input id="ao-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 48 trucker hats, SLS logo" autoFocus required /></FormField>
          <FormField label="Order date" htmlFor="ao-date"><Input id="ao-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></FormField>
          <FormField label="Total cost" htmlFor="ao-cost"><Input id="ao-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$" /></FormField>
          <FormField label="Placed by" htmlFor="ao-by" hint="Anyone, even without a VMS login">
            <Input id="ao-by" list="ao-people" value={placedBy} onChange={(e) => setPlacedBy(e.target.value)} />
            <datalist id="ao-people">{(people.data ?? []).map((p) => <option key={p.id} value={p.full_name} />)}</datalist>
          </FormField>
          <FormField label="Order taken by" htmlFor="ao-taken" hint="The rep who wrote it, e.g. at a show"><Input id="ao-taken" value={takenBy} onChange={(e) => setTakenBy(e.target.value)} /></FormField>
          <FormField label="PO or order number" htmlFor="ao-po"><Input id="ao-po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></FormField>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-stone-700">Store</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-stone-700">
                  <input type="checkbox" checked={storeCodes.includes(s.code)} onChange={(e) => setStoreCodes((c) => (e.target.checked ? [...c, s.code] : c.filter((x) => x !== s.code)))} className="size-4 rounded border-stone-300" />
                  {s.code}
                </label>
              ))}
            </div>
          </fieldset>
          <FormField label="Paid by" htmlFor="ao-via">
            <Select id="ao-via" value={paidVia} onChange={(e) => setPaidVia(e.target.value as PaidVia | '')}>
              <option value="">Not known yet</option>
              {(Object.keys(PAID_VIA_LABELS) as PaidVia[]).map((k) => <option key={k} value={k}>{PAID_VIA_LABELS[k]}</option>)}
            </Select>
          </FormField>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="size-4 rounded border-stone-300" /> Already paid
            </label>
            {paid ? <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} aria-label="Paid on" /> : null}
          </div>
          <FormField label="Notes" htmlFor="ao-notes" className="sm:col-span-2"><Textarea id="ao-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
          {threadId ? <p className="text-xs text-stone-500 sm:col-span-2">The email conversation is linked to this order.</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>Add order</Button>
        </div>
      </form>
    </div>
  )
}
