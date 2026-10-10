import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { createRepGroup, listRepGroupsWithCounts } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortPicker } from '@/components/shared/SortHeader'
import { useTableSort } from '@/hooks/useTableSort'
import { Alert, Button, FormField, Input, Spinner } from '@/components/ui'

export default function RepGroupListPage() {
  const { role, organization } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listRepGroupsWithCounts(organization.id) : []), [organization?.id])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const { sorted: groups, sort, setSort } = useTableSort(q.data ?? [], {
    name: (g) => g.name,
    contact: (g) => g.contact_name,
    vendors: (g) => g.vendor_count,
    lines: (g) => Math.max(0, g.line_count - g.vendor_count),
  }, { descFirst: ['vendors', 'lines'] })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!organization || !name.trim()) return
    setSaving(true)
    try {
      await createRepGroup({ organization_id: organization.id, name: name.trim() })
      setName('')
      setAdding(false)
      toast.success('Rep group added')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading rep groups…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>

  return (
    <div>
      <PageHeader
        title="Rep groups"
        description="Who reps what. Each group lists the vendors you buy from and the other lines they carry."
        actions={canEdit && !adding ? <Button onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add rep group</Button> : undefined}
      />
      {adding ? (
        <form onSubmit={submit} className="mb-4 flex flex-col gap-3 rounded-xl bg-stone-50 p-4 sm:flex-row sm:items-end">
          <FormField label="Rep group name" htmlFor="rg-name" className="flex-1"><Input id="rg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. JRA Sales" required /></FormField>
          <div className="flex gap-2">
            <Button type="submit" loading={saving}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {groups.length > 1 ? (
        <div className="mb-3 flex justify-end">
          <SortPicker sort={sort} onChange={setSort} options={[{ key: 'name', label: 'Name' }, { key: 'contact', label: 'Contact' }, { key: 'vendors', label: 'Vendors' }, { key: 'lines', label: 'Other lines' }]} />
        </div>
      ) : null}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
          <Users className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">No rep groups yet. They come from rep line lists and the vendor form.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`${ROUTES.repGroups}/${g.id}`} className="block h-full rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand hover:shadow">
                <p className="font-semibold text-stone-900">{g.name}</p>
                <p className="mt-0.5 text-sm text-stone-600">{[g.contact_name, g.phone, g.email].filter(Boolean).join(' · ') || 'No contact on file'}</p>
                <p className="mt-2 text-xs text-stone-500">{g.vendor_count} vendor{g.vendor_count === 1 ? '' : 's'} · {Math.max(0, g.line_count - g.vendor_count)} other line{g.line_count - g.vendor_count === 1 ? '' : 's'}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
