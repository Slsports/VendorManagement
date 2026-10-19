import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Mail, Trash2, UserX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { ROUTES } from '@/lib/constants'
import { portalUnconfirmed } from '@/lib/contacts'
import { mailWithUrl } from '@/lib/mail'
import { phonesOf } from '@/lib/phones'
import { errorMessage } from '@/lib/utils'
import { setVendorContact } from '@/services/vendors'
import type { ReviewItem, VendorEmail } from '@/types'
import { Button, Spinner } from '@/components/ui'
import { PhoneLinks } from '@/components/shared/Phones'

interface Details { vendor_id?: string; vendor_name?: string }
const monthYear = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/**
 * People only the WWD portal lists for a vendor, with no email from us about that vendor in 24 months (the five contact
 * rules, Dana Oct 19). Keep them, mark them no longer their rep (kept under Former contacts), or delete a mistake. The
 * card closes when everyone is answered.
 */
export function PortalContactReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const load = async () => {
    const { data, error } = await supabase.from('vendor_emails').select('*').eq('vendor_id', d.vendor_id ?? item.entity_id ?? '').eq('source', 'wwd_portal').order('contact_name')
    if (error) throw error
    return (data ?? []).filter((c) => portalUnconfirmed(c))
  }
  const q = useSupabaseQuery(load, [item.id])
  const [busy, setBusy] = useState<string | null>(null)

  async function answer(c: VendorEmail, action: 'keep' | 'former' | 'delete') {
    if (action === 'delete' && !window.confirm(`Delete ${c.contact_name || c.email}?\n\nOnly for a mistake (never this vendor's contact). Someone who has left goes under "No longer their rep", so their old emails can still be found.`)) return
    setBusy(c.id)
    try {
      await setVendorContact(c.id, action)
      toast.success(action === 'keep' ? 'Kept' : action === 'former' ? 'Moved to Former contacts' : 'Deleted')
      // the last one answered closes the card
      if (!(await load()).length) await onDone()
      else await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (q.isLoading) return <div className="py-3"><Spinner label="Loading…" /></div>
  const people = q.data ?? []
  return (
    <div className="mt-2 space-y-2">
      <p className="text-stone-700">
        {d.vendor_id ? <Link to={`${ROUTES.vendors}/${d.vendor_id}`} className="font-medium text-brand hover:underline">{d.vendor_name}</Link> : d.vendor_name}
        {' '}· the WWD portal lists {people.length === 1 ? 'this person' : 'these people'}, but we haven't emailed them about {d.vendor_name ?? 'this vendor'} in 24 months.
      </p>
      {people.length === 0 ? <p className="text-stone-500">All answered.</p> : (
        <ul className="divide-y divide-amber-200 rounded-lg bg-white px-3 ring-1 ring-amber-200">
          {people.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-stone-900">{c.contact_name || c.email}{c.title ? <span className="ml-2 text-xs font-normal text-stone-500">{c.title}</span> : null}</p>
                <p className="flex flex-wrap gap-x-4 text-stone-600">
                  {c.email ? <Link to={mailWithUrl(ROUTES.mailWith, c.email)} className="inline-flex items-center gap-1 hover:text-brand" title="All mail with them"><Mail className="size-3.5" aria-hidden="true" />{c.email}</Link> : null}
                  <PhoneLinks phones={phonesOf(c)} />
                </p>
                <p className="text-xs text-stone-500">
                  {c.last_vendor_mail_at ? `Last email about ${d.vendor_name ?? 'this vendor'}: ${monthYear(c.last_vendor_mail_at)}` : c.last_mail_at ? `Never about ${d.vendor_name ?? 'this vendor'}; last email with them ${monthYear(c.last_mail_at)} (another vendor)` : 'No email with them on file'}
                  {c.notes ? ` · ${c.notes}` : ''}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" loading={busy === c.id} onClick={() => void answer(c, 'keep')} leftIcon={<Check className="size-3.5" aria-hidden="true" />}>Keep</Button>
                  <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => void answer(c, 'former')} leftIcon={<UserX className="size-3.5" aria-hidden="true" />}>No longer their rep</Button>
                  <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void answer(c, 'delete')} className="text-red-700 hover:bg-red-50" leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}>Delete</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
