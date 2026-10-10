import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Inbox, PenLine, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useViewAs } from '@/hooks/useViewAs'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listThreads, type ThreadFilters } from '@/services/mail'
import { listSnoozes, mySnoozes } from '@/services/snooze'
import { listPeople } from '@/services/reviews'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Alert, Button, Select, Spinner } from '@/components/ui'

const VIEWS: { value: NonNullable<ThreadFilters['view']>; label: string; help: string }[] = [
  { value: 'attention', label: 'Needs attention', help: 'Replies, confirmations, invoices, questions: anything someone has to act on.' },
  { value: 'offers', label: 'Offers & catalogs', help: 'Specials, price lists, catalogs and newsletters. Move a conversation to teach VMS where that sender belongs.' },
  { value: 'freight', label: 'Freight', help: 'Carriers: PartnerShip, Worldwide Express, Priority One and Pinnacle. Bills also wait under Freight bills.' },
  { value: 'all', label: 'Everything', help: 'All mail, for searching.' },
]

const STATUS_TABS: { value: ThreadFilters['status']; label: string }[] = [
  { value: 'needs', label: 'Needs an answer' },
  { value: 'no_answer', label: 'No answer yet' },
  { value: 'waiting', label: 'Waiting on vendor' },
  { value: 'open', label: 'All open' },
  { value: 'handled', label: 'Handled' },
  { value: 'all', label: 'All' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'deleted', label: 'Deleted' },
]

/** orders@ inside VMS: whose mail, where it stands, filed to which vendor. Everything is shared; ownership decides whose list. */
export default function MailPage() {
  const { organization, profile, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [composing, setComposing] = useState(false)
  const [params, setParams] = useSearchParams()
  const viewAs = useViewAs()
  // Admins see the person chosen in the top bar (Dana, Oct 8); a choice made here wins.
  const whoDefault = viewAs.isMe ? 'mine' : viewAs.personId ?? 'all'
  const who = params.get('who') ?? whoDefault
  const view = (params.get('view') ?? 'attention') as NonNullable<ThreadFilters['view']>
  // Handled mail leaves every tab (Dana, Oct 8); it stays under Handled, on its vendor and on its carrier.
  const status = (params.get('status') ?? 'open') as ThreadFilters['status']
  const unmatched = params.get('unmatched') === '1'
  const search = params.get('q') ?? ''
  const [draft, setDraft] = useState(search)
  const people = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  // Snooze (Dana, Oct 9): my snoozed conversations leave my lists until their time; the Snoozed tab shows
  // mine, or everyone's when looking at everyone, with who and until when.
  const q = useSupabaseQuery(async () => {
    if (!organization || !profile) return { rows: [], snoozed: new Map<string, { until: string; who: string | null }>(), back: new Set<string>() }
    if (status === 'snoozed') {
      const list = await listSnoozes(organization.id, 'thread', who === 'all' ? null : who === 'mine' ? profile.id : who === 'none' ? profile.id : who)
      const rows = await listThreads(organization.id, profile.id, { view: 'all', who: 'all', status: 'all', onlyIds: [...new Set(list.map((x) => x.thread_id!))] }, 300)
      const snoozed = new Map(list.map((x) => [x.thread_id!, { until: x.until, who: x.profile_id === profile.id ? null : x.person?.full_name ?? 'someone' }]))
      return { rows, snoozed, back: new Set<string>() }
    }
    const mine = await mySnoozes(profile.id, 'thread')
    const rows = await listThreads(organization.id, profile.id, { view, who, status, unmatched, q: search, hideIds: [...mine.hidden.keys()] }, 300, profile.sees_freight)
    // back from snooze: to the top of the list
    const back = rows.filter((t) => mine.back.has(t.id))
    return { rows: [...back, ...rows.filter((t) => !mine.back.has(t.id))], snoozed: new Map<string, { until: string; who: string | null }>(), back: mine.back }
  }, [organization?.id, profile?.id, profile?.sees_freight, view, who, status, unmatched, search])
  const rows = q.data?.rows ?? []

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader title="Mail" description="Everything that comes into orders@, filed by vendor. Answer it here; Gmail is the backup."
        actions={canEdit ? <Button onClick={() => setComposing(true)} leftIcon={<PenLine className="size-4" aria-hidden="true" />}>New email</Button> : undefined} />
      {composing ? <ComposeDialog draft={{ to: [], subject: '', body: '' }} onClose={() => setComposing(false)} onSent={() => void q.refetch()} /> : null}
      <div role="tablist" aria-label="Mail view" className="mb-2 flex w-full max-w-2xl overflow-x-auto rounded-xl border border-stone-200 bg-white p-1">
        {VIEWS.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={view === v.value}
            onClick={() => { const next = new URLSearchParams(params); if (v.value === 'attention') next.delete('view'); else next.set('view', v.value); next.delete('status'); setParams(next, { replace: true }) }}
            className={cn('flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold', view === v.value ? 'bg-brand text-white shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
            {v.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-stone-500">{VIEWS.find((v) => v.value === view)?.help}</p>
      <nav aria-label="Mail status" className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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
      <form onSubmit={(e) => { e.preventDefault(); setParam('q', draft.trim()) }} className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 sm:min-w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value) setParam('q', '') }} placeholder="Search subjects…" aria-label="Search mail" className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm" />
        </div>
        <Select value={who} onChange={(e) => setParam('who', e.target.value === whoDefault ? '' : e.target.value)} aria-label="Whose mail" className="lg:w-56">
          <option value="mine">Mine</option>
          <option value="all">Everyone</option>
          <option value="none">Nobody's yet</option>
          {(people.data ?? []).filter((p) => p.id !== profile?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={unmatched} onChange={(e) => setParam('unmatched', e.target.checked ? '1' : '')} className="size-4 rounded border-stone-300" />
          Not filed to a vendor
        </label>
      </form>
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading mail…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
            <Inbox className="size-8 text-stone-400" aria-hidden="true" />
            <p className="mt-3 text-sm text-stone-600">{status === 'snoozed' ? 'Nothing snoozed.' : who === 'mine' && status === 'open' ? 'Nothing waiting on you.' : 'No mail matches.'}</p>
            {who === 'mine' ? <button type="button" onClick={() => setParam('who', 'all')} className="mt-2 text-sm font-medium text-brand hover:underline">Show everyone's</button> : null}
          </div>
        ) : (
          <>
            <ThreadTable rows={rows} onChanged={q.refetch} deletedMode={status === 'deleted'} snoozed={q.data?.snoozed} back={q.data?.back} />
            {rows.length >= 300 ? <p className="mt-2 text-xs text-stone-500">Showing the newest 300. Search or filter to narrow it down.</p> : null}
          </>
        )}
    </div>
  )
}
