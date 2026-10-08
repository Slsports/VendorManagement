import { DeletedVendorNames } from '@/components/vendors/DeletedVendorNames'
import { useAuth } from '@/hooks/useAuth'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function OrganizationSettings() {
  const { organization } = useAuth()
  if (!organization) return null
  const rows: [string, string][] = [
    ['Name', organization.name],
    ['Legal name', organization.legal_name ?? '—'],
    ['App name', organization.app_name ?? '—'],
    ['Slug', organization.slug],
    ['Accent color', organization.accent_color],
    ['Timezone', String((organization.settings as { timezone?: string } | null)?.timezone ?? '—')],
  ]
  return (
    <div className="space-y-6">
      <dl className="grid gap-px overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="bg-white px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{k}</dt>
            <dd className="mt-0.5 flex items-center gap-2 text-sm text-stone-900">
              {k === 'Accent color' ? <span className="inline-block size-4 rounded-full border border-stone-200" style={{ background: v }} aria-hidden="true" /> : null}
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <DeletedVendorNames organizationId={organization.id} />
      <ComingSoon phase={6} title="Editing arrives with Settings">Name, legal name, timezone and defaults become editable here.</ComingSoon>
    </div>
  )
}
