import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Ban, Building2, Check, Layers, Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listRepGroupNames, listVendorNames, resolveEmailSender } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { newVendorFromMailUrl } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import type { ReviewItem } from '@/types'
import { Button, Input, Select } from '@/components/ui'

export interface EmailSenderDetails {
  sender_id: string
  sender_key: string
  is_domain: boolean
  display_name: string | null
  message_count: number
  proposed_vendor_id: string | null
  proposed_vendor_name: string | null
  proposal_note: string | null
  samples: string[]
}

/**
 * "Mail from @wfsports.com looks like World Famous Sports": confirm it, pick another vendor, say it is a
 * rep group or a service that sends for many vendors (each email then matched by the vendor it names),
 * or not a vendor at all. One answer covers every email from that sender, now and later.
 */
export function EmailSenderReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const { organization } = useAuth()
  const d = item.details as unknown as EmailSenderDetails
  const [mode, setMode] = useState<'idle' | 'vendor' | 'rep'>('idle')
  const [busy, setBusy] = useState(false)
  const [vendorName, setVendorName] = useState('')
  const [repId, setRepId] = useState('')
  const vendors = useSupabaseQuery(async () => (mode === 'vendor' && organization ? listVendorNames(organization.id) : []), [mode, organization?.id])
  const reps = useSupabaseQuery(async () => (mode === 'rep' && organization ? listRepGroupNames(organization.id) : []), [mode, organization?.id])
  const picked = (vendors.data ?? []).find((v) => v.name.toLowerCase() === vendorName.trim().toLowerCase())
  const listId = `vendors-${item.id}`

  async function answer(label: string, kind: 'vendor' | 'rep_group' | 'platform' | 'not_vendor', vendorId?: string, repGroupId?: string) {
    setBusy(true)
    try {
      const linked = await resolveEmailSender(d.sender_id, kind, vendorId, repGroupId)
      toast.success(linked ? `${label}: ${linked} email${linked === 1 ? '' : 's'} filed` : label)
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-amber-800">
        {d.message_count} email{d.message_count === 1 ? '' : 's'}{d.display_name ? ` · from "${d.display_name}"` : ''}{d.proposal_note ? ` · ${d.proposal_note}` : ''}
      </p>
      {d.samples?.length ? <p className="mt-1 truncate text-xs text-amber-700">Recent: {d.samples.join(' · ')}</p> : null}
      {canEdit ? (
        <div className="mt-3 border-t border-amber-200 pt-3">
          {mode === 'vendor' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input list={listId} value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder={vendors.isLoading ? 'Loading vendors…' : 'Type a vendor name'} aria-label="Vendor" className="h-9 sm:w-72" autoFocus />
              <datalist id={listId}>{(vendors.data ?? []).map((v) => <option key={v.id} value={v.name} />)}</datalist>
              <Button size="sm" loading={busy} disabled={!picked} onClick={() => void answer(`Filed to ${picked!.name}`, 'vendor', picked!.id)} leftIcon={<Check className="size-4" aria-hidden="true" />}>This vendor</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          ) : mode === 'rep' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={repId} onChange={(e) => setRepId(e.target.value)} aria-label="Rep group" className="h-9 sm:w-72">
                <option value="">{reps.isLoading ? 'Loading rep groups…' : 'Which rep group?'}</option>
                {(reps.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <Button size="sm" loading={busy} disabled={!repId} onClick={() => void answer('Rep group set; each email filed by the vendor it names', 'rep_group', undefined, repId)} leftIcon={<Check className="size-4" aria-hidden="true" />}>This rep group</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.proposed_vendor_id ? (
                <Button size="sm" loading={busy} onClick={() => void answer(`Filed to ${d.proposed_vendor_name}`, 'vendor', d.proposed_vendor_id!)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Yes, {d.proposed_vendor_name}</Button>
              ) : null}
              <Button size="sm" variant={d.proposed_vendor_id ? 'secondary' : 'primary'} disabled={busy} onClick={() => setMode('vendor')}>{d.proposed_vendor_id ? 'Another vendor' : 'Pick the vendor'}</Button>
              <Link to={newVendorFromMailUrl(ROUTES.vendors, { senderKey: d.sender_key, isDomain: d.is_domain, displayName: d.display_name, senderId: d.sender_id })}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50">
                <Building2 className="size-4" aria-hidden="true" /> New vendor
              </Link>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode('rep')} leftIcon={<Users className="size-4" aria-hidden="true" />}>A rep group</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void answer('Each email will be filed by the vendor it names', 'platform')} leftIcon={<Layers className="size-4" aria-hidden="true" />} title="NetSuite, Bill.com, FashionGo and similar services that send mail for many vendors">Sends for many vendors</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('Not a vendor', 'not_vendor')} leftIcon={<Ban className="size-4" aria-hidden="true" />}>Not a vendor</Button>
            </div>
          )}
        </div>
      ) : null}
    </>
  )
}
