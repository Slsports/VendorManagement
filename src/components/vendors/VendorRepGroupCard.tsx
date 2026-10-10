import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listRepGroupSiblings } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import type { RepGroup, RepGroupContact } from '@/types'

/** The vendor's rep group with contact details and what else that rep carries. */
export function VendorRepGroupCard({ vendorId, group }: { vendorId: string; group: (RepGroup & { rep_group_contacts?: RepGroupContact[] }) | null }) {
  const q = useSupabaseQuery(async () => (group ? listRepGroupSiblings(group.id, vendorId) : { vendors: [], lines: [] }), [group?.id, vendorId])
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Rep group</h2>
      {!group ? (
        <p className="mt-3 text-sm text-stone-500">None on file. Set it on the edit page, or it fills in from a rep's line list.</p>
      ) : (
        <>
          <Link to={`${ROUTES.repGroups}/${group.id}`} className="mt-2 inline-flex items-center gap-1.5 font-medium text-stone-900 hover:text-brand"><Users className="size-4" aria-hidden="true" />{group.name}</Link>
          <p className="text-sm text-stone-600">{[(group.rep_group_contacts ?? []).map((c) => c.name || c.email).filter(Boolean).join(', '), group.phone].filter(Boolean).join(' · ')}</p>
          {q.data && (q.data.vendors.length || q.data.lines.length) ? (
            <div className="mt-3 text-sm">
              <p className="text-xs font-medium text-stone-500">Also reps</p>
              <p className="text-stone-700">
                {q.data.vendors.slice(0, 8).map((v, i) => <span key={v.id}>{i ? ', ' : ''}<Link to={`${ROUTES.vendors}/${v.id}`} className="hover:text-brand hover:underline">{v.name}</Link></span>)}
                {q.data.vendors.length > 8 ? ` and ${q.data.vendors.length - 8} more` : ''}
                {q.data.lines.length ? <span className="text-stone-500">{q.data.vendors.length ? ' · ' : ''}{q.data.lines.length} other line{q.data.lines.length === 1 ? '' : 's'} with catalogs</span> : null}
              </p>
              <Link to={`${ROUTES.repGroups}/${group.id}`} className="mt-1 inline-block text-xs text-brand hover:underline">See everything they carry</Link>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
