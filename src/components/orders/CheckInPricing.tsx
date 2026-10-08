import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { ClipboardPaste, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { addOrderLines, deleteOrderLine, listOrderLines, quotedFreightRate, updateOrder, updateOrderLine, type OrderDetail } from '@/services/orders'
import { breakdown, hasWwdUpcharge, parsePastedLines, pct, pricingSettings, retailPrice } from '@/lib/pricing'
import { money } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import type { OrderLine } from '@/types'
import { Button, Input, Textarea } from '@/components/ui'

/**
 * Check-in pricing (Dana, Oct 8): the items on the invoice with a retail price each. The summary line shows
 * where freight landed and the total percent; prices are exact (no rounding) and Trevor edits any of them.
 * Until the freight bill is in, prices use margin and upcharge only; one click recalculates when it arrives.
 */
export function CheckInPricing({ order: o, canEdit, onOrderChange }: { order: OrderDetail; canEdit: boolean; onOrderChange?: () => Promise<void> }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(() => listOrderLines(o.id), [o.id])
  const [busy, setBusy] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [draft, setDraft] = useState({ vendor_item_id: '', description: '', quantity: '1', unit_cost: '' })
  const lines = q.data ?? []
  const quoted = useSupabaseQuery(async () => (o.vendor && o.freight_pct === null ? quotedFreightRate(o.vendor.id, o.order_date) : null), [o.vendor?.id, o.order_date, o.freight_pct])

  const settings = pricingSettings(organization?.settings)
  const productTotal = lines.length ? lines.reduce((n, l) => n + Number(l.extended), 0) : Number(o.final_cost ?? o.est_cost ?? 0)
  const freight = o.free_shipping ? 0 : o.freight_cost
  const upcharge = hasWwdUpcharge(o)
  const rate = o.freight_pct !== null && o.freight_pct !== undefined ? Number(o.freight_pct) : null
  const b = breakdown(settings, freight, productTotal, upcharge, rate)
  const suggested = (l: OrderLine) => retailPrice(Number(l.unit_cost), b.totalPct)
  const stale = lines.filter((l) => !l.retail_edited && l.retail_price !== null && l.retail_price !== suggested(l)).length
  const unsaved = lines.filter((l) => !l.retail_edited && l.retail_price === null).length

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      if (label) toast.success(label)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Write the calculated price on every line Trevor has not changed by hand. */
  const savePrices = () => run(stale ? 'Prices recalculated with the freight' : 'Prices saved', async () => {
    for (const l of lines) if (!l.retail_edited && l.retail_price !== suggested(l)) await updateOrderLine(l.id, { retail_price: suggested(l) })
  })

  async function addOne(e: FormEvent) {
    e.preventDefault()
    const cost = Number(draft.unit_cost.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(cost) || draft.unit_cost.trim() === '') { toast.error('Add the unit cost.'); return }
    await run('', () => addOrderLines([{ order_id: o.id, vendor_item_id: draft.vendor_item_id.trim() || null, description: draft.description.trim() || null, quantity: Number(draft.quantity) || 1, unit_cost: cost, sort_order: lines.length }]))
    setDraft({ vendor_item_id: '', description: '', quantity: '1', unit_cost: '' })
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Check-in pricing</h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-stone-50 px-4 py-3 text-sm" aria-label="How the prices are figured">
        <span>
          <span className="font-medium text-stone-900">Freight {b.freightPct === null ? 'not billed yet' : pct(b.freightPct)}</span>
          {b.freightPct !== null ? <span className="text-stone-500"> ({rate !== null ? (o.freight_pct_note ?? 'quoted rate') : o.free_shipping ? 'free shipping' : `${money(freight)} on ${money(productTotal)}`})</span> : null}
          {rate !== null && canEdit ? <button type="button" className="ml-1 text-xs text-brand hover:underline" onClick={() => void run('Back to the freight bill', async () => { await updateOrder(o.id, { freight_pct: null, freight_pct_note: null }); await onOrderChange?.() })}>use the freight bill instead</button> : null}
        </span>
        <span className="text-stone-400">·</span>
        <span>Margin {pct(b.marginPct)}</span>
        <span className="text-stone-400">·</span>
        <span>{upcharge ? `WWD upcharge ${pct(b.upchargePct)}` : 'No WWD upcharge'}</span>
        <span className="text-stone-400">·</span>
        <span className="font-semibold text-stone-900">Total {pct(b.totalPct)}</span>
      </div>
      {quoted.data && rate === null && canEdit ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Freight rate quoted in mail: <span className="font-semibold">{quoted.data.pct}%</span> on {new Date(quoted.data.received_at).toLocaleDateString()} ({quoted.data.subject ?? 'an email'}).</span>
          <Button size="sm" loading={busy} onClick={() => void run(`Freight ${quoted.data!.pct}% used`, async () => {
            await updateOrder(o.id, { freight_pct: quoted.data!.pct, freight_pct_note: `rate quoted ${new Date(quoted.data!.received_at).toLocaleDateString()}` })
            await onOrderChange?.()
          })}>Use {quoted.data.pct}%</Button>
        </div>
      ) : null}
      {b.freightPct === null ? <p className="mt-2 text-xs text-stone-500">Prices use margin{upcharge ? ' and upcharge' : ''} only until the freight bill is matched to this order; then recalculate.</p> : null}

      {lines.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <tr>
                <th className="py-2 pr-3">Vendor ID</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Cost</th>
                <th className="py-2 pr-3 text-right">Retail</th>
                <th className="py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {lines.map((l) => <PriceRow key={l.id} line={l} suggested={suggested(l)} canEdit={canEdit} busy={busy} onSave={(changes, label) => run(label, () => updateOrderLine(l.id, changes))} onDelete={() => run('Line removed', () => deleteOrderLine(l.id))} />)}
            </tbody>
          </table>
        </div>
      ) : <p className="mt-4 text-sm text-stone-500">No items yet. Add them from the vendor's invoice{canEdit ? ', or paste them from a spreadsheet' : ''}.</p>}

      {canEdit ? (
        <div className="mt-4 space-y-3">
          {lines.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" loading={busy} disabled={!stale && !unsaved} onClick={() => void savePrices()} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>
                {stale ? `Recalculate ${stale} price${stale === 1 ? '' : 's'}` : unsaved ? 'Save prices' : 'Prices are up to date'}
              </Button>
              <span className="text-xs text-stone-500">Prices you changed by hand stay as you set them.</span>
            </div>
          ) : null}
          <form onSubmit={addOne} className="grid gap-2 sm:grid-cols-[1fr_2fr_5rem_7rem_auto]">
            <Input value={draft.vendor_item_id} onChange={(e) => setDraft({ ...draft, vendor_item_id: e.target.value })} placeholder="Vendor ID" aria-label="Vendor ID" className="h-9" />
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Item" aria-label="Item" className="h-9" />
            <Input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} inputMode="decimal" aria-label="Quantity" className="h-9" />
            <Input value={draft.unit_cost} onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value })} inputMode="decimal" placeholder="Unit cost" aria-label="Unit cost" className="h-9" />
            <Button type="submit" size="sm" variant="secondary" disabled={busy} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add</Button>
          </form>
          {pasting ? (
            <div className="space-y-2">
              <Textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Lines to paste" placeholder={'Copy the rows from a spreadsheet: Vendor ID, item, quantity, unit cost'} />
              <div className="flex gap-2">
                <Button size="sm" loading={busy} onClick={() => {
                  const rows = parsePastedLines(pasted)
                  if (!rows.length) { toast.error('No rows with a quantity and a unit cost found.'); return }
                  void run(`${rows.length} line${rows.length === 1 ? '' : 's'} added`, () => addOrderLines(rows.map((r, i) => ({ ...r, order_id: o.id, sort_order: lines.length + i })))).then(() => { setPasted(''); setPasting(false) })
                }}>Add these lines</Button>
                <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>Cancel</Button>
              </div>
            </div>
          ) : <Button size="sm" variant="ghost" onClick={() => setPasting(true)} leftIcon={<ClipboardPaste className="size-4" aria-hidden="true" />}>Paste from a spreadsheet</Button>}
        </div>
      ) : null}
    </section>
  )
}

function PriceRow({ line: l, suggested, canEdit, busy, onSave, onDelete }: {
  line: OrderLine
  suggested: number | null
  canEdit: boolean
  busy: boolean
  onSave: (changes: Partial<OrderLine>, label: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const shown = l.retail_edited ? l.retail_price : suggested
  const [value, setValue] = useState(shown !== null ? shown.toFixed(2) : '')
  const [prev, setPrev] = useState(shown)
  if (shown !== prev) { setPrev(shown); setValue(shown !== null ? shown.toFixed(2) : '') }

  function commit() {
    const n = Number(value.replace(/[$,\s]/g, ''))
    if (value.trim() === '' || !Number.isFinite(n) || n === shown) { setValue(shown !== null ? shown.toFixed(2) : ''); return }
    void onSave({ retail_price: Math.round(n * 100) / 100, retail_edited: n !== suggested }, 'Price saved')
  }

  return (
    <tr>
      <td className="py-2 pr-3 text-stone-600">{l.vendor_item_id ?? '—'}</td>
      <td className="py-2 pr-3 text-stone-900">{l.description ?? '—'}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{Number(l.quantity)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{money(Number(l.unit_cost))}</td>
      <td className="py-2 pr-3 text-right">
        {canEdit ? (
          <span className="inline-flex items-center gap-1">
            {l.retail_edited ? <button type="button" title={`Back to the calculated ${money(suggested)}`} aria-label="Back to the calculated price" disabled={busy}
              onClick={() => void onSave({ retail_price: suggested, retail_edited: false }, 'Back to the calculated price')} className="rounded p-1 text-amber-600 hover:bg-amber-50"><RotateCcw className="size-3.5" aria-hidden="true" /></button> : null}
            <Input value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              inputMode="decimal" aria-label={`Retail for ${l.description ?? l.vendor_item_id ?? 'this item'}`} className={`h-8 w-24 text-right tabular-nums ${l.retail_edited ? 'border-amber-400' : ''}`} />
          </span>
        ) : <span className="tabular-nums">{money(shown)}</span>}
      </td>
      <td className="py-2 text-right">
        {canEdit ? <button type="button" onClick={() => void onDelete()} disabled={busy} aria-label={`Remove ${l.description ?? 'line'}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600"><Trash2 className="size-4" aria-hidden="true" /></button> : null}
      </td>
    </tr>
  )
}
