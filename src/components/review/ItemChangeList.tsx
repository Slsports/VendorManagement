import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { decideItemChange } from '@/services/itemChanges'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { ITEM_CHANGE_LABELS, LS_STATUS_TEXT } from '@/lib/itemChanges'
import type { ItemChange, ItemChangeDecision } from '@/types'
import { Button, Input, Select } from '@/components/ui'

interface Pick { choice: ItemChangeDecision | ''; backDate: string; replacement: string; reason: string }

const firstChoice = (ch: ItemChange): ItemChangeDecision | '' =>
  ch.source === 'report' || !ch.sure ? '' : ch.read_as === 'replaced' ? 'replacement' : ch.read_as === 'discontinued' ? 'discontinued' : ch.read_as === 'out_of_stock' ? 'out_of_stock' : ''

/**
 * Items the vendor says are unavailable, all in one card (Dana, Oct 31: "All 18 should be in one card and I should not
 * have to scroll like that"): one short row per item with the choice beside it, and one Save for all of them. Backordered
 * items never come here; they show on the order.
 */
export function ItemChangeList({ changeIds, canEdit, onDone, title = 'Items the vendor says are unavailable' }: { changeIds: string[]; canEdit: boolean; onDone?: () => void | Promise<void>; title?: string }) {
  const { profile } = useAuth()
  const canDnr = !!profile?.can_dnr
  const q = useSupabaseQuery(async () => {
    if (!changeIds.length) return [] as ItemChange[]
    const { data, error } = await supabase.from('item_changes').select('*').in('id', changeIds).order('vendor_item_id')
    if (error) throw error
    return (data ?? []) as ItemChange[]
  }, [changeIds.join(',')])
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [busy, setBusy] = useState(false)
  const rows = (q.data ?? []).filter((c) => c.read_as !== 'backordered')
  if (!rows.length) return null

  const pickOf = (ch: ItemChange): Pick => picks[ch.id] ?? { choice: firstChoice(ch), backDate: ch.back_date ?? '', replacement: ch.replacement_vendor_item_id ?? '', reason: '' }
  const set = (ch: ItemChange, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [ch.id]: { ...pickOf(ch), ...patch } }))
  const open = rows.filter((c) => !c.decision)
  const ready = open.filter((c) => pickOf(c).choice && (pickOf(c).choice !== 'replacement' || pickOf(c).replacement.trim()))

  async function saveAll() {
    setBusy(true)
    let written = 0
    const notes: string[] = []
    for (const ch of ready) {
      const p = pickOf(ch)
      try {
        const r = await decideItemChange(ch.id, p.choice as ItemChangeDecision, { backDate: p.backDate || null, reason: p.reason, replacement: p.replacement })
        if (r.status === 'written') written++
        else if (r.error) notes.push(`${ch.vendor_item_id ?? ch.item_name}: ${r.error}`)
      } catch (err) {
        notes.push(`${ch.vendor_item_id ?? ch.item_name}: ${errorMessage(err)}`)
      }
    }
    toast.success(`Saved ${ready.length}${written ? `, ${written} written to Lightspeed` : ''}`)
    if (notes.length) toast(notes.join('\n'), { duration: 10000 })
    setPicks({})
    await q.refetch()
    await onDone?.()
    setBusy(false)
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-900">{title} ({rows.length})</h2>
      <p className="mt-0.5 text-xs text-amber-900">Pick what to do with each one, then Save once. Your choice goes into Lightspeed.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500">
              <th className="py-1 pr-3 font-medium">Item</th>
              <th className="py-1 pr-3 font-medium">The vendor wrote</th>
              <th className="py-1 pr-3 font-medium">What to do</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-200">
            {rows.map((ch) => {
              const p = pickOf(ch)
              const options: ItemChangeDecision[] = ch.source === 'report' ? ['find_replacement', 'replacement', 'dont_need'] : (['replacement', 'discontinued', 'out_of_stock', 'dnr', 'leave'] as ItemChangeDecision[]).filter((d) => d !== 'dnr' || canDnr)
              return (
                <tr key={ch.id} className="align-top">
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-stone-900">{[ch.vendor_item_id, ch.item_name].filter(Boolean).join(' ') || 'Item'}</span>
                    {ch.ls_name ? <span className="block text-xs text-stone-500">in LS as {ch.ls_name}</span> : null}
                  </td>
                  <td className="py-1.5 pr-3 text-stone-700">
                    {ch.vendor_words ? `“${ch.vendor_words}”` : null}
                    <span className="block text-xs text-stone-500">
                      Claude read: {ITEM_CHANGE_LABELS[ch.read_as]}{ch.sure ? '' : ' (not sure)'}
                      {ch.check_id ? <> · <Link to={`${ROUTES.orderChecks}/${ch.check_id}`} className="text-brand hover:underline">where it came from</Link></> : null}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    {ch.decision ? (
                      <span className="text-stone-800">{ITEM_CHANGE_LABELS[ch.decision]}{ch.ls_status ? <span className="block text-xs text-stone-500">{LS_STATUS_TEXT[ch.ls_status]}{ch.ls_error ? ` ${ch.ls_error}` : ''}</span> : null}</span>
                    ) : canEdit ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Select value={p.choice} onChange={(e) => set(ch, { choice: e.target.value as ItemChangeDecision | '' })} aria-label={`What to do with ${ch.vendor_item_id ?? ch.item_name ?? 'this item'}`} className="h-9 w-56">
                          <option value="">Choose…</option>
                          {options.map((d) => <option key={d} value={d}>{d === 'replacement' && ch.source === 'report' ? 'I know the replacement' : ITEM_CHANGE_LABELS[d]}</option>)}
                        </Select>
                        {p.choice === 'replacement' ? <Input value={p.replacement} onChange={(e) => set(ch, { replacement: e.target.value })} placeholder="Replacement's Vendor ID" aria-label="Replacement's Vendor ID" className="h-9 w-44" /> : null}
                        {p.choice === 'out_of_stock' ? <Input type="date" value={p.backDate} onChange={(e) => set(ch, { backDate: e.target.value })} aria-label="Back in stock" title="Back in stock (if the vendor said)" className="h-9 w-40" /> : null}
                        {p.choice === 'dnr' ? <Input value={p.reason} onChange={(e) => set(ch, { reason: e.target.value })} placeholder="Why not reorder?" aria-label="Why not reorder?" className="h-9 w-44" /> : null}
                      </div>
                    ) : <span className="text-stone-500">Not decided yet</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canEdit && open.length ? (
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" loading={busy} disabled={!ready.length} onClick={() => void saveAll()}>Save{ready.length ? ` ${ready.length}` : ''}</Button>
          <span className="text-xs text-amber-900">{open.length - ready.length ? `${open.length - ready.length} still to choose` : 'All chosen'}</span>
        </div>
      ) : null}
    </section>
  )
}
