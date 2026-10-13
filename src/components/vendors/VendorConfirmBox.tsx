import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listConfirmations, listVendorSells, prepareConfirmations } from '@/services/vendorConfirmations'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { FoldSection } from '@/components/shared/FoldSection'
import { Badge, Button, Input } from '@/components/ui'

/**
 * On a vendor's page (Dana, Oct 13): did they confirm their info on our form, ask them to (an email per contact, in
 * Mail › Drafts), and what they sell (from Worldwide and their own form).
 */
export function VendorConfirmBox({ vendorId, organizationId, canEdit, infoConfirmedAt }: { vendorId: string; organizationId: string; canEdit: boolean; infoConfirmedAt: string | null }) {
  const conf = useSupabaseQuery(() => listConfirmations(organizationId, vendorId), [organizationId, vendorId])
  const sells = useSupabaseQuery(() => listVendorSells(vendorId), [vendorId])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState('')
  const rows = conf.data ?? []
  const summary = infoConfirmedAt ? `Confirmed ${shortDate(infoConfirmedAt)}` : rows.some((c) => c.sent_at && !c.confirmed_at) ? 'Waiting for their answer' : rows.length ? 'In Drafts, not sent' : 'Not asked yet'

  async function ask() {
    setBusy(true)
    try {
      const n = await prepareConfirmations(organizationId, vendorId)
      toast.success(n ? `${n} email${n === 1 ? '' : 's'} ready in Mail › Drafts` : 'Everyone here already has one waiting or confirmed')
      await conf.refetch()
    } catch (err) { toast.error(errorMessage(err)) } finally { setBusy(false) }
  }
  async function addSell() {
    const c = adding.trim()
    if (!c) return
    const { error } = await supabase.from('vendor_sells').insert({ organization_id: organizationId, vendor_id: vendorId, category: c, source: 'manual' })
    if (error) toast.error(errorMessage(error)); else { setAdding(''); await sells.refetch() }
  }
  async function removeSell(id: string) {
    const { error } = await supabase.from('vendor_sells').delete().eq('id', id)
    if (error) toast.error(errorMessage(error)); else await sells.refetch()
  }

  return (
    <FoldSection title="Their info and what they sell" summary={summary}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-700">{infoConfirmedAt ? <Badge tone="success">Confirmed by the vendor {shortDate(infoConfirmedAt)}</Badge> : 'They have not confirmed their info on our form yet.'}</p>
        {canEdit ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void ask()}>Ask them to confirm</Button> : null}
      </div>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.slice(0, 12).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-stone-700">
              {c.contact_name ? `${c.contact_name}, ` : ''}{c.email}
              {c.confirmed_at ? <Badge tone="success">{c.changed ? 'Changed' : 'Looks good'} {shortDate(c.confirmed_at)}</Badge> : c.bounced_at ? <Badge tone="danger">Bad email</Badge> : c.sent_at ? <Badge tone="warning">Sent {shortDate(c.sent_at)}{c.reminded_at ? ', reminded' : ''}</Badge> : <Badge tone="neutral">In Drafts</Badge>}
            </li>
          ))}
        </ul>
      ) : null}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-stone-500">What they sell</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {(sells.data ?? []).map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-800" title={s.source === 'wwd' ? 'From Worldwide' : s.source === 'vendor_form' ? 'From their form' : 'Added here'}>
            {s.category}
            {canEdit ? <button type="button" onClick={() => void removeSell(s.id)} aria-label={`Remove ${s.category}`} className="text-stone-400 hover:text-red-600"><X className="size-3.5" aria-hidden="true" /></button> : null}
          </span>
        ))}
        {!(sells.data ?? []).length ? <span className="text-sm text-stone-500">Nothing yet. It fills in from Worldwide and their form.</span> : null}
      </div>
      {canEdit ? (
        <form className="mt-2 flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); void addSell() }}>
          <Input aria-label="Add what they sell" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. Fishing tackle" className="h-9" />
          <Button type="submit" size="sm" variant="ghost" leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add</Button>
        </form>
      ) : null}
      <Link to={ROUTES.contactConfirmations} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">All contact confirmations</Link>
    </FoldSection>
  )
}
