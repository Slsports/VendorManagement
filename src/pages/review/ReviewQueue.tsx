import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ClipboardCheck, Settings2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useViewAs } from '@/hooks/useViewAs'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { applyVendorRename, getReviewQueueItem, listReviewQueue } from '@/services/vendors'
import { assignReviewItem, listPeople } from '@/services/reviews'
import { REVIEW_KIND_LABELS, REVIEW_TABS, reviewTabOfCheck, reviewTabOfKind, type ReviewTab } from '@/lib/reviews'
import { listOpenChecks } from '@/services/orderChecks'
import { ChecksList } from '@/components/orders/ChecksList'
import { NeverBoughtList } from '@/components/review/NeverBoughtList'
import { listNeverBought } from '@/services/neverBought'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReviewItemCard } from '@/components/vendors/ReviewItemCard'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { SnoozeButton } from '@/components/shared/SnoozeButton'
import { listSnoozes, mySnoozes } from '@/services/snooze'
import { snoozeText } from '@/lib/snooze'
import { Alert, Button, Select, Spinner } from '@/components/ui'

/** 'all' | 'me' | 'none' | a profile id */
type Who = string

export default function ReviewQueuePage() {
  const { role, organization, profile } = useAuth()
  const navigate = useNavigate()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listReviewQueue(organization.id) : []), [organization?.id])
  const checksQ = useSupabaseQuery(async () => (organization ? listOpenChecks(organization.id, null) : []), [organization?.id])
  const [params, setParams] = useSearchParams()
  // ?item= (Dana, Oct 18): a report note or a task lands on one card, shown on top whatever its status
  const openedId = params.get('item')
  const openedQ = useSupabaseQuery(async () => (organization && openedId ? getReviewQueueItem(organization.id, openedId) : null), [organization?.id, openedId])
  const neverQ = useSupabaseQuery(async () => (organization ? listNeverBought(organization.id) : []), [organization?.id])
  const neverToCheck = (neverQ.data ?? []).filter((r) => !r.checked_at).length
  const peopleQ = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const [applyingAll, setApplyingAll] = useState(false)
  const [whoChoice, setWhoChoice] = useState<Who | null>(null)
  // Snooze (Dana, Oct 9): my snoozed items leave the queue until their time, then come back on top.
  const snoozeQ = useSupabaseQuery(async () => (profile ? mySnoozes(profile.id, 'review') : null), [profile?.id])
  const allSnoozes = useSupabaseQuery(async () => (organization ? listSnoozes(organization.id, 'review', null) : []), [organization?.id])
  const [showSnoozed, setShowSnoozed] = useState(false)
  const hidden = snoozeQ.data?.hidden ?? new Map<string, string>()
  const back = snoozeQ.data?.back ?? new Set<string>()
  const snoozedBy = new Map((allSnoozes.data ?? []).map((s) => [s.review_item_id!, s]))
  const refresh = async () => { await Promise.all([q.refetch(), checksQ.refetch(), snoozeQ.refetch(), allSnoozes.refetch(), openedQ.refetch()]) }
  // paperwork Claude reads and cards that land while the page is open (Dana, Oct 19)
  useLiveTable('order_checks', null, () => { void checksQ.refetch() })
  useLiveTable('review_items', null, () => { void q.refetch() })

  const everything = (q.data ?? []).filter((i) => i.id !== openedId)
  const items = showSnoozed ? everything.filter((i) => snoozedBy.has(i.id)) : [...everything.filter((i) => back.has(i.id)), ...everything.filter((i) => !back.has(i.id) && !hidden.has(i.id))]
  const checks = showSnoozed ? [] : checksQ.data ?? []
  const people = peopleQ.data ?? []
  const me = profile?.id
  // Tabs (Dana, Oct 12): the same kinds as the dashboard Review card; ?tab= opens one.
  const tabCount = (t: ReviewTab, list: { tab: ReviewTab }[]) => list.filter((x) => x.tab === t).length
  const tagged = [...items.map((i) => ({ tab: reviewTabOfKind(i.kind), assigned_to: i.assigned_to })), ...checks.map((c) => ({ tab: reviewTabOfCheck(c), assigned_to: c.assigned_to }))]
  const pageTabs = REVIEW_TABS
  const asked = pageTabs.find((t) => t.id === params.get('tab'))?.id
  const tab: ReviewTab = asked ?? pageTabs.find((t) => t.id !== 'never' && tabCount(t.id, tagged) > 0)?.id ?? 'confirmations'
  const inTab = tagged.filter((x) => x.tab === tab)
  const total = tagged.length
  const mineCount = inTab.filter((i) => i.assigned_to === me).length
  const noneCount = inTab.filter((i) => !i.assigned_to).length
  function setTab(t: ReviewTab) {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }
  const viewAs = useViewAs()
  /** Open on your own items when you have any; otherwise everyone's. An admin looking at someone sees theirs. */
  const who: Who = whoChoice ?? (viewAs.isMe ? (mineCount > 0 ? 'me' : 'all') : viewAs.personId ?? 'all')
  const whoMatch = (i: { assigned_to: string | null }) => (who === 'all' ? true : who === 'me' ? i.assigned_to === me : who === 'none' ? !i.assigned_to : i.assigned_to === who)
  const isPaperwork = tab === 'confirmations' || tab === 'invoices' || tab === 'hand'
  const shown = items.filter((i) => reviewTabOfKind(i.kind) === tab && whoMatch(i))
  const shownChecks = checks.filter((c) => reviewTabOfCheck(c) === tab && whoMatch(c))
  // paperwork tabs list order checks; Needs a hand also has the scanned invoices to file (Dana, Oct 20)
  const shownCount = isPaperwork ? shownChecks.length + shown.length : shown.length
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.full_name ?? 'Someone') : 'nobody')

  async function assign(itemId: string, profileId: string | null) {
    try {
      await assignReviewItem(itemId, profileId)
      toast.success(profileId ? `Assigned to ${nameOf(profileId)}` : 'Unassigned')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function applyAllRenames(ids: string[]) {
    if (!window.confirm(`Apply all ${ids.length} proposed names as shown?`)) return
    setApplyingAll(true)
    let done = 0
    try {
      for (const id of ids) {
        try { await applyVendorRename(id); done++ } catch (err) { toast.error(errorMessage(err)) }
      }
      toast.success(`${done} name${done === 1 ? '' : 's'} updated`)
      await q.refetch()
    } finally {
      setApplyingAll(false)
    }
  }

  if (q.isLoading || checksQ.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading review queue…" className="text-brand" /></div>
  if (q.error || checksQ.error) return <Alert variant="error">{q.error ?? checksQ.error}</Alert>
  const kinds = [...new Set(shown.map((i) => i.kind))].sort((a, b) => Object.keys(REVIEW_KIND_LABELS).indexOf(a) - Object.keys(REVIEW_KIND_LABELS).indexOf(b))

  const itemSections = kinds.map((kind) => {
          const meta = REVIEW_KIND_LABELS[kind] ?? { title: kind, help: '' }
          const group = shown.filter((i) => i.kind === kind)
          return (
            <section key={kind} className="mb-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{meta.title} <span className="font-normal text-stone-400">({group.length})</span></h2>
                {kind === 'vendor_rename' && canEdit && group.length > 1 ? <Button size="sm" variant="secondary" loading={applyingAll} onClick={() => void applyAllRenames(group.map((i) => i.id))}>Apply all as proposed</Button> : null}
              </div>
              {meta.help ? <p className="mb-3 text-sm text-stone-600">{meta.help}</p> : null}
              <div className="space-y-2">
                {group.map((item) => (
                  <ReviewItemCard
                    key={item.id}
                    item={item}
                    vendor={item.vendor}
                    other={item.other}
                    canEdit={canEdit}
                    onDone={() => refresh()}
                    aside={<span className="flex flex-col items-end gap-1">
                      {back.has(item.id) ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Back from snooze</span> : null}
                      {snoozedBy.has(item.id) ? <span className="text-xs text-stone-500">Snoozed until {snoozeText(snoozedBy.get(item.id)!.until)}{snoozedBy.get(item.id)!.profile_id !== me ? ` by ${snoozedBy.get(item.id)!.person?.full_name ?? 'someone'}` : ''}</span> : null}
                      {canEdit
                        ? <AssigneeSelect value={item.assigned_to} people={people} onChange={(id) => assign(item.id, id)} />
                        : item.assigned_to ? <span className="text-xs text-amber-800">Assigned to {nameOf(item.assigned_to)}</span> : null}
                      <SnoozeButton kind="review" ids={[item.id]} until={hidden.get(item.id) ?? null} onDone={() => refresh()} />
                    </span>}
                  />
                ))}
              </div>
            </section>
          )
        })

  return (
    <div>
      <PageHeader
        title="Review queue"
        description={total ? `${total} item${total === 1 ? '' : 's'} waiting for a decision${tagged.filter((i) => i.assigned_to === me).length ? `, ${tagged.filter((i) => i.assigned_to === me).length} assigned to you` : ''}.` : 'Nothing waiting. New items land here from imports, the mailbox, order paperwork and the vendor form.'}
        actions={<span className="flex flex-wrap gap-2">
          <Button variant={showSnoozed ? 'primary' : 'ghost'} onClick={() => setShowSnoozed((v) => !v)}>{showSnoozed ? 'Back to the queue' : `Snoozed (${snoozedBy.size})`}</Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.mergeReport)}>Lightspeed merge report</Button>
        </span>}
      />
      <nav aria-label="Kinds of review" className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-xl bg-stone-100 p-1">
          {pageTabs.map((t) => {
            const n = t.id === 'never' ? neverToCheck : tabCount(t.id, tagged)
            const mine = tagged.filter((x) => x.tab === t.id && x.assigned_to === (viewAs.personId ?? me)).length
            return (
              <li key={t.id}><button type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} title={t.help}
                className={cn('block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', tab === t.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
                {t.label} <span className={cn('text-xs', mine ? 'font-semibold text-amber-700' : 'font-normal text-stone-500')}>{n}</span>
              </button></li>
            )
          })}
        </ul>
      </nav>
      <p className="mb-3 text-sm text-stone-600">{REVIEW_TABS.find((t) => t.id === tab)!.help}</p>
      {openedId ? (
        <section className="mb-6 rounded-2xl border-2 border-brand/40 bg-brand-soft/30 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600">The item you opened</h2>
            <button type="button" className="text-sm text-brand hover:underline" onClick={() => { const next = new URLSearchParams(params); next.delete('item'); setParams(next, { replace: true }) }}>Back to the list</button>
          </div>
          {openedQ.error ? <Alert variant="error">{openedQ.error}</Alert>
            : openedQ.isLoading && !openedQ.data ? <Spinner />
            : !openedQ.data ? <p className="text-sm text-stone-600">That item is not in Review any more.</p>
            : <ReviewItemCard item={openedQ.data} vendor={openedQ.data.vendor} other={openedQ.data.other} canEdit={canEdit} onDone={() => refresh()} />}
        </section>
      ) : null}
      {tab === 'never' ? <NeverBoughtList canEdit={canEdit} /> : null}
      {tab !== 'never' && inTab.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            Show
            <Select value={who} onChange={(e) => setWhoChoice(e.target.value)} aria-label="Whose items to show" className="h-9 w-56">
              <option value="all">Everyone ({inTab.length})</option>
              <option value="me">Mine ({mineCount})</option>
              <option value="none">Unassigned ({noneCount})</option>
              {people.filter((p) => p.id !== me).map((p) => {
                const n = inTab.filter((i) => i.assigned_to === p.id).length
                return n || p.id === who ? <option key={p.id} value={p.id}>{p.full_name} ({n})</option> : null
              })}
            </Select>
          </label>
          {role === 'admin' ? (
            <Link to={`${ROUTES.settings}/review-assignments`} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              <Settings2 className="size-4" aria-hidden="true" /> Assignment rules
            </Link>
          ) : null}
        </div>
      ) : null}
      {tab === 'never' ? null : inTab.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
          <ClipboardCheck className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">All clear.</p>
        </div>
      ) : shownCount === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-12 text-center">
          <ClipboardCheck className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">Nothing here for {who === 'me' ? 'you' : who === 'none' ? 'nobody' : nameOf(who)}.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setWhoChoice('all')}>Show everyone's ({inTab.length})</Button>
        </div>
      ) : isPaperwork ? (
        <>
          {shownChecks.length ? <ChecksList rows={shownChecks} showWho={who !== 'me'} /> : null}
          {shown.length ? <div className={shownChecks.length ? 'mt-8' : ''}>{itemSections}</div> : null}
        </>
      ) : (
        itemSections
      )}
    </div>
  )
}
