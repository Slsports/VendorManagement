import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Layers, Megaphone, MessageCircleQuestion, Truck, Users } from 'lucide-react'
import { resolveEmailSender } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { newVendorPrefill } from '@/lib/mail'
import type { ReviewItem } from '@/types'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { RepGroupPicker } from '@/components/rep-groups/RepGroupPicker'
import { CarrierPicker } from '@/components/freight/CarrierPicker'
import { SenderEmailsPanel } from '@/components/mail/SenderEmailsPanel'
import { setSenderCarrier } from '@/services/freight'
import { Button } from '@/components/ui'

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
  /** What Claude read in the sender's mail, when the mail itself named no vendor. */
  ai_kind?: 'vendor' | 'rep_group' | 'platform' | 'not_vendor' | 'unsure' | null
  ai_note?: string | null
}

/**
 * "Mail from @wfsports.com looks like World Famous Sports": confirm it, pick another vendor, say it is a
 * rep group or a service that sends for many vendors (each email then matched by the vendor it names),
 * or not a vendor at all. One answer covers every email from that sender, now and later.
 */
const AI_KIND_LABELS = { vendor: 'a vendor', rep_group: 'a rep group', platform: 'a service like Bill.com or Faire', not_vendor: 'not a vendor', unsure: 'not sure' } as const

export function EmailSenderReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = item.details as unknown as EmailSenderDetails
  const [mode, setMode] = useState<'idle' | 'vendor' | 'rep' | 'carrier'>('idle')
  const [carrierId, setCarrierId] = useState('')
  // The open panel lives in the address (?emails=<sender>), so Back from an email returns to it.
  const [params, setParams] = useSearchParams()
  const reading = params.get('emails') === d.sender_id
  const setReading = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('emails', d.sender_id)
    else next.delete('emails')
    setParams(next, { replace: true })
  }
  const [busy, setBusy] = useState(false)
  const [repId, setRepId] = useState('')
  const prefill = newVendorPrefill({ senderKey: d.sender_key, isDomain: d.is_domain, displayName: d.display_name })

  async function answer(label: string, kind: 'vendor' | 'rep_group' | 'platform' | 'marketing' | 'not_vendor', vendorId?: string, repGroupId?: string) {
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
        <button type="button" onClick={() => setReading(true)} className="font-medium underline hover:text-amber-950">See the {d.message_count} email{d.message_count === 1 ? '' : 's'}</button>{d.display_name ? ` · from "${d.display_name}"` : ''}{d.proposal_note ? ` · ${d.proposal_note}` : ''}
      </p>
      {d.samples?.length ? <p className="mt-1 truncate text-xs text-amber-700">Recent: {d.samples.join(' · ')}</p> : null}
      {d.ai_kind && d.ai_kind !== 'unsure' && !(d.ai_kind === 'vendor' && d.proposed_vendor_id) ? (
        <p className="mt-1 text-xs text-sky-800">
          <span className="font-semibold">Claude read the mail:</span> {AI_KIND_LABELS[d.ai_kind]}{d.ai_note ? ` · ${d.ai_note}` : ''}
        </p>
      ) : null}
      {canEdit ? (
        <div className="mt-3 border-t border-amber-200 pt-3">
          {mode === 'vendor' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <VendorPicker autoFocus className="sm:w-72" prefill={prefill} onPick={(v) => answer(`Filed to ${v.name}`, 'vendor', v.id)} />
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          ) : mode === 'carrier' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <CarrierPicker value={carrierId} onChange={setCarrierId} prefillName={prefill.name} domain={d.is_domain ? d.sender_key : ''} />
              <Button size="sm" loading={busy} disabled={!carrierId} leftIcon={<Check className="size-4" aria-hidden="true" />} onClick={async () => {
                setBusy(true)
                try {
                  const n = await setSenderCarrier(d.sender_id, carrierId)
                  toast.success(`Freight carrier: ${n} conversation${n === 1 ? '' : 's'} moved to Freight`)
                  await onDone()
                } catch (err) {
                  toast.error(errorMessage(err))
                } finally {
                  setBusy(false)
                }
              }}>This carrier</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          ) : mode === 'rep' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <RepGroupPicker value={repId} onChange={(id) => setRepId(id)} prefill={{ name: d.is_domain ? prefill.name : '', repName: d.display_name ?? '', email: d.is_domain ? '' : d.sender_key }} />
              <Button size="sm" loading={busy} disabled={!repId} onClick={() => void answer('Rep group set; each email filed by the vendor it names', 'rep_group', undefined, repId)} leftIcon={<Check className="size-4" aria-hidden="true" />}>This rep group</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.proposed_vendor_id ? (
                <Button size="sm" loading={busy} onClick={() => void answer(`Filed to ${d.proposed_vendor_name}`, 'vendor', d.proposed_vendor_id!)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Yes, {d.proposed_vendor_name}</Button>
              ) : null}
              <Button size="sm" variant={d.proposed_vendor_id ? 'secondary' : 'primary'} disabled={busy} onClick={() => setMode('vendor')}>{d.proposed_vendor_id ? 'Another vendor' : 'Pick or add the vendor'}</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode('rep')} leftIcon={<Users className="size-4" aria-hidden="true" />}>A rep group</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void answer('Each email will be filed by the vendor it names', 'platform')} leftIcon={<Layers className="size-4" aria-hidden="true" />} title="NetSuite, Bill.com, Faire, FashionGo and similar services that send mail for many vendors">A service like Bill.com or Faire</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode('carrier')} leftIcon={<Truck className="size-4" aria-hidden="true" />}>A freight carrier</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void answer('Marketing: their mail goes to Offers & catalogs', 'marketing')} leftIcon={<Megaphone className="size-4" aria-hidden="true" />} title="Ads from a company we have never bought from">Marketing</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('Other: their mail stays in Needs attention for you', 'not_vendor')} leftIcon={<MessageCircleQuestion className="size-4" aria-hidden="true" />} title="Not a vendor, not ads: someone who may need an answer">Other – not a vendor</Button>
            </div>
          )}
        </div>
      ) : null}
      {reading ? <SenderEmailsPanel senderId={d.sender_id} senderLabel={d.display_name || d.sender_key} prefill={prefill} canEdit={canEdit} onClose={() => setReading(false)} onChanged={onDone} /> : null}
    </>
  )
}
