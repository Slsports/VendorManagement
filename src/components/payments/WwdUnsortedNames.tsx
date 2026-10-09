import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { assignWwdName, countWwdNoVendor, listWwdUnsorted } from '@/services/wwd'
import { money, shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { Button } from '@/components/ui'

/**
 * WWD vendor names VMS could not place. Picking the vendor once moves every invoice with that name and keeps
 * the name as an alias, so the next import places it on its own. Invoices WWD never named (old payments
 * with no sheet) are counted, not listed.
 */
export function WwdUnsortedNames({ refreshKey }: { refreshKey: number }) {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listWwdUnsorted(organization.id) : []), [organization?.id, refreshKey])
  const none = useSupabaseQuery(async () => (organization ? countWwdNoVendor(organization.id) : 0), [organization?.id, refreshKey])
  const [picking, setPicking] = useState<string | null>(null)
  const rows = q.data ?? []
  const nameless = (none.data ?? 0) - rows.reduce((s, r) => s + r.count, 0)
  if (!rows.length && nameless <= 0) return null

  async function pick(name: string, vendorId: string, vendorName: string) {
    setPicking(null)
    try {
      const n = await assignWwdName(name, vendorId)
      toast.success(`${n} invoice${n === 1 ? '' : 's'} moved to ${vendorName}`)
      await Promise.all([q.refetch(), none.refetch()])
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-amber-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-900">WWD names to match ({rows.length})</h2>
      <p className="text-sm text-stone-600">Pick the vendor once; every invoice with that name follows, and VMS remembers the name.</p>
      {rows.length ? (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0"><span className="font-medium text-stone-900">{r.name}</span><span className="text-stone-500"> · {r.count} invoice{r.count === 1 ? '' : 's'} · {money(r.total)} · last {shortDate(r.latest)}</span></span>
              {canEdit ? (picking === r.name ? (
                <span className="flex items-center gap-2">
                  <VendorPicker autoFocus className="w-60" placeholder="Which vendor is this?" onPick={(v) => pick(r.name, v.id, v.name)} />
                  <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>Cancel</Button>
                </span>
              ) : <Button size="sm" variant="secondary" onClick={() => setPicking(r.name)}>Pick vendor</Button>) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {nameless > 0 ? <p className="mt-2 text-xs text-stone-500">{nameless} older WWD invoices have no vendor name anywhere (paid before your payment sheets start). They stay on file by WWD number and payment.</p> : null}
    </section>
  )
}
