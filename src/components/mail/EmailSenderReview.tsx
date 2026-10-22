import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Layers, Megaphone, MessageCircleQuestion, Truck, UserRound, Users, X } from 'lucide-react'
import { getSenderCompany, resolveEmailSender, resolveSenderMany } from '@/services/mail'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { errorMessage } from '@/lib/utils'
import { newVendorPrefill } from '@/lib/mail'
import type { ReviewItem } from '@/types'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { RepGroupPicker } from '@/components/rep-groups/RepGroupPicker'
import { CarrierPicker } from '@/components/freight/CarrierPicker'
import { SenderEmailsPanel } from '@/components/mail/SenderEmailsPanel'
import { setSenderCarrier } from '@/services/freight'
import { Button } from '@/components/ui'
import { NewRepGroupFromMail } from '@/components/mail/NewRepGroupFromMail'
import type { NamedVendor, RepPerson } from '@/services/repAgency'

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
  /** Every vendor the sender's mail names, most named first (Dana, Oct 21). */
  named_vendors?: NamedVendor[]
  /** What Claude read from signatures and footers: the company, its website and phone, the reps who wrote. */
  company?: string | null
  website?: string | null
  phone?: string | null
  rep_contacts?: RepPerson[]
}

/**
 * "Mail from @wfsports.com looks like World Famous Sports": confirm it, or pick the rep group and the vendors they write
 * about together and Save (Oct 20), say it is a service that sends for many vendors (each email then matched by the vendor
 * it names), or not a vendor at all. One answer covers every email from that sender, now and later.
 */
/** Claude's note says a rep or rep agency ("Rep agency selling Daiwa…", "Independent rep for…", "Toy rep…"). */
const REP_NOTE = /\b(rep agency|rep group|sales rep|independent (sales )?rep|manufacturer'?s? rep|toy rep|rep for|rep sending|rep covering|repping)\b/i

const AI_KIND_LABELS = { vendor: 'a vendor', rep_group: 'a rep group', platform: 'an order system or service that sends for many vendors', not_vendor: 'not a vendor', unsure: 'not sure' } as const

export function EmailSenderReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = item.details as unknown as EmailSenderDetails
  const [mode, setMode] = useState<'idle' | 'pick' | 'carrier' | 'newgroup'>('idle')
  const named = d.named_vendors ?? []
  /** Pick everything that applies, then Save (Dana, Oct 20): a rep group and the vendors they write about. */
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [newGroup, setNewGroup] = useState(false)
  const company = useSupabaseQuery(() => getSenderCompany(d.sender_id), [d.sender_id])
  // a rep agency Claude found that isn't in VMS yet (Anthony & Associates, Maschmedt…): offered as a new rep group
  const agencyName = d.company ?? company.data ?? null
  const service = d.ai_kind === 'platform'
  // mail that names two or more of our vendors often is a rep or a service (Toyology: Thin Air, Blokees, Schylling…)
  const namesSeveral = named.filter((v) => v.n >= 2).length >= 2
  const repAgency = !!agencyName && (d.ai_kind === 'rep_group' || REP_NOTE.test(d.ai_note ?? '') || (namesSeveral && !service))
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

  function startPick(withNewGroup = false) {
    // the guess, else every vendor their mail names more than once
    setVendors(d.proposed_vendor_id && d.proposed_vendor_name ? [{ id: d.proposed_vendor_id, name: d.proposed_vendor_name }] : named.filter((v) => v.n >= 2).map((v) => ({ id: v.id, name: v.name })))
    setRepId('')
    setNewGroup(withNewGroup)
    setMode('pick')
  }

  async function saveMany() {
    setBusy(true)
    try {
      const r = await resolveSenderMany(d.sender_id, repId || null, vendors.map((v) => v.id))
      const parts = [
        r.linked ? `${r.linked} email${r.linked === 1 ? '' : 's'} filed` : null,
        r.lines_added.length ? `lines added: ${r.lines_added.join(', ')}` : null,
        r.kept_with_other_group.length ? `kept with their own rep group: ${r.kept_with_other_group.join(', ')}` : null,
      ].filter(Boolean)
      toast.success(`Saved${parts.length ? `: ${parts.join('; ')}` : ''}`, { duration: 6000 })
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function answer(label: string, kind: 'vendor' | 'rep_group' | 'platform' | 'marketing' | 'not_vendor' | 'internal', vendorId?: string, repGroupId?: string) {
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
      {named.length ? (
        <p className="mt-1 text-xs text-stone-700">
          <span className="font-semibold">Their mail names:</span> {named.map((v) => `${v.name} (${v.n})`).join(', ')}
        </p>
      ) : null}
      {d.ai_kind && d.ai_kind !== 'unsure' && !(d.ai_kind === 'vendor' && d.proposed_vendor_id) ? (
        <p className="mt-1 text-xs text-sky-800">
          <span className="font-semibold">Claude read the mail:</span> {AI_KIND_LABELS[d.ai_kind]}{d.ai_note ? ` · ${d.ai_note}` : ''}
        </p>
      ) : null}
      {canEdit ? (
        <div className="mt-3 border-t border-amber-200 pt-3">
          {mode === 'newgroup' ? (
            <NewRepGroupFromMail senderId={d.sender_id} company={agencyName ?? ''} website={d.website ?? null} phone={d.phone ?? null}
              people={d.rep_contacts ?? []} named={named} onDone={onDone} onCancel={() => setMode('idle')} />
          ) : mode === 'pick' ? (
            <div className="space-y-3">
              <p className="text-xs text-stone-600">A rep? Pick their rep group and the lines they write about. A company's own staff? Pick just that vendor. Then click <strong>Save</strong>.</p>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-700">Rep group (if they're a rep)</span>
                <RepGroupPicker value={repId} onChange={(id) => setRepId(id)} startAdding={newGroup} emptyLabel="Not a rep" prefill={{ name: company.data ?? (d.is_domain ? prefill.name : ''), repName: d.display_name ?? '', email: d.is_domain ? '' : d.sender_key }} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-700">{repId ? 'Lines they write about' : 'Vendor'}</span>
                {vendors.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {vendors.map((v) => (
                      <li key={v.id} className="inline-flex items-center gap-1 rounded-full bg-white py-1 pl-2.5 pr-1 text-xs text-stone-800 ring-1 ring-stone-200">
                        {v.name}
                        <button type="button" onClick={() => setVendors((x) => x.filter((y) => y.id !== v.id))} aria-label={`Remove ${v.name}`} className="rounded-full p-0.5 hover:bg-stone-100"><X className="size-3.5" aria-hidden="true" /></button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <VendorPicker className="sm:w-72" prefill={prefill} placeholder={vendors.length ? 'Add another vendor' : 'Type a vendor name'} onPick={(v) => setVendors((x) => (x.some((y) => y.id === v.id) ? x : [...x, { id: v.id, name: v.name }]))} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={busy} disabled={!repId && !vendors.length} onClick={() => void saveMany()} leftIcon={<Check className="size-4" aria-hidden="true" />}>Save</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('idle')}>Cancel</Button>
              </div>
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
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.proposed_vendor_id ? (
                <Button size="sm" loading={busy} onClick={() => void answer(`Filed to ${d.proposed_vendor_name}`, 'vendor', d.proposed_vendor_id!)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Yes, {d.proposed_vendor_name}</Button>
              ) : null}
              {repAgency ? (
                <Button size="sm" disabled={busy} onClick={() => setMode('newgroup')} leftIcon={<Users className="size-4" aria-hidden="true" />} title="Claude read their mail as a rep agency that isn't in VMS yet">New rep group: {agencyName}</Button>
              ) : null}
              <Button size="sm" variant={d.proposed_vendor_id || repAgency || service ? 'secondary' : 'primary'} disabled={busy} onClick={() => startPick()} leftIcon={<Users className="size-4" aria-hidden="true" />}>Pick rep group / vendors</Button>
              <Button size="sm" variant={service && !d.proposed_vendor_id ? 'primary' : 'secondary'} loading={busy} onClick={() => void answer('Each email will be filed by the vendor it names', 'platform')} leftIcon={<Layers className="size-4" aria-hidden="true" />} title="MarketTime, NuORDER, Faire, Bill.com and similar order systems and services that send mail for many vendors">A service for many vendors (MarketTime, Faire, Bill.com)</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode('carrier')} leftIcon={<Truck className="size-4" aria-hidden="true" />}>A freight carrier</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void answer('Marketing: their mail goes to Promotions', 'marketing')} leftIcon={<Megaphone className="size-4" aria-hidden="true" />} title="Ads from a company we have never bought from">Marketing</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void answer('Our staff: supply requests in their mail go to Supplies', 'internal')} leftIcon={<UserRound className="size-4" aria-hidden="true" />} title="Someone who works for us, writing from their own address">Our staff</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer('Other: their mail stays in Primary for you (their ads go to Promotions)', 'not_vendor')} leftIcon={<MessageCircleQuestion className="size-4" aria-hidden="true" />} title="Not a vendor, not ads: someone who may need an answer">Other – not a vendor</Button>
            </div>
          )}
        </div>
      ) : null}
      {reading ? <SenderEmailsPanel senderId={d.sender_id} senderLabel={d.display_name || d.sender_key} prefill={prefill} canEdit={canEdit} onClose={() => setReading(false)} onChanged={onDone} /> : null}
    </>
  )
}
