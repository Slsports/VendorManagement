import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Store } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listNeverBought, neverBoughtIsVendor, neverBoughtLeave, neverBoughtMakeVendor, type NeverBoughtRow } from '@/services/neverBought'
import { ROUTES } from '@/lib/constants'
import { mailWithUrl } from '@/lib/mail'
import { cn, errorMessage } from '@/lib/utils'
import { SortHeader } from '@/components/shared/SortHeader'
import { Modal } from '@/components/shared/Modal'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { SenderEmailsPanel } from '@/components/mail/SenderEmailsPanel'
import { Alert, Button, FormField, Input, Select, Spinner } from '@/components/ui'

type Show = 'to_check' | 'checked' | 'all'
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '')
const site = (w: string | null) => (w ? (/^https?:\/\//i.test(w) ? w : `https://${w}`) : null)

/**
 * Review queue › Never bought from (Dana, Oct 12): companies Claude thinks we have never bought from, one row per
 * company, to look over now and then. Their mail always goes to Promotions.
 */
export function NeverBoughtList({ canEdit }: { canEdit: boolean }) {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (organization ? listNeverBought(organization.id) : []), [organization?.id])
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('to_check')
  const [picking, setPicking] = useState<NeverBoughtRow | null>(null)
  const [making, setMaking] = useState<NeverBoughtRow | null>(null)
  // the emails behind a row, one click (Dana, Oct 21); open in the address (?emails=<sender>) so Back returns to it
  const [params, setParams] = useSearchParams()
  const readingId = params.get('emails')
  const setReading = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('emails', id)
    else next.delete('emails')
    setParams(next, { replace: true })
  }

  const all = q.data ?? []
  const s = search.trim().toLowerCase()
  const rows = all.filter((r) => (show === 'all' ? true : show === 'checked' ? !!r.checked_at : !r.checked_at))
    .filter((r) => !s || [r.company, r.website, r.phone, ...r.addresses].some((x) => x?.toLowerCase().includes(s)))
  const { sorted, sort, toggle } = useTableSort(rows, {
    company: (r) => r.company,
    emails: (r) => r.email_count,
    latest: (r) => r.latest_at,
  }, { param: 'nb_sort', descFirst: ['emails', 'latest'] })

  async function act(p: Promise<unknown>, msg: string) {
    try { await p; toast.success(msg); await q.refetch() } catch (e) { toast.error(errorMessage(e)) }
  }

  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const toCheck = all.filter((r) => !r.checked_at).length
  const reading = readingId ? all.find((r) => r.sender_ids.includes(readingId)) : null

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, website, phone" aria-label="Search" className="h-9 w-72 max-w-full" />
        <Select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Which companies" className="h-9 w-48">
          <option value="to_check">To check ({toCheck})</option>
          <option value="checked">Checked ({all.length - toCheck})</option>
          <option value="all">All ({all.length})</option>
        </Select>
      </div>
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-12 text-center">
          <Store className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">{all.length ? 'Nothing here.' : 'No companies yet. Claude adds them as it sorts the mail.'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <SortHeader label="Company" sortKey="company" sort={sort} onSort={toggle} className="px-3 py-2" />
                <th scope="col" className="px-3 py-2">Email addresses</th>
                <th scope="col" className="px-3 py-2">Website · phone</th>
                <SortHeader label="Emails" sortKey="emails" sort={sort} onSort={toggle} className="px-3 py-2" />
                <SortHeader label="Latest" sortKey="latest" sort={sort} onSort={toggle} className="px-3 py-2" />
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((r) => (
                <tr key={r.sender_ids.join()} className={cn('align-top', r.checked_at && 'text-stone-500')}>
                  <td className="min-w-40 px-3 py-2">
                    <span className="font-medium text-stone-900">{r.company}</span>
                    {r.note ? <span className="mt-0.5 block text-xs text-stone-500">{r.note}</span> : null}
                    {r.checked_at ? <span className="mt-0.5 block text-xs text-stone-500">Checked {day(r.checked_at)}{r.checked_by ? ` by ${r.checked_by.split(' ')[0]}` : ''}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">{r.addresses.slice(0, 4).map((a) => <Link key={a} to={mailWithUrl(ROUTES.mailWith, a)} className="block hover:text-brand hover:underline" title="All mail with them">{a}</Link>)}{r.addresses.length > 4 ? <span className="block">and {r.addresses.length - 4} more</span> : null}</td>
                  <td className="px-3 py-2 text-xs text-stone-600">
                    {r.website ? <a href={site(r.website)!} target="_blank" rel="noreferrer" className="block text-brand hover:underline">{r.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}</a> : null}
                    {r.phone ? <span className="block whitespace-nowrap">{r.phone}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-stone-700">
                    {r.sender_ids.length === 1
                      ? <button type="button" onClick={() => setReading(r.sender_ids[0])} className="font-medium text-brand hover:underline" title="See the emails">{r.email_count}</button>
                      : <span title="From several senders: click an address to see its mail">{r.email_count}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{day(r.latest_at)}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <span className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setPicking(r)}>This is…</Button>
                        <Button size="sm" variant="ghost" onClick={() => setMaking(r)}>Make it a vendor</Button>
                        {r.checked_at
                          ? <Button size="sm" variant="ghost" onClick={() => void act(neverBoughtLeave(r.sender_ids, false), 'Back on the list to check')}>Check again</Button>
                          : <Button size="sm" variant="ghost" onClick={() => void act(neverBoughtLeave(r.sender_ids), `${r.company}: left as never bought from`)}>Leave it</Button>}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picking ? (
        <Modal title={`${picking.company} is…`} submitLabel="Close" onSubmit={() => setPicking(null)} onClose={() => setPicking(null)}>
          <p className="mb-3 text-sm text-stone-600">Pick the vendor. Their mail is filed there from now on, and "{picking.company}" is kept as another name for the vendor.</p>
          <VendorPicker autoFocus prefill={{ name: picking.company, website: picking.website ?? undefined, email: picking.addresses[0] }}
            onPick={async (v) => { const row = picking; setPicking(null); await act(neverBoughtIsVendor(row.sender_ids, v.id), `${row.company}: mail filed to ${v.name}`) }} />
        </Modal>
      ) : null}
      {reading && readingId ? <SenderEmailsPanel senderId={readingId} senderLabel={reading.company} canEdit={canEdit} onClose={() => setReading(null)} onChanged={() => q.refetch()} /> : null}
      {making ? <MakeVendorDialog row={making} onClose={() => setMaking(null)} onMade={(id) => { setMaking(null); navigate(`${ROUTES.vendors}/${id}`) }} /> : null}
    </div>
  )
}

function MakeVendorDialog({ row, onClose, onMade }: { row: NeverBoughtRow; onClose: () => void; onMade: (vendorId: string) => void }) {
  const [name, setName] = useState(row.company)
  const [website, setWebsite] = useState(row.website ?? '')
  const [phone, setPhone] = useState(row.phone ?? '')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const id = await neverBoughtMakeVendor(row.sender_ids, name, website || null, phone || null)
      toast.success(`${name} added as a vendor; their mail is filed there`)
      onMade(id)
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="Make it a vendor" submitLabel="Add vendor" busy={busy} onSubmit={save} onClose={onClose}>
      <div className="space-y-3">
        <FormField label="Vendor name" htmlFor="nb-name"><Input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} required /></FormField>
        <FormField label="Website" htmlFor="nb-website"><Input id="nb-website" value={website} onChange={(e) => setWebsite(e.target.value)} /></FormField>
        <FormField label="Phone" htmlFor="nb-phone"><Input id="nb-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></FormField>
        <p className="text-xs text-stone-500">The vendor page opens next, to fill in the rest.</p>
      </div>
    </Modal>
  )
}
