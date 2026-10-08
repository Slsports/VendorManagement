import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Ban, Fish, Plus, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendors } from '@/services/vendors'
import { listOrderers } from '@/services/reviews'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_LABELS, STANDING_BADGE } from '@/lib/vendors'
import { cn } from '@/lib/utils'
import type { BillingRoute } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { useTableSort } from '@/hooks/useTableSort'
import { RouteBadges } from '@/components/vendors/RouteBadges'
import { Alert, Badge, Button, Select, Spinner } from '@/components/ui'

type RouteFilter = '' | BillingRoute | 'none'

export default function VendorListPage() {
  const { role, organization, profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const route = (params.get('route') ?? '') as RouteFilter
  const review = params.get('review') === '1'
  const dno = params.get('dno') === '1'
  const fishing = params.get('fishing') === '1'
  /** '' everyone, 'me', 'none', or a person's id */
  const who = params.get('who') ?? ''
  /** '' active (the default), 'inactive' or 'all' */
  const status = params.get('status') ?? ''
  const [draft, setDraft] = useState(search)

  const { data, error, isLoading } = useSupabaseQuery(() => listVendors({ includeInactive: true }), [])
  const orderersQ = useSupabaseQuery(async () => (organization ? listOrderers(organization.id) : []), [organization?.id])
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const nameOf = (id: string | null) => (id ? (orderersQ.data ?? []).find((p) => p.id === id)?.full_name ?? null : null)

  const rows = useMemo(() => {
    let list = (data ?? []).filter((v) => (status === 'all' ? true : status === 'inactive' ? !v.is_active : v.is_active))
    const s = search.trim().toLowerCase()
    if (s) list = list.filter((v) => v.name.toLowerCase().includes(s) || (v.lightspeed_name ?? '').toLowerCase().includes(s) || v.aliases.some((a) => a.toLowerCase().includes(s)))
    if (route === 'none') list = list.filter((v) => v.vendor_billing_routes.length === 0)
    else if (route) list = list.filter((v) => v.vendor_billing_routes.some((r) => r.route === route))
    if (review) list = list.filter((v) => v.needs_review)
    if (dno) list = list.filter((v) => v.do_not_order)
    if (fishing) list = list.filter((v) => v.is_fishing)
    if (who === 'none') list = list.filter((v) => !v.assigned_buyer_id)
    else if (who) list = list.filter((v) => v.assigned_buyer_id === (who === 'me' ? profile?.id : who))
    return list
  }, [data, status, search, route, review, dno, fishing, who, profile?.id])

  const { sorted, sort, toggle } = useTableSort(rows, {
    name: (v) => v.name,
    billing: (v) => v.vendor_billing_routes.map((r) => BILLING_ROUTE_LABELS[r.route]).sort().join(', '),
    rep: (v) => v.rep_groups?.name,
    assigned: (v) => nameOf(v.assigned_buyer_id),
    phone: (v) => v.phone ?? v.email,
    flags: (v) => [STANDING_BADGE[v.standing]?.label, v.is_fishing ? 'Fishing' : '', v.needs_review ? 'Review' : ''].filter(Boolean).join(' ') || null,
  })

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const activeVendors = (data ?? []).filter((v) => v.is_active)
  const inactiveCount = (data?.length ?? 0) - activeVendors.length
  const total = status === 'all' ? (data?.length ?? 0) : status === 'inactive' ? inactiveCount : activeVendors.length
  const flagged = activeVendors.filter((v) => v.needs_review).length
  const doNotOrder = activeVendors.filter((v) => v.do_not_order).length
  const fishingCount = activeVendors.filter((v) => v.is_fishing).length

  return (
    <div>
      <PageHeader
        title="Vendors"
        description={data ? `${activeVendors.length} active vendors${flagged ? `, ${flagged} flagged for review` : ''}${inactiveCount ? `, ${inactiveCount} inactive` : ''}.` : undefined}
        actions={canEdit ? <Button onClick={() => navigate(`${ROUTES.vendors}/new`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add vendor</Button> : undefined}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setParam('q', draft.trim())
        }}
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (e.target.value === '') setParam('q', '')
            }}
            placeholder="Search by name, Lightspeed name or alias"
            aria-label="Search vendors"
            className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="w-36">
            <Select value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Active or inactive">
              <option value="">Active</option>
              <option value="inactive">Inactive{inactiveCount ? ` (${inactiveCount})` : ''}</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div className="w-44">
            <Select value={who} onChange={(e) => setParam('who', e.target.value)} aria-label="Assigned to">
              <option value="">Everyone's vendors</option>
              {(orderersQ.data ?? []).some((p) => p.id === profile?.id) ? <option value="me">Mine</option> : null}
              {(orderersQ.data ?? []).filter((p) => p.id !== profile?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              <option value="none">Unassigned</option>
            </Select>
          </div>
          <div className="w-44">
            <Select value={route} onChange={(e) => setParam('route', e.target.value)} aria-label="Billing route">
              <option value="">All routes</option>
              {(Object.keys(BILLING_ROUTE_LABELS) as BillingRoute[]).map((r) => (
                <option key={r} value={r}>{BILLING_ROUTE_LABELS[r]}</option>
              ))}
              <option value="none">No route yet</option>
            </Select>
          </div>
          <Button type="button" variant={review ? 'primary' : 'secondary'} onClick={() => setParam('review', review ? '' : '1')} leftIcon={<AlertTriangle className="size-4" aria-hidden="true" />}>
            Needs review{flagged ? ` (${flagged})` : ''}
          </Button>
          <Button type="button" variant={dno ? 'danger' : 'secondary'} onClick={() => setParam('dno', dno ? '' : '1')} leftIcon={<Ban className="size-4" aria-hidden="true" />}>
            Do not order{doNotOrder ? ` (${doNotOrder})` : ''}
          </Button>
          <Button type="button" variant={fishing ? 'primary' : 'secondary'} onClick={() => setParam('fishing', fishing ? '' : '1')} leftIcon={<Fish className="size-4" aria-hidden="true" />}>
            Fishing{fishingCount ? ` (${fishingCount})` : ''}
          </Button>
        </div>
      </form>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner label="Loading vendors…" className="text-brand" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center text-sm text-stone-600">
          {total === 0 ? 'No vendors yet.' : 'No vendors match these filters.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                <tr>
                  <SortHeader label="Vendor" sortKey="name" sort={sort} onSort={toggle} className="px-4 py-2.5" />
                  <SortHeader label="Billing" sortKey="billing" sort={sort} onSort={toggle} className="px-4 py-2.5" />
                  <SortHeader label="Rep group" sortKey="rep" sort={sort} onSort={toggle} className="hidden px-4 py-2.5 md:table-cell" />
                  <SortHeader label="Assigned to" sortKey="assigned" sort={sort} onSort={toggle} className="hidden px-4 py-2.5 md:table-cell" />
                  <SortHeader label="Phone / email" sortKey="phone" sort={sort} onSort={toggle} className="hidden px-4 py-2.5 lg:table-cell" />
                  <SortHeader label="Flags" sortKey="flags" sort={sort} onSort={toggle} align="right" className="px-4 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sorted.map((v) => (
                  <tr key={v.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5">
                      <Link to={`${ROUTES.vendors}/${v.id}`} className={cn('font-medium hover:underline', !v.is_active ? 'text-stone-400' : v.do_not_order ? 'text-red-700 hover:text-red-800' : 'text-stone-900 hover:text-brand')}>{v.name}</Link>
                      {!v.is_active ? <Badge tone="neutral" className="ml-2">Inactive</Badge> : null}
                      {v.lightspeed_name && v.lightspeed_name !== v.name ? <p className="truncate text-xs text-stone-400">LS: {v.lightspeed_name}</p> : null}
                    </td>
                    <td className="px-4 py-2.5"><RouteBadges routes={v.vendor_billing_routes} /></td>
                    <td className="hidden px-4 py-2.5 text-stone-600 md:table-cell">{v.rep_groups?.name ?? '—'}</td>
                    <td className="hidden px-4 py-2.5 text-stone-600 md:table-cell">{nameOf(v.assigned_buyer_id) ?? '—'}</td>
                    <td className="hidden px-4 py-2.5 text-stone-600 lg:table-cell">
                      {v.phone ?? (v.email ? null : '—')}
                      {v.email ? <a href={`mailto:${v.email}`} className="block truncate text-xs text-brand hover:underline">{v.email}</a> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {STANDING_BADGE[v.standing] ? <Badge tone={STANDING_BADGE[v.standing]!.tone} className="mr-1">{STANDING_BADGE[v.standing]!.label}</Badge> : null}
                      {v.is_fishing ? <Badge tone="info" className="mr-1">Fishing</Badge> : null}
                      {v.needs_review ? <Badge tone="warning">Review</Badge> : null}
                      {v.is_delivery_vendor ? <Badge tone="neutral" className="ml-1">Delivery</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">{rows.length} of {total}</p>
        </div>
      )}
    </div>
  )
}
