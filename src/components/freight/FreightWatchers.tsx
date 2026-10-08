import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listFreightWatchers, setSeesFreight } from '@/services/freight'
import { errorMessage } from '@/lib/utils'

/**
 * Settings > Mail: who else sees all freight mail and bills, besides the carrier's owner (Trevor). Dana is
 * on while Trevor is new; switch it off when he has the hang of it.
 */
export function FreightWatchers({ organizationId }: { organizationId: string }) {
  const { profile, refreshProfile } = useAuth()
  const q = useSupabaseQuery(() => listFreightWatchers(organizationId), [organizationId])
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Freight</h2>
      <p className="mt-1 text-sm text-stone-600">Freight mail and bills go to {q.data?.owners.length ? q.data.owners.join(' and ') : 'the carrier owner'}. Anyone ticked here sees all of it too: under Mine in Mail, in Mail for you, and Freight bills on the dashboard.</p>
      <ul className="mt-3 space-y-2">
        {(q.data?.people ?? []).map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input type="checkbox" className="size-4 accent-brand" checked={p.sees_freight} onChange={async (e) => {
                try {
                  await setSeesFreight(p.id, e.target.checked)
                  toast.success(e.target.checked ? `${p.full_name} sees freight` : `${p.full_name} no longer sees freight`)
                  await q.refetch()
                  if (p.id === profile?.id) await refreshProfile()
                } catch (err) {
                  toast.error(errorMessage(err))
                }
              }} />
              {p.full_name}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
