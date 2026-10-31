import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ClipboardList, Mail, Send } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { getOrderShipmentRequest, sendShipmentRequestNow, shipmentAnswers } from '@/services/shipmentRequests'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { SHIPMENT_STATUS, shipmentKindLabel, shipmentMethodLabel } from '@/lib/shipmentRequests'
import { Badge, Button } from '@/components/ui'

/**
 * The shipment details email on an order (Dana, Oct 30): what went to whom and when, whether the vendor opened the form,
 * and their answers (pickup, contact, pallets or packages, quote), with the email one click away.
 */
export function ShipmentRequestCard({ orderId, canEdit }: { orderId: string; canEdit: boolean }) {
  const [now] = useState(() => new Date().toISOString())
  const q = useSupabaseQuery(() => getOrderShipmentRequest(orderId), [orderId])
  useLiveTable('shipment_requests', `order_id=eq.${orderId}`, () => { void q.refetch() })
  const r = q.data
  if (!r || r.status === 'skipped') return null
  const a = shipmentAnswers(r)
  const st = SHIPMENT_STATUS[r.status]
  const late = ['sent', 'opened'].includes(r.status) && !!r.followup_due_at && r.followup_due_at < now
  async function sendNow() {
    try { await sendShipmentRequestNow(r!.id); toast.success('Sent'); await q.refetch() } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <section className={`rounded-2xl border p-5 ${late ? 'border-red-300 bg-red-50/40' : 'border-stone-200 bg-white'}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><ClipboardList className="size-4" aria-hidden="true" />Shipment details</h2>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={st.tone}>{st.text}</Badge>
        <span className="text-stone-700">{shipmentKindLabel(r.kind)}</span>
        {r.thread_id ? <Link to={`${ROUTES.mail}/${r.thread_id}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail className="size-3.5" aria-hidden="true" />the email</Link> : null}
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-medium text-stone-500">Sent</dt><dd>{r.sent_at ? `${shortDate(r.sent_at)} to ${r.to_emails.join(', ')}${r.cc_emails.length ? ` (cc ${r.cc_emails.join(', ')})` : ''}` : r.status === 'ready' ? (r.review_task_id ? `Waiting for ${'Trevor'} to check the confirmation first (the email is in Drafts)` : r.to_emails.length ? (r.hold ? 'Ready, not sent yet' : 'Going out within a few minutes') : 'No email on file for this vendor') : '—'}</dd></div>
        <div><dt className="text-xs font-medium text-stone-500">Opened · answered</dt><dd>{r.opened_at ? shortDate(r.opened_at) : '—'} · {r.answered_at ? `${shortDate(r.answered_at)} ${r.answered_how === 'form' ? 'on the form' : 'by email'}` : late ? <span className="font-medium text-red-700">nothing after 3 business days</span> : '—'}</dd></div>
      </dl>
      {r.status === 'answered' ? (
        <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">
          <p><span className="font-medium">{shipmentMethodLabel(r.method)}</span>{a.ready_date ? ` · ready ${shortDate(a.ready_date)}` : ''}{a.quote_amount ? ` · their quote $${Number(a.quote_amount).toFixed(2)}` : ''}</p>
          {a.company ? <p className="mt-1 text-stone-700">Pickup: {[a.company, a.address, [a.city, a.state].filter(Boolean).join(' '), a.zip].filter(Boolean).join(', ')}{a.hours ? ` · ${a.hours}` : ''}</p> : null}
          {a.contact_name || a.contact_email || a.contact_phone ? <p className="text-stone-700">Contact: {[a.contact_name, a.contact_email, a.contact_phone].filter(Boolean).join(' · ')}</p> : null}
          {a.services?.length ? <p className="text-stone-700">Pickup needs: {a.services.map((s) => s.replace('_', ' ')).join(', ')}</p> : null}
          {a.items?.length ? (
            <ul className="mt-1 list-inside list-disc text-stone-700">
              {a.items.map((it, i) => <li key={i}>{it.count} × {[it.length && it.width && it.height ? `${it.length}×${it.width}×${it.height} in` : null, it.weight ? `${it.weight} lbs${it.count > 1 ? ' each' : ''}` : null, it.freight_class ? `class ${it.freight_class}` : null, it.stackable ? 'stackable' : null, it.hazmat ? 'hazmat' : null, it.description].filter(Boolean).join(', ')}</li>)}
            </ul>
          ) : null}
          {a.notes ? <p className="mt-1 text-stone-700">Notes: {a.notes}</p> : null}
          {r.quote_id ? <Link to={`${ROUTES.freightQuotes}/${r.quote_id}`} className="mt-2 inline-block font-medium text-brand hover:underline">Open the freight quote</Link> : null}
        </div>
      ) : null}
      {r.note ? <p className="mt-2 text-xs text-stone-600">{r.note}</p> : null}
      {canEdit && r.status === 'ready' && r.to_emails.length ? <Button size="sm" className="mt-3" onClick={() => void sendNow()} leftIcon={<Send className="size-4" aria-hidden="true" />}>Send now</Button> : null}
    </section>
  )
}
