import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui'
import { ComingSoon } from '@/components/shared/ComingSoon'
import { SortHeader } from '@/components/shared/SortHeader'
import { useTableSort } from '@/hooks/useTableSort'

export default function StoreSettings() {
  const { stores } = useAuth()
  const { sorted, sort, toggle } = useTableSort(stores, {
    code: (s) => s.code,
    name: (s) => s.name,
    aliases: (s) => s.aliases.join(', '),
    location: (s) => [s.city, s.state].filter(Boolean).join(', '),
    status: (s) => (s.is_active ? 'Active' : 'Inactive'),
  })
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
            <tr>
              <SortHeader label="Code" sortKey="code" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Aliases" sortKey="aliases" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Location" sortKey="location" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sorted.map((s) => (
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
