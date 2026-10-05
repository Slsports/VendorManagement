import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function StoreSettings() {
  const { stores } = useAuth()
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
            <tr>
              <th scope="col" className="px-4 py-2.5">Code</th>
              <th scope="col" className="px-4 py-2.5">Name</th>
              <th scope="col" className="px-4 py-2.5">Aliases</th>
              <th scope="col" className="px-4 py-2.5">Location</th>
              <th scope="col" className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {stores.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-semibold text-stone-900">{s.code}</td>
                <td className="px-4 py-3 text-stone-800">{s.name}</td>
                <td className="px-4 py-3 text-stone-600">{s.aliases.length ? s.aliases.join(', ') : '—'}</td>
                <td className="px-4 py-3 text-stone-600">{[s.city, s.state].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ComingSoon phase={6} title="Editing arrives with Settings">Addresses, phone numbers, check-in mode (digital or paper) and aliases become editable here.</ComingSoon>
    </div>
  )
}
