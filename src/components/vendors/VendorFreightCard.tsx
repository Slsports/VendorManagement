import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileText, Truck } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOpenOrdersForFreight } from '@/services/templates'
import { listRoutingLetters, listRoutingSends, routingLetterUrl, type RoutingSendRow } from '@/services/routingLetter'
import { listVendorFreight } from '@/services/freight'
import { ORDER_STATUS_LABELS, ROUTES, type OrderStatus } from '@/lib/constants'
import { money, shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { FreightEmailButton } from '@/components/orders/FreightEmailButton'
import { Badge } from '@/components/ui'
import type { RoutingLetter } from '@/types'

/**
 * One Freight card per vendor (Dana, Nov 13: "we only need one card for freight for each vendor. We can log whether a
 * vendor received our most current routing letter in the Freight card"): whether they have the current routing letter,
 * the Freight email for each order still to ship, and the carrier bills that carried their shipments.
 */
export function VendorFreightCard({ vendorId, organizationId, canEdit }: { vendorId: string; organizationId: string; canEdit: boolean }) {
  const letters = useSupabaseQuery(() => listRoutingLetters(organizationId), [organizationId])
  const sends = useSupabaseQuery(() => listRoutingSends(organizationId, vendorId), [organizationId, vendorId])
  const orders = useSupabaseQuery(() => listOpenOrdersForFreight(vendorId), [vendorId])
  const bills = useSupabaseQuery(() => listVendorFreight(vendorId), [vendorId])
  const current = letters.data?.[0] ?? null
  const rows = sends.data ?? []
  const open = orders.data ?? []
  const shipments = bills.data ?? []
  const total = shipments.reduce((s, r) => s + r.amount, 0)

  async function openLetter() {
    if (!current) return
    try { window.open(await routingLetterUrl(current.storage_path), '_blank', 'noopener') } catch (err) { toast.error(errorMessage(err)) }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Truck className="size-4 text-brand" aria-hidden="true" />Freight</h2>

      {/* 1. the routing letter */}
      <div className="mt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Routing letter</h3>
        {current ? (
          <>
            <LetterStatus current={current} rows={rows} />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" onClick={() => void openLetter()} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><FileText className="size-3.5" aria-hidden="true" />Open the letter (version {current.version})</button>
              {rows.length ? (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-brand hover:underline">Every send ({rows.length})</summary>
                  <ul className="mt-1 space-y-1">
                    {rows.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-stone-700">
                        <span>{s.sent_at ? `Sent ${shortDate(s.sent_at)}` : 'In Drafts, not sent'} to {s.contact_name ? `${s.contact_name}, ` : ''}{s.email}</span>
                        <span className="text-stone-500">v{s.letter?.version}</span>
                        {s.received_at ? <Badge tone="success">Received {shortDate(s.received_at)}</Badge> : s.sent_at ? <Badge tone="warning">Not confirmed</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </>
        ) : <p className="mt-1 text-sm text-stone-500">No routing letter yet (<Link to={ROUTES.routingLetter} className="text-brand hover:underline">Freight › Routing letter</Link>).</p>}
      </div>

      {/* 2. the Freight email for each order still to ship */}
      <div className="mt-4 border-t border-stone-100 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Freight email</h3>
        {open.length ? (
          <ul className="mt-1 divide-y divide-stone-100 text-sm">
            {open.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link to={`${ROUTES.orders}/${o.id}`} className="font-medium text-stone-900 hover:text-brand">{o.po_number ? `PO ${o.po_number}` : 'Order'}</Link>
                <span className="text-xs text-stone-500">{[ORDER_STATUS_LABELS[o.status as OrderStatus], o.order_date ? shortDate(o.order_date) : null, o.est_cost != null ? money(Number(o.est_cost)) : null, o.sent ? `sent ${shortDate(o.sent)}` : null].filter(Boolean).join(' · ')}</span>
                {canEdit ? <span className="ml-auto"><FreightEmailButton orderId={o.id} label={o.sent ? 'Send again' : 'Freight email'} onSent={() => { void orders.refetch(); void sends.refetch() }} /></span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-stone-500">{orders.isLoading ? 'Loading…' : 'No orders waiting to ship.'}</p>}
      </div>

      {/* 3. the carrier bills that carried their shipments */}
      {shipments.length ? (
        <details className="mt-3 border-t border-stone-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-500">Shipments <span className="font-normal normal-case tracking-normal text-stone-600">· {shipments.length} · {money(total)}</span></summary>
          <ul className="mt-1 divide-y divide-stone-100 text-sm">
            {shipments.map((r) => (
              <li key={r.line_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="text-stone-700">
                  {shortDate(r.ship_date ?? r.invoice_date)} · {r.carrier ?? 'Carrier'}{r.invoice_number ? ` · ${r.invoice_number}` : ''}
                  {r.po_number ? <span className="text-xs text-stone-400"> · PO {r.po_number}</span> : null}
                  {r.paid_date ? <span className="text-xs text-green-700"> · paid {shortDate(r.paid_date)}</span> : r.status === 'needs_pdf' ? <span className="text-xs text-amber-700"> · PDF missing</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  {r.order_id ? <Link to={`${ROUTES.orders}/${r.order_id}`} className="text-xs text-brand hover:underline">Order</Link> : null}
                  <Link to={`${ROUTES.freight}/${r.bill_id}`} className="text-xs text-brand hover:underline">Open the bill</Link>
                  <span className="font-medium text-stone-900">{money(r.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

/** Do they have our current routing letter? Received, sent but not confirmed, an older version, or never sent. */
function LetterStatus({ current, rows }: { current: RoutingLetter; rows: RoutingSendRow[] }) {
  const mine = rows.filter((s) => s.letter_id === current.id && s.sent_at)
  const got = mine.filter((s) => s.received_at).sort((a, b) => b.received_at!.localeCompare(a.received_at!))[0]
  if (got) return <p className="mt-1 text-sm"><Badge tone="success">Has the current letter</Badge> <span className="text-stone-700">{got.contact_name ?? got.email} received version {current.version} on {shortDate(got.received_at!)}</span></p>
  const last = mine.sort((a, b) => b.sent_at!.localeCompare(a.sent_at!))[0]
  if (last) return <p className="mt-1 text-sm"><Badge tone="warning">Not confirmed yet</Badge> <span className="text-stone-700">Version {current.version} sent {shortDate(last.sent_at!)} to {last.contact_name ?? last.email}</span></p>
  const older = rows.filter((s) => s.sent_at && s.letter_id !== current.id).sort((a, b) => b.sent_at!.localeCompare(a.sent_at!))[0]
  if (older) return <p className="mt-1 text-sm"><Badge tone="warning">Older version</Badge> <span className="text-stone-700">Had version {older.letter?.version} ({older.received_at ? 'received' : 'sent'} {shortDate(older.received_at ?? older.sent_at!)}); the current one goes with their next freight email</span></p>
  return <p className="mt-1 text-sm"><Badge tone="neutral">Not sent yet</Badge> <span className="text-stone-700">It goes with their next freight email</span></p>
}
