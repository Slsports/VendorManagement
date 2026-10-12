import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { finishOrderingItem, getOpenOrderingItem, moveOrderingItem, suggestedOrderFor } from '@/services/ordering'
import { downloadVendorFile } from '@/services/lines'
import { supabase } from '@/lib/supabase'
import { money } from '@/lib/freight'
import { saveBlob } from '@/lib/viewer'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { AddOrderDialog, type OrderPrefill } from '@/components/orders/AddOrderDialog'
import { Button, Spinner } from '@/components/ui'
import { SalesReportUpload } from './SalesReportUpload'

const STAGE_WORD = { placed: 'placed', confirmed: 'confirmed', shipped: 'shipped, not in LS yet' } as const
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })

/**
 * The suggested order for a vendor (Dana, Oct 11): from the latest sales report, what LS says we need minus what is
 * already coming in, with an On order column naming the order and when it is expected. Quantities can be changed
 * before "Order placed" turns it into an order.
 */
export function SuggestedOrderDialog({ vendor, onClose }: { vendor: { id: string; name: string; aliases?: string[] }; onClose: () => void }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(() => suggestedOrderFor(vendor.id), [vendor.id])
  const flag = useSupabaseQuery(() => getOpenOrderingItem(vendor.id), [vendor.id])
  const [qty, setQty] = useState<Record<string, string>>({})
  const [ordering, setOrdering] = useState<OrderPrefill | null>(null)
  const [busy, setBusy] = useState(false)
  const lines = useMemo(() => q.data?.lines ?? [], [q.data])
  const amount = (sid: string, suggested: number) => { const v = qty[sid]; return v === undefined ? suggested : Math.max(0, Math.round(Number(v) || 0)) }
  const picked = lines.map((l) => ({ l, n: amount(l.sid, l.suggested) })).filter((x) => x.n > 0)
  const total = picked.reduce((s, x) => s + x.n * (x.l.cost ?? 0), 0)
  const report = q.data?.report

  async function act(fn: () => Promise<void>, done: string) {
    setBusy(true)
    try { await fn(); toast.success(done); onClose() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function download() {
    if (!report?.document_id) return
    const { data } = await supabase.from('vendor_links').select('storage_path, file_name').eq('id', report.document_id).maybeSingle()
    if (!data?.storage_path) return toast.error('The report file is missing')
    try { saveBlob(await downloadVendorFile(data.storage_path), data.file_name ?? 'sales report.xlsx') } catch (e) { toast.error(errorMessage(e)) }
  }
  function placeOrder() {
    setOrdering({
      description: `Reorder from sales report (${picked.length} item${picked.length === 1 ? '' : 's'})`,
      cost: total ? Math.round(total * 100) / 100 : null,
      lines: picked.map(({ l, n }) => ({ vendor_item_id: l.vid || null, description: l.desc, quantity: n, unit_cost: l.cost ?? 0 })),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Suggested order for ${vendor.name}`}>
      <div className="flex max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Suggested order · {vendor.name}</h2>
            {report ? <p className="text-xs text-stone-500">From the sales report of {new Date(`${report.run_date}T12:00:00`).toLocaleDateString()} ({report.days} days). Need = sold − in stock; On order = already coming in. <button type="button" onClick={() => void download()} className="font-medium text-brand hover:underline">Download the report</button></p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-sm">
          {q.isLoading ? <div className="flex justify-center py-10"><Spinner label="Working it out…" className="text-brand" /></div>
            : q.error ? <p className="text-red-700">{q.error}</p>
            : !report ? (
              <div className="py-8 text-center">
                <p className="text-stone-600">No sales report for {vendor.name} yet. Upload the LS Analytics export and VMS works out what to order.</p>
                <div className="mt-3 flex justify-center"><SalesReportUpload vendor={vendor} variant="primary" onSaved={() => void q.refetch()} /></div>
              </div>
            ) : (
              <>
                {q.data?.unlisted.length ? (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                    Also open, with no item list to subtract: {q.data.unlisted.map((u, i) => <span key={u.id}>{i ? ', ' : ''}<Link to={`${ROUTES.orders}/${u.id}`} className="underline">{u.label}</Link> ({STAGE_WORD[u.stage]})</span>)}. Check them before ordering.
                  </p>
                ) : null}
                {lines.length === 0 ? <p className="py-6 text-center text-stone-600">Nothing needed: every item has enough in stock or on order.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                        <tr>
                          <th className="px-2 py-1.5">Vendor ID</th><th className="px-2 py-1.5">Description</th>
                          <th className="px-2 py-1.5 text-right">Sold</th><th className="px-2 py-1.5 text-right">In stock</th><th className="px-2 py-1.5 text-right">Need</th>
                          <th className="px-2 py-1.5">On order</th><th className="px-2 py-1.5 text-right">Order</th><th className="px-2 py-1.5 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {lines.map((l) => {
                          const n = amount(l.sid, l.suggested)
                          return (
                            <tr key={l.sid} className={cn('align-top', !n && 'text-stone-400')}>
                              <td className="whitespace-nowrap px-2 py-1.5">{l.vid || '—'}</td>
                              <td className="min-w-48 px-2 py-1.5">{l.desc}</td>
                              <td className="px-2 py-1.5 text-right">{l.sold}</td>
                              <td className="px-2 py-1.5 text-right">{l.inStock}</td>
                              <td className={cn('px-2 py-1.5 text-right font-medium', l.need > 0 ? 'text-emerald-700' : 'text-stone-400')}>{l.need}</td>
                              <td className="px-2 py-1.5 text-xs text-stone-600">
                                {l.from.length ? l.from.map((f) => (
                                  <Link key={`${f.orderId}-${f.qty}`} to={`${ROUTES.orders}/${f.orderId}`} className="block hover:text-brand">{f.qty} · {STAGE_WORD[f.stage]}{f.expected ? `, ships ${day(f.expected)}` : ''}</Link>
                                )) : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <input type="number" min={0} value={qty[l.sid] ?? String(l.suggested)} onChange={(e) => setQty((v) => ({ ...v, [l.sid]: e.target.value }))}
                                  aria-label={`Order quantity for ${l.desc}`} className="h-8 w-16 rounded-md border border-yellow-300 bg-yellow-50 px-1.5 text-right text-sm" />
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right">{l.cost !== null ? money(l.cost * n) : ''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
        </div>
        {report ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-4 py-3">
            <p className="text-sm text-stone-700"><span className="font-semibold">{picked.reduce((s, x) => s + x.n, 0)}</span> units, {picked.length} items · <span className="font-semibold">{money(total)}</span></p>
            <div className="flex flex-wrap gap-2">
              <SalesReportUpload vendor={vendor} label="Upload a newer report" onSaved={() => void q.refetch()} />
              {flag.data ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => finishOrderingItem(flag.data!.id, 'not_needed'), `${vendor.name}: not needed`)}>Don't need it</Button> : null}
              {flag.data?.stage === 'check' ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => moveOrderingItem(flag.data!.id, 'to_order'), `${vendor.name}: moved to To order`)}>Order it</Button> : null}
              <Button size="sm" disabled={busy || !picked.length} onClick={placeOrder}>Order placed</Button>
            </div>
          </div>
        ) : null}
      </div>
      {ordering && organization ? (
        <AddOrderDialog vendor={vendor} prefill={ordering} onClose={() => setOrdering(null)} onSaved={async (order) => {
          if (flag.data) await finishOrderingItem(flag.data.id, 'ordered', order.id)
          onClose()
        }} />
      ) : null}
    </div>
  )
}
