import { useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listSharedFreightBills, setFreightShare } from '@/services/freight'
import { money } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { errorMessage, shortDate } from '@/lib/utils'
import { Button, Select } from '@/components/ui'

/**
 * Check-in shortcut (Dana, Oct 21): when this order came on a pallet with other vendors, Trevor picks the shared freight
 * bill here. The order joins the bill and the freight is shared again by merchandise cost (typed amounts stay).
 */
export function SharedFreightPick({ orderId, canEdit }: { orderId: string; canEdit: boolean }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listSharedFreightBills(organization.id) : []), [organization?.id])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const bills = q.data ?? []
  const on = bills.find((b) => b.freight_bill_lines.some((l) => l.order_id === orderId))
  const name = (b: (typeof bills)[number]) => [b.carriers?.name, b.invoice_number ? `#${b.invoice_number}` : null, b.invoice_date ? shortDate(b.invoice_date) : null, money(b.total)].filter(Boolean).join(' · ')

  if (on) {
    const mine = on.freight_bill_lines.find((l) => l.order_id === orderId)
    return <p className="mt-1 text-xs text-stone-600">On shared freight bill <Link to={`${ROUTES.freight}/${on.id}`} className="font-medium text-brand hover:underline">{name(on)}</Link>{mine ? `: ${money(mine.amount)} for this order` : ''}</p>
  }
  if (!canEdit || !bills.length) return null

  async function add() {
    const b = bills.find((x) => x.id === pick)
    if (!b) return
    setBusy(true)
    try {
      const keep = b.freight_bill_lines.filter((l) => l.order_id).map((l) => ({ order_id: l.order_id!, amount: l.manual_amount ? Number(l.amount) : null }))
      await setFreightShare(b.id, [...keep, { order_id: orderId, amount: null }])
      toast.success('Added to the shared freight bill')
      setPick('')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2">
      <label htmlFor={`share-${orderId}`} className="text-xs text-stone-600">Came on a shared freight bill?</label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Select id={`share-${orderId}`} value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
            <option value="">Pick the bill…</option>
            {bills.map((b) => <option key={b.id} value={b.id}>{name(b)}</option>)}
          </Select>
        </div>
        <Button size="sm" variant="secondary" disabled={!pick} loading={busy} onClick={() => void add()}>Add this order</Button>
      </div>
    </div>
  )
}
