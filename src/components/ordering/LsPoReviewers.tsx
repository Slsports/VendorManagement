import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { TEST_LOGIN_PATTERN } from '@/services/reviews'
import { errorMessage } from '@/lib/utils'

/** Settings: who reviews LS POs (Dana, Oct 12: Trevor checks names and categories and sends them to LS). */
export function LsPoReviewers({ organizationId }: { organizationId: string }) {
  const q = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('profiles').select('id, full_name, reviews_ls_pos').eq('organization_id', organizationId).eq('is_active', true)
      .in('role', ['admin', 'manager', 'buyer']).not('email', 'ilike', TEST_LOGIN_PATTERN).order('full_name')
    if (error) throw error
    return data ?? []
  }, [organizationId])
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">LS POs</h2>
      <p className="mt-1 text-sm text-stone-600">Once the person who placed an order approves its LS PO, it goes to the person ticked here to check names and categories and send it to LS. With nobody ticked, it goes to the admin.</p>
      <ul className="mt-3 space-y-2">
        {(q.data ?? []).map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input type="checkbox" className="size-4 accent-brand" checked={p.reviews_ls_pos} onChange={async (e) => {
                const { error } = await supabase.from('profiles').update({ reviews_ls_pos: e.target.checked }).eq('id', p.id)
                if (error) toast.error(errorMessage(error))
                else { toast.success(e.target.checked ? `${p.full_name} reviews LS POs` : `${p.full_name} no longer reviews LS POs`); await q.refetch() }
              }} />
              {p.full_name}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
