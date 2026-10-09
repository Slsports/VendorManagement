import { useState } from 'react'
import toast from 'react-hot-toast'
import { BadgeDollarSign } from 'lucide-react'
import { updateOrder } from '@/services/orders'
import { money, shortDate } from '@/lib/freight'
import { allowanceState } from '@/lib/wwdAllowance'
import { errorMessage } from '@/lib/utils'
import type { Order } from '@/types'
import { Button, Input } from '@/components/ui'

export interface FreightAllowanceCardProps {
  order: Pick<Order, 'id' | 'freight_allowance_offered' | 'freight_allowance' | 'freight_allowance_pay_by' | 'freight_allowance_received' | 'freight_cost' | 'ar_due_date' | 'paid_date'>
  vendorOffers: boolean
  canEdit: boolean
  onChange: () => void | Promise<void>
}

/**
 * Freight allowance (Dana, Oct 9): some vendors credit the freight back when the invoice is paid by a date
 * (Water Sports, Continuum). The order keeps how much and by when; the dashboard warns before the date, and a
 * WWD credit on the order marks it received.
 */
export function FreightAllowanceCard({ order, vendorOffers, canEdit, onChange }: FreightAllowanceCardProps) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(order.freight_allowance?.toString() ?? order.freight_cost?.toString() ?? '')
  const [payBy, setPayBy] = useState(order.freight_allowance_pay_by ?? order.ar_due_date ?? '')
  const [received, setReceived] = useState(order.freight_allowance_received ?? '')
  const [saving, setSaving] = useState(false)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const has = order.freight_allowance_offered
  if (!has && !vendorOffers && !editing) {
    return canEdit ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>+ Freight allowance for paying on time</Button> : null
  }
  const state = allowanceState(order, today)

  async function save(clear = false) {
    setSaving(true)
    try {
      const n = Number(amount)
      await updateOrder(order.id, clear ? { freight_allowance_offered: false, freight_allowance: null, freight_allowance_pay_by: null, freight_allowance_received: null } : {
        freight_allowance_offered: true,
        freight_allowance: amount.trim() && Number.isFinite(n) ? n : null,
        freight_allowance_pay_by: payBy || null,
        freight_allowance_received: received || null,
      })
      toast.success(clear ? 'Freight allowance removed' : 'Freight allowance saved')
      setEditing(false)
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><BadgeDollarSign className="size-4" aria-hidden="true" /> Freight allowance</h2>
      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-stone-500">Freight they credit back (leave blank if not known yet)
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
          </label>
          <label className="block text-xs font-medium text-stone-500">If paid by
            <Input type="date" value={payBy} onChange={(e) => setPayBy(e.target.value)} className="mt-1 h-9" />
          </label>
          <label className="block text-xs font-medium text-stone-500">Credit received on
            <Input type="date" value={received} onChange={(e) => setReceived(e.target.value)} className="mt-1 h-9" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={saving} onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            {has ? <Button size="sm" variant="ghost" onClick={() => void save(true)}>Remove</Button> : null}
          </div>
        </div>
      ) : has ? (
        <>
          <p className="mt-2 text-sm text-stone-900">{order.freight_allowance !== null ? money(order.freight_allowance) : 'The freight (amount not known yet)'} back if paid by {order.freight_allowance_pay_by ? shortDate(order.freight_allowance_pay_by) : 'the due date'}</p>
          <p className={`mt-1 text-sm ${state.tone === 'danger' ? 'font-semibold text-red-700' : state.tone === 'warning' ? 'font-medium text-amber-700' : 'text-stone-600'}`}>{state.text}</p>
          {canEdit ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(true)}>Edit</Button> : null}
        </>
      ) : (
        <div className="mt-2 text-sm text-stone-600">
          This vendor credits the freight when the invoice is paid on time.
          {canEdit ? <Button size="sm" variant="secondary" className="ml-2" onClick={() => setEditing(true)}>Add it to this order</Button> : null}
        </div>
      )}
    </section>
  )
}
