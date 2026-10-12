import { useState } from 'react'
import toast from 'react-hot-toast'
import { PenLine } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { countVendorThreads, listVendorThreads } from '@/services/mail'
import { listVendorFilings, undoSenderFiling, type SenderFiling } from '@/services/neverBought'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { Button } from '@/components/ui'
import { cn, errorMessage } from '@/lib/utils'
import type { MailView } from '@/types'

const TABS: { value: MailView; label: string }[] = [
  { value: 'attention', label: 'Primary' },
  { value: 'offers', label: 'Promotions' },
]

/** Every conversation with this vendor, newest first, whoever owns it: Primary (opens here) and Promotions (Dana, Oct 12). */
export function VendorMailSection({ vendorId, organizationId, onNewEmail }: { vendorId: string; organizationId: string; onNewEmail?: () => void }) {
  const [view, setView] = useState<MailView>('attention')
  const q = useSupabaseQuery(() => listVendorThreads(organizationId, vendorId, view), [organizationId, vendorId, view])
  const counts = useSupabaseQuery(() => countVendorThreads(organizationId, vendorId), [organizationId, vendorId])
  const filings = useSupabaseQuery(() => listVendorFilings(vendorId), [vendorId])
  const rows = q.data ?? []
  async function undo(f: SenderFiling) {
    const who = f.sender ? `${f.sender.is_domain ? '@' : ''}${f.sender.sender_key}` : 'this sender'
    if (!window.confirm(`Take ${who}'s mail off this vendor? It goes back to "Who is this?" in the Review queue.`)) return
    try {
      await undoSenderFiling(f.id)
      toast.success(`${who} is back in "Who is this?"`)
      await Promise.all([filings.refetch(), q.refetch(), counts.refetch()])
    } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Mail</h2>
          <ul className="flex gap-1 rounded-xl bg-stone-100 p-1" aria-label="Which mail">
            {TABS.map((t) => (
              <li key={t.value}>
                <button type="button" onClick={() => setView(t.value)} aria-current={view === t.value ? 'page' : undefined}
                  className={cn('block whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium', view === t.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                  {t.label}{counts.data ? <span className="ml-1.5 text-xs font-normal text-stone-500">{counts.data[t.value]}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-3">
          {rows.length >= 50 ? <span className="text-xs text-stone-500">Showing the newest 50</span> : null}
          {onNewEmail ? <Button size="sm" onClick={onNewEmail} leftIcon={<PenLine className="size-4" aria-hidden="true" />}>New email</Button> : null}
        </div>
      </div>
      {q.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading mail…</p>
        : q.error ? <p className="mt-3 text-sm text-red-700">{q.error}</p>
        : rows.length === 0 ? <p className="mt-3 text-sm text-stone-500">{view === 'offers' ? 'No promotions from this vendor.' : 'No mail filed to this vendor yet. Mail from orders@ lands here once the sender is known.'}</p>
        : <div className="mt-3"><ThreadTable rows={rows} showVendor={false} sortParam="mail_sort" /></div>}
      {filings.data?.length ? (
        // senders filed here by Claude or from the Never bought from list (Dana, Oct 12): undo if it is wrong
        <div className="mt-4 border-t border-stone-100 pt-3">
          <p className="text-xs font-medium text-stone-500">Mail filed here automatically</p>
          <ul className="mt-1 space-y-1 text-sm">
            {filings.data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-stone-800">{f.sender ? `${f.sender.is_domain ? '@' : ''}${f.sender.sender_key}` : 'A sender'}</span>
                <span className="text-xs text-stone-500">{f.how === 'claude' ? 'by Claude' : 'from Never bought from'} · {new Date(f.created_at).toLocaleDateString()}{f.note ? ` · ${f.note}` : ''}</span>
                <button type="button" onClick={() => void undo(f)} className="text-xs font-medium text-brand hover:underline">Undo</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
