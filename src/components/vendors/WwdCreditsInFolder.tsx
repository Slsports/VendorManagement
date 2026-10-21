import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listWwdInvoices } from '@/services/wwd'
import { money, shortDate } from '@/lib/freight'

/**
 * WWD credits in the vendor's Credits folder (Dana, Oct 21: "they should be filed in the credits folder") when no PDF of
 * the credit is on file yet: what Edenred shows, and the invoice it is for.
 */
export function WwdCreditsInFolder({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(async () => (await listWwdInvoices({ vendorId }, 300)).filter((i) => i.kind === 'credit' && !i.document_id), [vendorId])
  const rows = q.data ?? []
  if (!rows.length) return null
  return (
    <div className="mt-3 rounded-lg bg-emerald-50/60 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">WWD credits (no PDF on file)</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((c) => (
          <li key={c.id} className="text-stone-800">
            {shortDate(c.wwd_date)} · {money(Math.abs(c.amount ?? 0))} · WWD Seq # {c.seq}{c.vendor_invoice_number ? ` · ${c.vendor_invoice_number}` : ''}
            {c.credit_for ? <span className="text-stone-500"> · for WWD Seq # {c.credit_for.seq}{c.credit_for.vendor_invoice_number ? ` (Vendor Inv # ${c.credit_for.vendor_invoice_number})` : ''}</span> : <span className="text-amber-700"> · invoice not picked yet (Review)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
