import type React from 'react'
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
import { ComposeDialog, type ComposeDraft } from '@/components/mail/ComposeDialog'
import { addLinesToOrder, openOrdersForVendor, orderPapers, vendorOrderAddresses } from '@/services/addOns'
import { addOnEmail, orderWord } from '@/lib/addOns'
import { Button, Spinner } from '@/components/ui'
import { SalesReportUpload } from './SalesReportUpload'
import { OnOrderSources } from './OnOrderSources'
import { createAvailabilityAsk, latestAvailabilityAsk, repAddresses } from '@/services/availability'
import { ANSWER_WORD, availabilityEmail } from '@/lib/availability'
import { matchLink } from '@/lib/mailSearch'

// Dana, Oct 21: pending until the vendor confirms, placed once confirmed
const STAGE_WORD = { placed: 'pending', confirmed: 'placed', shipped: 'shipped, not in LS yet' } as const
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The suggested order for a vendor (Dana, Oct 11): from the latest sales report, what LS says we need minus what is
 * already coming in, with an On order column naming the order and when it is expected. Quantities can be changed
 * before "Order placed" turns it into an order.
 */
export function SuggestedOrderDialog({ vendor, onClose }: { vendor: { id: string; name: string; aliases?: string[] }; onClose: () => void }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(() => suggestedOrderFor(vendor.id), [vendor.id])
  const flag = useSupabaseQuery(() => getOpenOrderingItem(vendor.id), [vendor.id])
  // typed quantities survive opening a linked order and coming Back (Dana, Oct 21)
  const qtyKey = `vms.suggested.qty.${vendor.id}`
  const [qty, setQtyState] = useState<Record<string, string>>(() => { try { return JSON.parse(sessionStorage.getItem(qtyKey) ?? '{}') } catch { return {} } })
  const setQty = (f: (v: Record<string, string>) => Record<string, string>) => setQtyState((v) => { const n = f(v); try { sessionStorage.setItem(qtyKey, JSON.stringify(n)) } catch { /* private window */ } return n })
  const [ordering, setOrdering] = useState<OrderPrefill | null>(null)
  const [busy, setBusy] = useState(false)
  const openOrders = useSupabaseQuery(() => openOrdersForVendor(vendor.id), [vendor.id])
  const [addOnDraft, setAddOnDraft] = useState<ComposeDraft | null>(null)
  // Ask the rep what is discontinued (Dana, Oct 21): the email, and what the rep answered last time
  const [askDraft, setAskDraft] = useState<ComposeDraft | null>(null)
  const ask = useSupabaseQuery(() => latestAvailabilityAsk(vendor.id), [vendor.id])
  const answers = new Map(((ask.data?.answers ?? []) as { vid?: string; status?: string }[]).filter((a) => a.vid).map((a) => [a.vid!.toUpperCase(), a.status ?? '']))
  const lines = useMemo(() => q.data?.lines ?? [], [q.data])
  const amount = (sid: string, suggested: number) => { const v = qty[sid]; return v === undefined ? suggested : Math.max(0, Math.round(Number(v) || 0)) }
  const picked = lines.map((l) => ({ l, n: amount(l.sid, l.suggested) })).filter((x) => x.n > 0)
  const total = picked.reduce((s, x) => s + x.n * (x.l.cost ?? 0), 0)
  const report = q.data?.report

  async function act(fn: () => Promise<void>, done: string) {
    setBusy(true)
    try { await fn(); toast.success(done); try { sessionStorage.removeItem(qtyKey) } catch { /* private window */ } onClose() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function download() {
    if (!report?.document_id) return
    const { data } = await supabase.from('vendor_links').select('storage_path, file_name').eq('id', report.document_id).maybeSingle()
    if (!data?.storage_path) return toast.error('The report file is missing')
    try { saveBlob(await downloadVendorFile(data.storage_path), data.file_name ?? 'sales report.xlsx') } catch (e) { toast.error(errorMessage(e)) }
  }
  /** Add to PO … (Dana, Oct 16): the picked lines go on the open order, then the email with them in one table. */
  async function addToOrder(o: { id: string; po_number: string | null; order_date: string | null; est_ship_date: string | null; status: string; addons: 'yes' | 'no' | 'ask' | null; description: string | null }) {
    setBusy(true)
    try {
      const lines = picked.map(({ l, n }) => ({ vendor_item_id: l.vid || null, description: l.desc, quantity: n, unit_cost: l.cost }))
      const added = await addLinesToOrder(o.id, lines)
      const papers = await orderPapers(o.id)
      const to = await vendorOrderAddresses(vendor.id)
      const m = addOnEmail({ vendorName: vendor.name, order: o, lines, hasConfirmation: !!papers.confirmation, originalLines: papers.originalLines })
      const attach = papers.confirmation ?? papers.orderSheet
      toast.success(`${added} item${added === 1 ? '' : 's'} added to ${orderWord(o)}`)
      setAddOnDraft({ to, subject: m.subject, body: m.body, vendor_id: vendor.id, vendor_link_ids: attach ? [attach.id] : [], note: attach ? `Attaching ${attach.file_name ?? 'the paper on file'}` : 'No confirmation or order sheet on file to attach; the original lines are in the email.' })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function emailRep() {
    setBusy(true)
    try {
      const items = lines.map((l) => ({ vid: l.vid || null, name: l.desc, qty: amount(l.sid, l.suggested) }))
      const askId = await createAvailabilityAsk(vendor.id, report?.id ?? null, items)
      const m = availabilityEmail(vendor.name, items)
      setAskDraft({ to: await repAddresses(vendor.id), subject: m.subject, body: m.body, vendor_id: vendor.id, availability_ask_id: askId,
        note: 'When the rep replies, Claude reads it and puts anything discontinued or out of stock in your Review queue.' })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
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
                {ask.data ? (
                  <p className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    Asked the rep {ask.data.sent_at ? new Date(ask.data.sent_at).toLocaleDateString() : ''}
                    {ask.data.thread_id ? <> (<Link to={`${ROUTES.mail}/${ask.data.thread_id}`} className="underline">the email</Link>)</> : null}
                    {ask.data.status === 'read'
                      ? <>: {ask.data.read_note ?? 'reply read'}{ask.data.reply_email_id && ask.data.thread_id ? <> · <Link to={matchLink(ask.data.thread_id, { email_id: ask.data.reply_email_id })} className="underline">their reply</Link></> : null} · <Link to={`${ROUTES.review}?tab=items`} className="underline">decide in Review</Link></>
                      : ': waiting for their reply.'}
                  </p>
                ) : null}
                <OnOrderSources sources={q.data?.sources ?? []} />
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
                              <td className="min-w-48 px-2 py-1.5">{l.desc}{l.vid && answers.get(l.vid.toUpperCase()) && answers.get(l.vid.toUpperCase()) !== 'not_mentioned' ? <span className={cn('ml-1 rounded px-1 text-[11px] font-medium', answers.get(l.vid.toUpperCase()) === 'available' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>{ANSWER_WORD[answers.get(l.vid.toUpperCase())!]}</span> : null}</td>
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
              {lines.length ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void emailRep()} title="Ask the rep which of these are discontinued or out of stock">Email the rep</Button> : null}
              {flag.data ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => finishOrderingItem(flag.data!.id, 'not_needed'), `${vendor.name}: not needed`)}>Don't need it</Button> : null}
              {flag.data?.stage === 'check' ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => moveOrderingItem(flag.data!.id, 'to_order'), `${vendor.name}: moved to To order`)}>Order it</Button> : null}
              {(openOrders.data ?? []).filter((o) => o.addons === 'yes').map((o) => <Button key={o.id} size="sm" variant="secondary" disabled={busy || !picked.length} onClick={() => void addToOrder(o)} title={o.est_ship_date ? `Ships ${new Date(`${o.est_ship_date}T12:00:00`).toLocaleDateString()}` : 'No ship date yet'}>Add to {orderWord(o)}</Button>)}
              <Button size="sm" disabled={busy || !picked.length} onClick={placeOrder}>Order placed</Button>
            </div>
            {(openOrders.data ?? []).some((o) => o.addons !== 'yes') ? <p className="w-full text-xs text-stone-500">Open orders not taking add-ons, or not asked yet: {(openOrders.data ?? []).filter((o) => o.addons !== 'yes').map((o) => <Link key={o.id} to={`${ROUTES.orders}/${o.id}`} className="underline hover:text-brand">{orderWord(o)}{o.est_ship_date ? ` (ships ${new Date(`${o.est_ship_date}T12:00:00`).toLocaleDateString()})` : ''} · add-ons {o.addons === 'no' ? 'no' : o.addons === 'ask' ? 'asked' : 'not confirmed'}</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}</p> : null}
          </div>
        ) : null}
      </div>
      {askDraft ? <ComposeDialog draft={askDraft} onClose={() => setAskDraft(null)} onSent={() => { setAskDraft(null); toast.success('Sent. Claude reads the reply when it comes.'); void ask.refetch() }} /> : null}
      {addOnDraft ? <ComposeDialog draft={addOnDraft} onClose={() => setAddOnDraft(null)} onSent={() => { setAddOnDraft(null); if (flag.data) void finishOrderingItem(flag.data.id, 'ordered'); onClose() }} /> : null}
      {ordering && organization ? (
        <AddOrderDialog vendor={vendor} prefill={ordering} onClose={() => setOrdering(null)} onSaved={async (order) => {
          if (flag.data) await finishOrderingItem(flag.data.id, 'ordered', order.id)
          onClose()
        }} />
      ) : null}
    </div>
  )
}
