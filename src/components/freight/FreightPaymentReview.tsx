import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, FileText, Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { answerFreightPayment, listFreightBills } from '@/services/freight'
import { downloadVendorFile } from '@/services/lines'
import { money, shortDate } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button, Select } from '@/components/ui'

interface Details { thread_id?: string; carrier_id?: string | null; carrier?: string | null; source?: 'receipt' | 'email'; amount?: number | null; date?: string | null; via?: string | null; ref?: string | null; invoices?: string[]; receipt_path?: string | null; receipt_file?: string | null }

/** A freight payment Claude could not match to one bill (Dana, Oct 8): pick the bill it paid. */
export function FreightPaymentReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const { organization } = useAuth()
  const { view, viewer } = useDocumentViewer()
  const bills = useSupabaseQuery(async () => (organization ? listFreightBills(organization.id, 'unpaid', d.carrier_id ?? null) : []), [organization?.id, d.carrier_id])
  const [bill, setBill] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await answerFreightPayment(item.id, bill)
      toast.success('Bill marked paid')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <div className="mt-1 space-y-2 text-amber-900">
      {viewer}
      <p>
        {d.source === 'email' ? 'Our email says a bill was paid' : `${d.carrier ?? 'A carrier'} sent a payment receipt`}
        {d.amount != null ? <> · <span className="font-medium">{money(d.amount)}</span></> : null}
        {d.date ? ` · ${shortDate(d.date)}` : ''}{d.via ? ` · ${d.via.toUpperCase()}` : ''}{d.ref ? ` · ${d.ref}` : ''}
        {d.invoices?.length ? ` · invoice ${d.invoices.join(', ')}` : ''}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {d.thread_id ? <Link to={`${ROUTES.mail}/${d.thread_id}`} className="inline-flex items-center gap-1 underline"><Mail className="size-3.5" aria-hidden="true" />The email</Link> : null}
        {d.receipt_path ? (
          <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => view({ name: d.receipt_file ?? 'Receipt.pdf', mime: 'application/pdf', load: () => downloadVendorFile(d.receipt_path!) })}>
            <FileText className="size-3.5" aria-hidden="true" />The receipt
          </button>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={bill} onChange={(e) => setBill(e.target.value)} aria-label="Which bill it paid" className="h-9 sm:w-96">
            <option value="">{bills.isLoading ? 'Loading unpaid bills…' : 'Which bill did it pay?'}</option>
            {(bills.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.carriers?.name ?? 'Carrier'}{b.invoice_number ? ` #${b.invoice_number}` : ''} · {money(b.total)} · {shortDate(b.invoice_date)}</option>)}
          </Select>
          <Button size="sm" loading={busy} disabled={!bill} onClick={() => void save()} leftIcon={<Check className="size-4" aria-hidden="true" />}>Mark this bill paid</Button>
        </div>
      ) : null}
    </div>
  )
}
