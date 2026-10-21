import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { listWwdInvoices } from '@/services/wwd'
import { wwdInvoiceFiles } from '@/services/freight'
import { downloadVendorFile } from '@/services/lines'
import { money, shortDate } from '@/lib/freight'

/**
 * WWD credits in the vendor's Credits folder (Dana, Oct 21: "they should be filed in the credits folder") when no PDF of
 * the credit is on file yet: what Edenred shows, and the invoice it is for (its PDF opens from here when on file).
 */
export function WwdCreditsInFolder({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(async () => (await listWwdInvoices({ vendorId }, 300)).filter((i) => i.kind === 'credit' && !i.document_id), [vendorId])
  const rows = q.data ?? []
  const files = useSupabaseQuery(async () => wwdInvoiceFiles(rows.map((c) => c.credit_for?.id ?? '')), [rows.map((c) => c.credit_for?.id ?? '').join()])
  const { view, viewer } = useDocumentViewer()
  /** The invoice the credit is for: its PDF in one click when it is on file. */
  const forLink = (id: string, text: string) => {
    const f = files.data?.get(id)?.file
    if (!f) return text
    return <button type="button" onClick={() => view({ name: f.file_name ?? `${text}.pdf`, mime: f.mime_type, load: () => downloadVendorFile(f.storage_path) })} className="text-brand hover:underline" title="Open the invoice PDF">{text}</button>
  }
  if (!rows.length) return null
  return (
    <div className="mt-3 rounded-lg bg-emerald-50/60 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">WWD credits (no PDF on file)</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((c) => (
          <li key={c.id} className="text-stone-800">
            {shortDate(c.wwd_date)} · {money(Math.abs(c.amount ?? 0))} · WWD Seq # {c.seq}{c.vendor_invoice_number ? ` · ${c.vendor_invoice_number}` : ''}
            {c.credit_for ? <span className="text-stone-500"> · for {forLink(c.credit_for.id, `WWD Seq # ${c.credit_for.seq}`)}{c.credit_for.vendor_invoice_number ? ` (Vendor Inv # ${c.credit_for.vendor_invoice_number})` : ''}</span> : <span className="text-amber-700"> · invoice not picked yet (Review)</span>}
          </li>
        ))}
      </ul>
      {viewer}
    </div>
  )
}
