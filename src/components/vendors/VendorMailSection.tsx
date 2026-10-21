import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { PenLine } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { countVendorThreads, listSentEmails, listVendorThreads } from '@/services/mail'
import { listVendorFilings, undoSenderFiling, type SenderFiling } from '@/services/neverBought'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { SentTable } from '@/components/mail/SentTable'
import { Button } from '@/components/ui'
import { FoldSection } from '@/components/shared/FoldSection'
import { MailSearchBar, MailSearchResults } from '@/components/mail/MailSearch'
import { filtersFromParams, filtersToParams, isSearching, type MailFilters } from '@/lib/mailSearch'
import { cn, errorMessage } from '@/lib/utils'
import { ROUTES } from '@/lib/constants'
import { mailWithUrl } from '@/lib/mail'
import type { MailView } from '@/types'

type Tab = MailView | 'sent'
const TABS: { value: Tab; label: string }[] = [
  { value: 'attention', label: 'Primary' },
  { value: 'offers', label: 'Promotions' },
  { value: 'sent', label: 'Sent' },
]

/** Every conversation with this vendor, newest first, whoever owns it: Primary (opens here), Promotions, and Sent: every email we sent them (Dana, Oct 12). */
export function VendorMailSection({ vendorId, organizationId, onNewEmail }: { vendorId: string; organizationId: string; onNewEmail?: () => void }) {
  const [view, setView] = useState<Tab>('attention')
  // the Mail search, inside this vendor's mail (Dana, Oct 21); kept in the page address so Back returns to it
  const [params, setParams] = useSearchParams()
  const filters = filtersFromParams(params)
  const searching = isSearching(filters)
  const setFilters = (f: MailFilters) => setParams(filtersToParams(params, f), { replace: true })
  const q = useSupabaseQuery(() => (view === 'sent' ? Promise.resolve([]) : listVendorThreads(organizationId, vendorId, view)), [organizationId, vendorId, view])
  const sent = useSupabaseQuery(() => listSentEmails(organizationId, { vendorId, limit: 200 }), [organizationId, vendorId])
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
  const total = counts.data ? counts.data.attention + counts.data.offers : null
  const summary = total === null ? null
    : total === 0 ? 'None'
    : `${total} conversation${total === 1 ? '' : 's'}${counts.data!.offers ? ` · ${counts.data!.offers} Promotions` : ''}`
  return (
    <FoldSection title="Mail" summary={summary} className="lg:col-span-3"
      actions={onNewEmail ? <Button size="sm" onClick={onNewEmail} leftIcon={<PenLine className="size-4" aria-hidden="true" />}>New email</Button> : null}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex gap-1 rounded-xl bg-stone-100 p-1" aria-label="Which mail">
          {TABS.map((t) => (
            <li key={t.value}>
              <button type="button" onClick={() => setView(t.value)} aria-current={view === t.value ? 'page' : undefined}
                className={cn('block whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium', view === t.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                {t.label}{t.value === 'sent' ? (sent.data ? <span className="ml-1.5 text-xs font-normal text-stone-500">{sent.data.length >= 200 ? '200+' : sent.data.length}</span> : null) : counts.data ? <span className="ml-1.5 text-xs font-normal text-stone-500">{counts.data[t.value]}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {view !== 'sent' && rows.length >= 50 ? <span className="text-xs text-stone-500">Showing the newest 50</span> : null}
      </div>
      <div className="mt-3"><MailSearchBar filters={filters} onChange={setFilters} placeholder="Search this vendor's mail: names, words, PO, file names…" /></div>
      {searching ? (
        <MailSearchResults organizationId={organizationId} filters={filters} scope={{ vendorId }} showVendor={false} onClear={() => setFilters({ q: '' })} />
      ) : view === 'sent' ? (
        sent.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading sent mail…</p>
          : sent.error ? <p className="mt-3 text-sm text-red-700">{sent.error}</p>
          : (sent.data ?? []).length === 0 ? <p className="mt-3 text-sm text-stone-500">We have not sent this vendor any email yet.</p>
          : <div className="mt-3"><SentTable rows={sent.data ?? []} showVendor={false} sortParam="vsent_sort" /></div>
      ) : q.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading mail…</p>
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
                {/* that sender's mail, one click (Dana, Oct 21); a whole address ending opens everyone at that company */}
                {f.sender
                  ? <Link to={f.sender.is_domain ? mailWithUrl(ROUTES.mailWith, `info@${f.sender.sender_key}`, true) : mailWithUrl(ROUTES.mailWith, f.sender.sender_key)} className="font-medium text-brand hover:underline" title="All mail from them">{f.sender.is_domain ? '@' : ''}{f.sender.sender_key}</Link>
                  : <span className="font-medium text-stone-800">A sender</span>}
                <span className="text-xs text-stone-500">{f.how === 'claude' ? 'by Claude' : 'from Never bought from'} · {new Date(f.created_at).toLocaleDateString()}{f.note ? ` · ${f.note}` : ''}</span>
                <button type="button" onClick={() => void undo(f)} className="text-xs font-medium text-brand hover:underline">Undo</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </FoldSection>
  )
}
