import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ClipboardCheck, Settings2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useViewAs } from '@/hooks/useViewAs'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { applyVendorRename, listReviewQueue } from '@/services/vendors'
import { assignReviewItem, listPeople } from '@/services/reviews'
import { REVIEW_KIND_LABELS } from '@/lib/reviews'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
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
  const refresh = async () => { await Promise.all([q.refetch(), snoozeQ.refetch(), allSnoozes.refetch()]) }

  const everything = q.data ?? []
  const items = showSnoozed ? everything.filter((i) => snoozedBy.has(i.id)) : [...everything.filter((i) => back.has(i.id)), ...everything.filter((i) => !back.has(i.id) && !hidden.has(i.id))]
  const people = peopleQ.data ?? []
  const me = profile?.id
  const mineCount = items.filter((i) => i.assigned_to === me).length
  const noneCount = items.filter((i) => !i.assigned_to).length
  const viewAs = useViewAs()
  /** Open on your own items when you have any; otherwise everyone's. An admin looking at someone sees theirs. */
  const who: Who = whoChoice ?? (viewAs.isMe ? (mineCount > 0 ? 'me' : 'all') : viewAs.personId ?? 'all')
  const shown = items.filter((i) => (who === 'all' ? true : who === 'me' ? i.assigned_to === me : who === 'none' ? !i.assigned_to : i.assigned_to === who))
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

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading review queue…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const kinds = [...new Set(shown.map((i) => i.kind))].sort((a, b) => Object.keys(REVIEW_KIND_LABELS).indexOf(a) - Object.keys(REVIEW_KIND_LABELS).indexOf(b))

  return (
    <div>
      <PageHeader
        title="Review queue"
        description={items.length ? `${items.length} item${items.length === 1 ? '' : 's'} waiting for a decision${mineCount ? `, ${mineCount} assigned to you` : ''}.` : 'Nothing waiting. New items land here from imports, the mailbox and the vendor form.'}
        actions={<span className="flex flex-wrap gap-2">
          <Button variant={showSnoozed ? 'primary' : 'ghost'} onClick={() => setShowSnoozed((v) => !v)}>{showSnoozed ? 'Back to the queue' : `Snoozed (${snoozedBy.size})`}</Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.mergeReport)}>Lightspeed merge report</Button>
        </span>}
      />
      {items.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            Show
            <Select value={who} onChange={(e) => setWhoChoice(e.target.value)} aria-label="Whose items to show" className="h-9 w-56">
              <option value="all">Everyone ({items.length})</option>
              <option value="me">Mine ({mineCount})</option>
              <option value="none">Unassigned ({noneCount})</option>
              {people.filter((p) => p.id !== me).map((p) => {
                const n = items.filter((i) => i.assigned_to === p.id).length
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
      {items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
          <ClipboardCheck className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">All clear.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-12 text-center">
          <ClipboardCheck className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">Nothing here for {who === 'me' ? 'you' : who === 'none' ? 'nobody' : nameOf(who)}.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setWhoChoice('all')}>Show everyone's ({items.length})</Button>
        </div>
      ) : (
        kinds.map((kind) => {
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
      )}
    </div>
  )
}
