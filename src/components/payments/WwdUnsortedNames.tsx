import { useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronRight, Truck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { assignWwdName, assignWwdNameCarrier, countWwdNoVendor, listWwdFreightNoVendor, listWwdInvoicesByName, listWwdUnsorted, updateWwdInvoice } from '@/services/wwd'
import { listCarriers } from '@/services/freight'
import { money, shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { WwdInvoiceTable } from '@/components/payments/WwdInvoiceTable'
import { Button, Select, Spinner } from '@/components/ui'

type Picking = { name: string; as: 'vendor' | 'carrier' } | null

/** One WWD spelling's invoices, loaded when the name is opened. */
function NameInvoices({ name }: { name: string }) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listWwdInvoicesByName(organization.id, name) : []), [organization?.id, name])
  if (q.isLoading) return <Spinner label="Loading invoices…" className="text-brand" />
  if (q.error) return <p className="text-sm text-red-700">{q.error}</p>
  return <WwdInvoiceTable rows={q.data ?? []} />
}

/**
 * WWD vendor names VMS could not place. Click a name to see its invoices. Pick the vendor once (or the freight
 * company, for XPO and the like) and every invoice with that name follows; VMS keeps the name. Freight lines
 * then each need the vendor whose goods were carried, listed below unless the delivery receipt said so.
 * Invoices WWD never named (old payments with no sheet) are counted, not listed.
 */
export function WwdUnsortedNames({ refreshKey }: { refreshKey: number }) {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listWwdUnsorted(organization.id) : []), [organization?.id, refreshKey])
  const none = useSupabaseQuery(async () => (organization ? countWwdNoVendor(organization.id) : 0), [organization?.id, refreshKey])
  const freight = useSupabaseQuery(async () => (organization ? listWwdFreightNoVendor(organization.id) : []), [organization?.id, refreshKey])
  const carriers = useSupabaseQuery(async () => (organization ? listCarriers(organization.id) : []), [organization?.id])
  const [open, setOpen] = useState<string | null>(null)
  const [picking, setPicking] = useState<Picking>(null)
  const [lineVendor, setLineVendor] = useState<string | null>(null)
  const rows = q.data ?? []
  const lines = freight.data ?? []
  const nameless = (none.data ?? 0) - rows.reduce((s, r) => s + r.count, 0)
  if (!rows.length && !lines.length && nameless <= 0) return null
  const refresh = () => Promise.all([q.refetch(), none.refetch(), freight.refetch()])

  async function pickVendor(name: string, vendorId: string, vendorName: string) {
    setPicking(null)
    try {
      const n = await assignWwdName(name, vendorId)
      toast.success(`${n} invoice${n === 1 ? '' : 's'} moved to ${vendorName}`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function pickCarrier(name: string, carrierId: string) {
    setPicking(null)
    try {
      const n = await assignWwdNameCarrier(name, carrierId)
      const c = (carriers.data ?? []).find((x) => x.id === carrierId)
      toast.success(`${n} invoice${n === 1 ? '' : 's'} filed as freight to ${c?.name ?? 'the freight company'}. Pick the vendor for each below.`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function tieLine(id: string, vendorId: string, vendorName: string) {
    setLineVendor(null)
    try {
      await updateWwdInvoice(id, { vendorId })
      toast.success(`Freight tied to ${vendorName}`)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-amber-200 bg-white p-4">
      {rows.length ? (
        <>
          <h2 className="text-sm font-semibold text-stone-900">WWD names to match ({rows.length})</h2>
          <p className="text-sm text-stone-600">Click a name to see its invoices. Pick the vendor (or the freight company, for XPO and other trucking companies) once; every invoice with that name follows, and VMS remembers the name.</p>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {rows.map((r) => {
              const isOpen = open === r.name
              const Chevron = isOpen ? ChevronDown : ChevronRight
              return (
                <li key={r.name} className="py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="flex min-w-0 items-center gap-1 text-left hover:text-brand" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.name)}>
                      <Chevron className="size-4 shrink-0 text-stone-400" aria-hidden="true" />
                      <span><span className="font-medium text-stone-900">{r.name}</span><span className="text-stone-500"> · {r.count} invoice{r.count === 1 ? '' : 's'} · {money(r.total)} · last {shortDate(r.latest)}</span></span>
                    </button>
                    {canEdit ? (picking?.name === r.name ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {picking.as === 'vendor' ? (
                          <VendorPicker autoFocus className="w-60" placeholder="Which vendor is this?" onPick={(v) => pickVendor(r.name, v.id, v.name)} />
                        ) : (
                          <Select aria-label={`Freight company for ${r.name}`} className="h-9 w-60" defaultValue="" onChange={(e) => { if (e.target.value) void pickCarrier(r.name, e.target.value) }}>
                            <option value="">Which freight company?</option>
                            {(carriers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </Select>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <span className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setPicking({ name: r.name, as: 'vendor' })}>Pick vendor</Button>
                        <Button size="sm" variant="ghost" leftIcon={<Truck className="size-4" aria-hidden="true" />} onClick={() => setPicking({ name: r.name, as: 'carrier' })}>Freight company</Button>
                      </span>
                    )) : null}
                  </div>
                  {isOpen ? <div className="mt-2 rounded-xl bg-stone-50 p-3"><NameInvoices name={r.name} /></div> : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}

      {lines.length ? (
        <div className={rows.length ? 'mt-4 border-t border-stone-100 pt-3' : ''}>
          <h2 className="text-sm font-semibold text-stone-900">Freight to tie to a vendor ({lines.length})</h2>
          <p className="text-sm text-stone-600">Freight paid through WWD (XPO and the like). Pick whose goods each shipment carried, so it counts in that vendor's freight.</p>
          <div className="mt-2">
            <WwdInvoiceTable rows={lines} showVendor action={(i) => canEdit ? (lineVendor === i.id ? (
              <span className="flex items-center justify-end gap-1">
                <VendorPicker autoFocus className="w-52" placeholder="Shipped for…" onPick={(v) => tieLine(i.id, v.id, v.name)} />
                <Button size="sm" variant="ghost" onClick={() => setLineVendor(null)}>Cancel</Button>
              </span>
            ) : <Button size="sm" variant="secondary" onClick={() => setLineVendor(i.id)}>Pick vendor</Button>) : null} />
          </div>
        </div>
      ) : null}
      {nameless > 0 ? <p className="mt-2 text-xs text-stone-500">{nameless} older WWD invoices have no vendor name anywhere (paid before your payment sheets start). They stay on file by WWD number and payment.</p> : null}
    </section>
  )
}
