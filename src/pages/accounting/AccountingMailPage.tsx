import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inbox, PenLine } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMailboxes, listSentEmails, listThreads, type ThreadFilters } from '@/services/mail'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_CATEGORY_LABELS } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { SentTable } from '@/components/mail/SentTable'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Alert, Button, Spinner } from '@/components/ui'
import { MailSearchBar, MailSearchResults } from '@/components/mail/MailSearch'
import { filtersFromParams, filtersToParams, isSearching, type MailFilters } from '@/lib/mailSearch'

type Tab = 'attention' | 'offers' | 'all' | 'sent'
const VIEWS: { value: Tab; label: string; help: string }[] = [
  { value: 'attention', label: 'Primary', help: 'Real correspondence: the accounting firm, insurance, banks, people writing to you, bills and statements.' },
  { value: 'offers', label: 'Promotions', help: 'Ads and newsletters. Move a conversation to teach VMS where that kind of mail from that address belongs.' },
  { value: 'all', label: 'Everything', help: 'All billing@ mail, for searching.' },
  { value: 'sent', label: 'Sent', help: 'Every email sent from billing@, newest first.' },
]
const STATUS_TABS: { value: ThreadFilters['status']; label: string }[] = [
  { value: 'needs', label: 'Needs an answer' },
  { value: 'no_answer', label: 'No answer yet' },
  { value: 'waiting', label: 'Waiting on them' },
  { value: 'open', label: 'All open' },
  { value: 'handled', label: 'Handled' },
  { value: 'all', label: 'All' },
  { value: 'deleted', label: 'Deleted' },
]

/** billing@ inside Accounting (Dana, Oct 16): the same views as orders@, sorted by who the mail is with. */
export default function AccountingMailPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const [composing, setComposing] = useState(false)
  const tab = (params.get('view') ?? 'attention') as Tab
  const sent = tab === 'sent'
  const status = (params.get('status') ?? 'open') as ThreadFilters['status']
  const category = params.get('cat') ?? ''
  // the same search as Mail (Dana, Oct 21), inside billing@
  const filters = filtersFromParams(params)
  const searching = isSearching(filters)
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting') ?? null
  const q = useSupabaseQuery(async () => {
    if (!organization || !box || sent || searching) return []
    return listThreads(organization.id, undefined, { view: tab, who: 'all', status, mailbox: box.id, category: category || undefined }, 300)
  }, [organization?.id, box?.id, tab, status, category, sent, searching])
  const sentQ = useSupabaseQuery(async () => (organization && box && sent && !searching ? listSentEmails(organization.id, { mailbox: box.id }) : []), [organization?.id, box?.id, sent, searching])
  const setFilters = (f: MailFilters) => setParams(filtersToParams(params, f), { replace: true })
  const rows = q.data ?? []

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Accounting mail" description="billing@shaverlakesports.com. Private to people with the Accounting tick; answer it here."
        actions={box ? <Button onClick={() => setComposing(true)} leftIcon={<PenLine className="size-4" aria-hidden="true" />}>New email</Button> : undefined} />
      {composing && box ? <ComposeDialog draft={{ to: [], subject: '', body: '', mailbox_id: box.id }} onClose={() => setComposing(false)} onSent={() => void q.refetch()} /> : null}
      {boxes.error ? <Alert variant="error">{boxes.error}</Alert> : null}
      {!boxes.isLoading && !box ? <Alert variant="warning">The billing@ mailbox is not connected to VMS yet.</Alert> : null}
      <div role="tablist" aria-label="Mail view" className="mb-2 flex w-full max-w-xl overflow-x-auto rounded-xl border border-stone-200 bg-white p-1">
        {VIEWS.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={tab === v.value}
            onClick={() => { const next = new URLSearchParams(params); if (v.value === 'attention') next.delete('view'); else next.set('view', v.value); next.delete('status'); setParams(next, { replace: true }) }}
            className={cn('flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold', tab === v.value ? 'bg-brand text-white shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
            {v.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-stone-500">{VIEWS.find((v) => v.value === tab)?.help}</p>
      {sent ? null : (
        <nav aria-label="Mail status" className="mb-3 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
            {STATUS_TABS.map((t) => (
              <li key={t.value}>
                <button type="button" onClick={() => setParam('status', t.value)} aria-current={status === t.value ? 'page' : undefined}
                  className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', status === t.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {sent ? null : (
        <div role="group" aria-label="Who the mail is with" className="mb-4 flex flex-wrap gap-1">
          {[{ value: '', label: 'Everyone' }, ...ACCOUNTING_CATEGORIES.map((c) => ({ value: c, label: ACCOUNTING_CATEGORY_LABELS[c] })), { value: 'none', label: 'No contact yet' }].map((c) => (
            <button key={c.value || 'all'} type="button" aria-pressed={category === c.value} onClick={() => setParam('cat', c.value)}
              className={cn('rounded-full border px-3 py-1 text-sm font-medium', category === c.value ? 'border-brand bg-brand-soft text-brand' : 'border-stone-200 bg-white text-stone-600 hover:text-stone-900')}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <MailSearchBar filters={filters} onChange={setFilters} showDirection={!sent} />
      {searching && organization && box ? (
        <MailSearchResults organizationId={organization.id} filters={filters} scope={{ box: box.id, dir: sent ? 'out' : undefined }} showVendor={false} showContact onClear={() => setFilters({ q: '' })} />
      ) : sent ? (
        sentQ.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading sent mail…" className="text-brand" /></div>
          : sentQ.error ? <Alert variant="error">{sentQ.error}</Alert>
          : (sentQ.data ?? []).length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">Nothing sent from billing@ yet.</p>
          : <SentTable rows={sentQ.data ?? []} />
      ) : q.isLoading || boxes.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading mail…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
            <Inbox className="size-8 text-stone-400" aria-hidden="true" />
            <p className="mt-3 text-sm text-stone-600">{status === 'open' && !category ? 'Nothing open.' : 'No mail matches.'}</p>
          </div>
        ) : (
          <>
            <ThreadTable rows={rows} showVendor={false} showContact onChanged={q.refetch} deletedMode={status === 'deleted'} />
            {rows.length >= 300 ? <p className="mt-2 text-xs text-stone-500">Showing the newest 300. Search or filter to narrow it down.</p> : null}
          </>
        )}
    </div>
  )
}
