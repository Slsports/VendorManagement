import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, GitMerge, Scissors, Trash2, X } from 'lucide-react'
import { applyVendorRename, confirmVendorMerge, deleteVendor, mergeVendors, resolveReviewItem, unmergeVendor } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_LABELS } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import type { BillingRoute, ReviewItem } from '@/types'
import { Button, Input, Select } from '@/components/ui'
import { EmailSenderReview } from '@/components/mail/EmailSenderReview'
import { VendorAssignmentActions } from '@/components/vendors/VendorAssignmentActions'
import { DeliveryReceiptReview } from '@/components/freight/DeliveryReceiptReview'
import { MailReplyReview } from '@/components/mail/MailReplyReview'

type VendorRef = { id: string; name: string; lightspeed_name: string | null; aliases: string[] } | null

export interface ReviewItemCardProps {
  item: ReviewItem
  /** The vendor the item is about (entity_id). */
  vendor: VendorRef
  /** For possible duplicates: the other vendor. */
  other: VendorRef
  canEdit: boolean
  /** Called after any action; the parent refetches. The new/kept vendor id is passed when one results. */
  onDone: (resultVendorId?: string) => void | Promise<void>
  /** Shown top-right of the card, e.g. the assignee picker. */
  aside?: ReactNode
}

/** Passed to onDone when the card deleted its vendor, so a vendor page can leave. */
export const VENDOR_DELETED = 'deleted'

type RouteChoice = '' | BillingRoute

const ROUTE_OPTIONS: { value: RouteChoice; label: string }[] = [
  { value: '', label: 'Route: leave as is' },
  { value: 'worldwide', label: 'WWD (Worldwide)' },
  { value: 'faire', label: 'Faire' },
  { value: 'direct', label: 'Not WWD (direct)' },
]

/**
 * One review item with real actions:
 *  - vendor_merge (auto-merged at import): Confirm it is one vendor, or Split a name back out.
 *  - vendor_duplicate (two records that look alike): Keep both, or Merge into the one you choose.
 *  - vendor_assignment (who orders from it): keep the proposed person or pick another.
 *  - delivery_receipt (a carrier receipt Claude could not match): pick the vendor that shipped it.
 *  - mail_reply (Claude not sure an email needs an answer): Needs an answer / No answer needed.
 *  - vendor_marker and anything else: Done / Dismiss.
 * Any card about one vendor can also delete it as "not a vendor" (never one with orders).
 * Every merge, confirm or split can state WWD / Faire / Not WWD so the result's usual route is right.
 */
export function ReviewItemCard({ item, vendor, other, canEdit, onDone, aside }: ReviewItemCardProps) {
  const [busy, setBusy] = useState(false)
  const [route, setRoute] = useState<RouteChoice>('')
  const [keep, setKeep] = useState<'this' | 'other'>('this')
  const [mode, setModeState] = useState<'idle' | 'merge' | 'split'>('idle')
  const [splitName, setSplitName] = useState('')
  const details = (item.details ?? {}) as { other_vendor_id?: string; other_name?: string; reason?: string; lightspeed_names?: string[]; question?: string; routes?: string[]; current_name?: string; new_name?: string; alias?: string | null; rep_group_name?: string | null; proposed_assignee_id?: string }
  const [newName, setNewName] = useState(details.new_name ?? '')
  const names = details.lightspeed_names ?? []
  const routeArg = route || null

  /** Each action starts with a fresh route choice; the select is asked per action, not per card. */
  function setMode(next: 'idle' | 'merge' | 'split') {
    setModeState(next)
    setRoute('')
  }

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true)
    try {
      const id = await fn()
      toast.success(label)
      setMode('idle')
      await onDone(typeof id === 'string' ? id : undefined)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const routeSelect = (
    <Select value={route} onChange={(e) => setRoute(e.target.value as RouteChoice)} aria-label="Billing route for the result" className="h-9 sm:w-52">
      {ROUTE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  )

  if (item.kind === 'mail_reply') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-medium text-amber-900">{item.title}</p>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        <MailReplyReview item={item} canEdit={canEdit} onDone={() => onDone()} />
      </div>
    )
  }

  if (item.kind === 'delivery_receipt') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-medium text-amber-900">{item.title}</p>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        <DeliveryReceiptReview item={item} canEdit={canEdit} onDone={() => onDone()} />
      </div>
    )
  }

  if (item.kind === 'email_sender') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-medium text-amber-900">{item.title}</p>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        <EmailSenderReview item={item} canEdit={canEdit} onDone={() => onDone()} />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium text-amber-900">{item.title}</p>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {details.reason ? <p className="text-amber-800">{details.reason}.</p> : null}
      {details.question ? <p className="text-amber-800">{details.question}</p> : null}
      {item.kind === 'vendor_rename' ? (
        <p className="text-amber-800">
          Proposed: <span className="font-medium">{details.new_name}</span>
          {details.rep_group_name ? <> · rep group <span className="font-medium">{details.rep_group_name}</span></> : null}
          {details.alias ? <> · keeps "{details.alias}" as an alias</> : null}. The Lightspeed name stays as an alias either way.
        </p>
      ) : null}
      {names.length ? (
        <p className="mt-1 text-amber-800">
          Lightspeed names: {names.map((n, i) => <span key={n}>{i ? ' | ' : ''}<span className="font-medium">{n}</span></span>)}
          {details.routes?.length ? ` · tagged ${details.routes.map((r) => BILLING_ROUTE_LABELS[r as BillingRoute] ?? r).join(', ')}` : ''}
        </p>
      ) : null}
      <p className="mt-1 flex flex-wrap gap-x-3 text-amber-900">
        {vendor ? <Link to={`${ROUTES.vendors}/${vendor.id}`} className="underline">Open {vendor.name}</Link> : null}
        {other ? <Link to={`${ROUTES.vendors}/${other.id}`} className="underline">Open {other.name}</Link> : null}
      </p>

      {canEdit ? (
        <div className="mt-3 border-t border-amber-200 pt-3">
          {item.kind === 'vendor_merge' && vendor ? (
            mode === 'split' ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Select value={splitName} onChange={(e) => setSplitName(e.target.value)} aria-label="Lightspeed name to split out" className="h-9 sm:w-64">
                  <option value="">Which name is a different vendor?</option>
                  {vendor.aliases.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
                {routeSelect}
                <Button size="sm" loading={busy} disabled={!splitName} onClick={() => void run('Split into its own vendor', () => unmergeVendor(vendor.id, splitName, routeArg))} leftIcon={<Scissors className="size-4" aria-hidden="true" />}>Split it out</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {routeSelect}
                <Button size="sm" loading={busy} onClick={() => void run('Merge confirmed', () => confirmVendorMerge(vendor.id, routeArg))} leftIcon={<Check className="size-4" aria-hidden="true" />}>Yes, one vendor</Button>
                <Button size="sm" variant="secondary" disabled={busy || vendor.aliases.length === 0} onClick={() => setMode('split')} leftIcon={<Scissors className="size-4" aria-hidden="true" />}>No, split one out</Button>
              </div>
            )
          ) : item.kind === 'vendor_duplicate' && vendor && other ? (
            mode === 'merge' ? (
              <div className="flex flex-col gap-2">
                <p className="text-amber-900">Keep which record? The other one's contacts, routes and notes move into it.</p>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                  <label className="flex items-center gap-2"><input type="radio" name={`keep-${item.id}`} checked={keep === 'this'} onChange={() => setKeep('this')} /> {vendor.name}{vendor.lightspeed_name ? <span className="text-amber-700"> ({vendor.lightspeed_name})</span> : null}</label>
                  <label className="flex items-center gap-2"><input type="radio" name={`keep-${item.id}`} checked={keep === 'other'} onChange={() => setKeep('other')} /> {other.name}{other.lightspeed_name ? <span className="text-amber-700"> ({other.lightspeed_name})</span> : null}</label>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {routeSelect}
                  <Button size="sm" loading={busy} onClick={() => void run('Merged', () => mergeVendors(keep === 'this' ? vendor.id : other.id, keep === 'this' ? other.id : vendor.id, routeArg))} leftIcon={<GitMerge className="size-4" aria-hidden="true" />}>Merge now</Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={busy} onClick={() => void run('Kept both', () => resolveReviewItem(item.id, 'rejected', 'Keep both'))} leftIcon={<X className="size-4" aria-hidden="true" />}>Keep both, not the same</Button>
                <Button size="sm" disabled={busy} onClick={() => setMode('merge')} leftIcon={<GitMerge className="size-4" aria-hidden="true" />}>Same vendor, merge</Button>
              </div>
            )
          ) : item.kind === 'vendor_assignment' && vendor ? (
            <VendorAssignmentActions vendorId={vendor.id} proposedId={details.proposed_assignee_id ?? null} onDone={() => onDone()} />
          ) : item.kind === 'vendor_rename' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Vendor name" className="h-9 sm:w-72" />
              <Button size="sm" loading={busy} disabled={!newName.trim()} onClick={() => void run('Name updated', () => applyVendorRename(item.id, newName.trim()))} leftIcon={<Check className="size-4" aria-hidden="true" />}>Use this name</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run('Kept as is', () => resolveReviewItem(item.id, 'rejected', 'Keep name'))}>Keep as is</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void run('Done', () => resolveReviewItem(item.id, 'accepted', 'Handled'))} leftIcon={<Check className="size-4" aria-hidden="true" />}>Handled</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run('Dismissed', () => resolveReviewItem(item.id, 'rejected', 'Dismissed'))}>Dismiss</Button>
            </div>
          )}
          {item.entity_type === 'vendor' && vendor && item.kind !== 'vendor_duplicate' ? (
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="ghost" disabled={busy} className="text-red-700 hover:bg-red-50"
                onClick={() => { if (window.confirm(`Delete ${vendor.name}? It never shows in VMS again, and imports skip it. Use this only for names that were never a vendor.`)) void run(`${vendor.name} deleted`, async () => { await deleteVendor(vendor.id); return VENDOR_DELETED }) }}
                leftIcon={<Trash2 className="size-4" aria-hidden="true" />}>Not a vendor, delete it</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
