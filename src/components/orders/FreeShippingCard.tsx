import { useState } from 'react'
import toast from 'react-hot-toast'
import { Truck } from 'lucide-react'
import { updateOrder } from '@/services/orders'
import { FREE_SHIPPING_BASIS_LABELS, freeShippingRule, money } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import type { FreeShippingBasis, FreeShippingPolicy, Order } from '@/types'
import { Button, Input, Select } from '@/components/ui'

export interface FreeShippingCardProps {
  order: Pick<Order, 'id' | 'free_shipping' | 'free_shipping_basis' | 'free_shipping_note' | 'freight_cost' | 'freight_notes' | 'est_cost' | 'final_cost'> & Partial<Pick<Order, 'freight_terms' | 'freight_cap_pct' | 'freight_terms_confirmed_at' | 'freight_terms_confirmed_how'>>
  vendor: { free_shipping_policy: FreeShippingPolicy | null; free_shipping_threshold: number | null; freight_program: string | null; freight_routing: string | null } | null
  canEdit: boolean
  onChange: () => void | Promise<void>
}

type Answer = '' | 'yes' | 'no'

/**
 * Shipping on one order: whether it is supposed to ship free and why, next to the vendor's usual rule
 * and our routing instructions. Warns when the answer does not fit the rule (free from a "never" vendor,
 * or under the vendor's threshold with no special stated).
 */
export function FreeShippingCard({ order, vendor, canEdit, onChange }: FreeShippingCardProps) {
  const [answer, setAnswer] = useState<Answer>(order.free_shipping === null ? '' : order.free_shipping ? 'yes' : 'no')
  const [basis, setBasis] = useState<FreeShippingBasis | ''>(order.free_shipping_basis ?? '')
  const [note, setNote] = useState(order.free_shipping_note ?? '')
  // what we agreed on freight (Dana, Oct 30): half or capped when we pay some of it; the confirmation is checked against it
  const [terms, setTerms] = useState<'half' | 'capped' | 'charged'>(order.freight_terms === 'half' || order.freight_terms === 'capped' ? order.freight_terms : 'charged')
  const [cap, setCap] = useState(order.freight_cap_pct == null ? '' : String(order.freight_cap_pct))
  const [saving, setSaving] = useState(false)
  const rule = vendor ? freeShippingRule(vendor) : null
  const value = order.final_cost ?? order.est_cost
  const dirty = answer !== (order.free_shipping === null ? '' : order.free_shipping ? 'yes' : 'no') || basis !== (order.free_shipping_basis ?? '') || note !== (order.free_shipping_note ?? '')
    || terms !== (order.freight_terms === 'half' || order.freight_terms === 'capped' ? order.freight_terms : 'charged') || cap !== (order.freight_cap_pct == null ? '' : String(order.freight_cap_pct))

  const warnings: string[] = []
  if (vendor && answer === 'yes' && vendor.free_shipping_policy === 'never' && basis !== 'negotiated') warnings.push('This vendor never offers free shipping. If they agreed to it this time, mark it negotiated and say who agreed.')
  if (vendor && answer === 'yes' && vendor.free_shipping_policy === 'sometimes' && vendor.free_shipping_threshold !== null && value !== null && value < vendor.free_shipping_threshold && basis === 'minimum_met') warnings.push(`The order is under ${money(vendor.free_shipping_threshold)}, so it did not reach their volume. A show special or a negotiated deal would explain it.`)
  if (vendor && answer === 'no' && vendor.free_shipping_policy === 'always') warnings.push('This vendor always ships free. Check the invoice before paying freight.')
  if (vendor && answer === 'no' && vendor.free_shipping_policy === 'sometimes' && vendor.free_shipping_threshold !== null && value !== null && value >= vendor.free_shipping_threshold) warnings.push(`The order is over ${money(vendor.free_shipping_threshold)}. It should have shipped free; ask for the freight back.`)
  if (order.freight_cost !== null && order.freight_cost > 0 && answer === 'yes') warnings.push(`Freight of ${money(order.freight_cost)} was recorded on an order that should ship free. A credit may be due.`)

  // Dana, Oct 31: a person's eyes on the confirmation settle the freight check; the waiting email and task go away
  const [confirming, setConfirming] = useState(false)
  async function confirmTerms() {
    setConfirming(true)
    try { await updateOrder(order.id, { freight_terms_confirmed_at: new Date().toISOString(), freight_terms_confirmed_how: 'person' }); toast.success('Noted: the confirmation shows the agreed terms'); await onChange() } catch (err) { toast.error(errorMessage(err)) } finally { setConfirming(false) }
  }
  async function save() {
    setSaving(true)
    try {
      const capPct = terms === 'capped' && cap.trim() !== '' ? Number(cap.replace(/[^0-9.]/g, '')) : null
      if (answer === 'no' && terms === 'capped' && (capPct === null || !Number.isFinite(capPct) || capPct <= 0 || capPct > 100)) { toast.error('Enter the cap as a percent of the order (1 to 100)'); setSaving(false); return }
      await updateOrder(order.id, {
        free_shipping: answer === '' ? null : answer === 'yes',
        free_shipping_basis: answer === 'yes' && basis ? basis : null,
        free_shipping_note: note.trim() || null,
        freight_terms: answer === 'yes' ? 'free' : answer === 'no' ? terms : null,
        freight_cap_pct: answer === 'no' && terms === 'capped' ? capPct : null,
      })
      toast.success('Shipping saved')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Truck className="size-4" aria-hidden="true" /> Shipping</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div><dt className="text-xs font-medium text-stone-500">Vendor's usual rule</dt><dd className="text-sm text-stone-900">{rule ?? 'Not set on the vendor yet'}</dd></div>
        <div><dt className="text-xs font-medium text-stone-500">Freight on this order</dt><dd className="text-sm text-stone-900">{order.freight_cost !== null ? money(order.freight_cost) : (order.freight_notes ?? '—')}</dd></div>
        {vendor?.freight_routing ? <div className="sm:col-span-2"><dt className="text-xs font-medium text-stone-500">Our routing instructions</dt><dd className="text-sm text-stone-900">{vendor.freight_routing}</dd></div> : null}
      </dl>
      <div className="mt-4 border-t border-stone-100 pt-4">
        <p className="text-xs font-medium text-stone-500">Is this order supposed to ship free?</p>
        {canEdit ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Select value={answer} onChange={(e) => { const a = e.target.value as Answer; setAnswer(a); if (a !== 'yes') setBasis('') }} aria-label="Free shipping on this order" className="h-9 sm:w-40">
              <option value="">Not stated</option>
              <option value="yes">Yes, free shipping</option>
              <option value="no">No, we pay freight</option>
            </Select>
            {answer === 'no' ? (
              <Select value={terms} onChange={(e) => setTerms(e.target.value as 'half' | 'capped' | 'charged')} aria-label="What we agreed on freight" className="h-9 sm:w-56">
                <option value="charged">We pay the freight</option>
                <option value="half">They cover half</option>
                <option value="capped">Capped at a % of the order</option>
              </Select>
            ) : null}
            {answer === 'no' && terms === 'capped' ? <Input value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Cap percent" placeholder="%" inputMode="decimal" className="h-9 sm:w-20" /> : null}
            {answer === 'yes' ? (
              <Select value={basis} onChange={(e) => setBasis(e.target.value as FreeShippingBasis | '')} aria-label="Why it ships free" className="h-9 sm:w-64">
                <option value="">Why?</option>
                {(Object.keys(FREE_SHIPPING_BASIS_LABELS) as FreeShippingBasis[]).map((k) => <option key={k} value={k}>{FREE_SHIPPING_BASIS_LABELS[k]}</option>)}
              </Select>
            ) : null}
            <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Shipping note" placeholder="Note (who agreed, special name, carrier)" className="h-9 sm:w-72" />
            <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>Save</Button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-stone-900">{order.free_shipping === null ? 'Not stated' : order.free_shipping ? `Yes${order.free_shipping_basis ? ` · ${FREE_SHIPPING_BASIS_LABELS[order.free_shipping_basis]}` : ''}` : order.freight_terms === 'half' ? 'No · they cover half' : order.freight_terms === 'capped' ? `No · capped at ${order.freight_cap_pct ?? '?'}% of the order` : 'No, we pay freight'}{order.free_shipping_note ? ` · ${order.free_shipping_note}` : ''}</p>
        )}
        {canEdit && !order.freight_terms_confirmed_at && (answer === 'yes' || (answer === 'no' && terms !== 'charged')) && !dirty ? (
          <Button size="sm" variant="secondary" className="mt-3" loading={confirming} onClick={() => void confirmTerms()}>The confirmation shows the agreed terms</Button>
        ) : null}
        {order.freight_terms_confirmed_at ? <p className="mt-2 text-xs text-emerald-800">The vendor confirmed these terms {order.freight_terms_confirmed_how === 'confirmation' ? 'on the confirmation' : order.freight_terms_confirmed_how === 'reply' ? 'by email' : ''} on {new Date(order.freight_terms_confirmed_at).toLocaleDateString()}.</p> : null}
        {warnings.map((w) => <p key={w} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{w}</p>)}
      </div>
    </section>
  )
}
