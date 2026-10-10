import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { allowVendorName, listVendorExclusions } from '@/services/vendors'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui'

/** Names deleted from the review queue as "not a vendor". Allowing one lets it be added or imported again. */
export function DeletedVendorNames({ organizationId }: { organizationId: string }) {
  const q = useSupabaseQuery(() => listVendorExclusions(organizationId), [organizationId])
  const rows = q.data ?? []
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Deleted as not a vendor</h2>
      <p className="mt-1 text-sm text-stone-600">Imports skip these names. Allow one again if it was deleted by mistake.</p>
      {rows.length === 0 ? <p className="mt-3 text-sm text-stone-500">{q.isLoading ? 'Loading…' : 'None yet.'}</p> : (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {rows.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-stone-800">{x.name}<span className="ml-2 text-xs text-stone-400">{new Date(x.created_at).toLocaleDateString()}</span></span>
              <Button size="sm" variant="ghost" onClick={async () => {
                try { await allowVendorName(x.id); toast.success(`${x.name} allowed again`); await q.refetch() } catch (err) { toast.error(errorMessage(err)) }
              }}>Allow again</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
