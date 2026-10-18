import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { askForDnr, decideItemChange, getItemChange, listDnrPeople, writeItemChangeToLs } from '@/services/itemChanges'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { money as formatCurrency } from '@/lib/freight'
import { ITEM_CHANGE_LABELS, LS_STATUS_TEXT } from '@/lib/itemChanges'
import type { ItemChange, ItemChangeDecision } from '@/types'
import { Alert, Button, Input, Select } from '@/components/ui'

const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString() : '')

/**
 * An item the vendor says is unavailable (Dana, Oct 18). Use replacement, Discontinued no replacement, Out of stock (with
 * the back-in-stock date), DNR (Dana, Trevor and Jarrett only) or Leave as is. The choice goes to Lightspeed: * or ** at
 * the start of the name and a dated line on top of the item's note.
 */
export function ItemChangeCard({ changeId, canEdit, onDone }: { changeId: string; canEdit: boolean; onDone?: () => void | Promise<void> }) {
  const q = useSupabaseQuery(() => getItemChange(changeId), [changeId])
  if (q.error) return <Alert variant="error" className="mt-2">{q.error}</Alert>
  if (!q.data) return null
  return <ItemChangeBody ch={q.data} canEdit={canEdit} onChanged={async () => { await q.refetch(); await onDone?.() }} />
}

function ItemChangeBody({ ch, canEdit, onChanged }: { ch: ItemChange; canEdit: boolean; onChanged: () => Promise<void> }) {
  const { profile, organization } = useAuth()
  const canDnr = !!profile?.can_dnr
  const [choice, setChoice] = useState<ItemChangeDecision | ''>(ch.sure ? (ch.read_as === 'replaced' ? 'replacement' : ch.read_as === 'discontinued' ? 'discontinued' : ch.read_as === 'out_of_stock' ? 'out_of_stock' : '') : '')
  const [replacement, setReplacement] = useState(ch.replacement_vendor_item_id ?? '')
  const [backDate, setBackDate] = useState(ch.back_date ?? '')
  const [reason, setReason] = useState('')
  const [askTo, setAskTo] = useState('')
  const [busy, setBusy] = useState(false)
  const dnrPeople = useSupabaseQuery(async () => (organization && !canDnr ? listDnrPeople(organization.id) : []), [organization?.id, canDnr])

  async function decide() {
    if (!choice) return
    setBusy(true)
    try {
      const r = await decideItemChange(ch.id, choice, { backDate: backDate || null, reason, replacement })
      if (r.status === 'written') toast.success('Written to Lightspeed')
      else if (r.status === 'not_needed') toast.success('Left as is')
      else toast(r.error ?? 'Saved in VMS', { duration: 8000 })
      await onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function retry() {
    setBusy(true)
    try {
      const r = await writeItemChangeToLs(ch.id)
      if (r.status === 'written') toast.success('Written to Lightspeed')
      else toast(r.error ?? 'Not written', { duration: 8000 })
      await onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function ask() {
    if (!askTo) return
    setBusy(true)
    try {
      await askForDnr(ch.id, askTo, reason)
      toast.success('Sent. The card stays open until they decide.')
      setReason('')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const label = [ch.vendor_item_id, ch.item_name].filter(Boolean).join(' ')
  return (
    <div className="mt-2 space-y-2 text-sm">
      <p className="text-stone-800"><span className="font-medium">{label || 'Item'}</span>{ch.ls_name ? <span className="text-stone-500"> · in LS as {ch.ls_name}</span> : <span className="text-stone-500"> · not found in Lightspeed yet</span>}</p>
      {ch.vendor_words ? <p className="rounded-lg bg-white/70 px-3 py-2 text-stone-700">The vendor wrote: “{ch.vendor_words}”</p> : null}
      <p className="text-stone-600">
        Claude read: <strong>{ITEM_CHANGE_LABELS[ch.read_as]}</strong>
        {ch.replacement_vendor_item_id ? <> · replacement {ch.replacement_vendor_item_id}{ch.replacement_name ? ` ${ch.replacement_name}` : ''}{ch.replacement_price != null ? ` at ${formatCurrency(ch.replacement_price)}` : ''}</> : null}
        {ch.back_date ? <> · back {day(ch.back_date)}</> : null}
        {ch.sure ? '' : ' (not sure)'}
        {ch.order_id ? <> · <Link to={`${ROUTES.orders}/${ch.order_id}`} className="text-brand hover:underline">the order</Link></> : null}
      </p>

      {ch.decision ? (
        <div className="space-y-1">
          <p className="text-stone-800">Decided: <strong>{ITEM_CHANGE_LABELS[ch.decision]}</strong>{ch.note_line ? <span className="text-stone-500"> · note “{ch.note_line}”</span> : null}</p>
          {ch.ls_status ? <p className={ch.ls_status === 'written' || ch.ls_status === 'not_needed' ? 'text-green-700' : 'text-amber-800'}>{LS_STATUS_TEXT[ch.ls_status]}{ch.ls_error ? ` ${ch.ls_error}` : ''}</p> : null}
          {canEdit && (ch.ls_status === 'failed' || ch.ls_status === 'no_access' || ch.ls_status === 'pending') ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void retry()}>Try Lightspeed again</Button> : null}
        </div>
      ) : canEdit ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to do">
            {(['replacement', 'discontinued', 'out_of_stock', 'dnr', 'leave'] as ItemChangeDecision[]).filter((d) => d !== 'dnr' || canDnr).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={choice === d} onClick={() => setChoice(d)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${choice === d ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}>
                {ITEM_CHANGE_LABELS[d]}
              </button>
            ))}
          </div>
          {choice === 'replacement' ? <label className="block text-stone-600">Replacement's Vendor ID <Input value={replacement} onChange={(e) => setReplacement(e.target.value)} className="mt-1 h-9 w-48" /></label> : null}
          {choice === 'out_of_stock' ? <label className="block text-stone-600">Back in stock (if the vendor said) <Input type="date" value={backDate} onChange={(e) => setBackDate(e.target.value)} className="mt-1 h-9 w-48" /></label> : null}
          {choice === 'dnr' ? <label className="block text-stone-600">Why not reorder? <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Poor quality, poor seller…" className="mt-1 h-9" /></label> : null}
          {choice ? <Button size="sm" loading={busy} onClick={() => void decide()}>{choice === 'leave' ? 'Leave as is' : 'Save and write to Lightspeed'}</Button> : null}
          {!canDnr ? (
            <div className="rounded-lg border border-stone-200 bg-white/70 p-2">
              <p className="text-stone-600">Should we stop reordering it? Send a message about DNR to Dana, Trevor or Jarrett.</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Select value={askTo} onChange={(e) => setAskTo(e.target.value)} aria-label="Send to" className="h-9 w-40">
                  <option value="">Send to…</option>
                  {(dnrPeople.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </Select>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (poor quality, poor seller…)" className="h-9 min-w-48 flex-1" aria-label="Why" />
                <Button size="sm" variant="secondary" loading={busy} disabled={!askTo} onClick={() => void ask()}>Send</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
