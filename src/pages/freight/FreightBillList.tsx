import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink, FileUp, Pencil, Plus, Truck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listCarriers, listFreightBills, type FreightFilter } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { FREIGHT_STATUS, money, shortDate } from '@/lib/freight'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'
import { CarrierDialog } from '@/components/freight/CarrierDialog'
import { BulkBillUpload } from '@/components/freight/BulkBillUpload'
import type { Carrier } from '@/types'

const TABS: { value: FreightFilter; label: string }[] = [
  { value: 'open', label: 'To match' },
  { value: 'unpaid', label: 'To pay' },
  { value: 'done', label: 'Matched' },
  { value: 'all', label: 'All' },
]

/** Freight bills from the carriers, for Trevor: match each shipment to its vendor and order. */
export default function FreightBillListPage() {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Carrier | 'new' | null>(null)
  const [uploading, setUploading] = useState(false)
  const filter = (params.get('show') ?? 'open') as FreightFilter
  // Click a carrier: just its bills, every year, paid or not (its "folder", Dana, Oct 8).
  const carrierId = params.get('carrier')
  const carriers = useSupabaseQuery(async () => (organization ? listCarriers(organization.id, true) : []), [organization?.id])
  const q = useSupabaseQuery(async () => (organization ? listFreightBills(organization.id, filter, carrierId) : []), [organization?.id, filter, carrierId])

  return (
    <div>
      <PageHeader title="Freight bills" description="Bills from our billing companies. Each shipment goes to the vendor that shipped it; the freight lands on that order."
        actions={canEdit ? <Button variant="secondary" onClick={() => setUploading(true)} leftIcon={<FileUp className="size-4" aria-hidden="true" />}>Upload bills</Button> : undefined} />
      {uploading ? <BulkBillUpload onClose={() => setUploading(false)} onDone={() => q.refetch()} /> : null}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Billing companies</h2>
      <p className="mb-3 text-xs text-stone-500">Who we book shipments with and pay. Click one for just its bills.</p>
      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(carriers.data ?? []).filter((c) => c.role === 'billing').map((c) => (
          <div key={c.id} className={cn('rounded-2xl border bg-white p-4 text-sm', carrierId === c.id ? 'border-brand ring-2 ring-brand/20' : 'border-stone-200', !c.is_active && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => { const next = new URLSearchParams(params); if (carrierId === c.id) { next.delete('carrier') } else { next.set('carrier', c.id); next.set('show', 'all') } setParams(next, { replace: true }) }}
                aria-pressed={carrierId === c.id} title={carrierId === c.id ? 'Show every carrier' : `Show only ${c.name}'s bills`}
                className="flex flex-wrap items-center gap-2 text-left font-medium text-stone-900 hover:text-brand"><Truck className="size-4 text-stone-400" aria-hidden="true" />{c.name}<Badge tone="neutral">{c.mode === 'ltl' ? 'LTL' : 'Parcel'}</Badge>{!c.is_active ? <Badge tone="neutral">Inactive</Badge> : null}</button>
              {canEdit ? (
                <button type="button" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Pencil className="size-4" aria-hidden="true" /></button>
              ) : null}
            </div>
            {c.email_domains.length ? <p className="text-xs text-stone-500">Mail from {c.email_domains.join(', ')}</p> : null}
            {c.ups_account ? <p className="mt-1 text-sm text-stone-800">Our UPS # <span className="font-mono font-semibold">{c.ups_account}</span></p> : null}
            {c.is_default_parcel ? <Badge tone="success" className="mt-1">Default for UPS (parcel)</Badge> : null}
            {c.account_number ? <p className="text-xs text-stone-500">Our account with them {c.account_number}</p> : null}
            {c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand hover:underline">Log in <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
          </div>
        ))}
        {canEdit ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white/60 p-4">
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add carrier</Button>
          </div>
        ) : null}
      </section>
      {(carriers.data ?? []).some((c) => c.role === 'trucking') ? (
        <section className="mb-6 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Trucking companies</h2>
          <p className="text-xs text-stone-500">They haul the freight, hired by a billing company. Their tracking and delivery receipts are still read.</p>
          <ul className="mt-2 divide-y divide-stone-100">
            {(carriers.data ?? []).filter((c) => c.role === 'trucking').map((c) => (
              <li key={c.id} className={cn('flex items-center justify-between gap-2 py-1.5', !c.is_active && 'opacity-60')}>
                <span><span className="font-medium text-stone-900">{c.name}</span> <Badge tone="neutral">{c.mode === 'ltl' ? 'LTL' : 'Parcel'}</Badge>{c.hired_by ? <span className="text-xs text-stone-500"> · usually hired by {c.hired_by}</span> : null}</span>
                {canEdit ? <button type="button" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Pencil className="size-4" aria-hidden="true" /></button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {editing ? (
        <CarrierDialog carrier={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await carriers.refetch() }} />
      ) : null}

      {carrierId ? (
        <p className="mb-3 text-sm text-stone-700">
          Only <span className="font-semibold">{(carriers.data ?? []).find((c) => c.id === carrierId)?.name ?? 'this carrier'}</span>'s bills.{' '}
          <button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete('carrier'); setParams(next, { replace: true }) }} className="font-medium text-brand hover:underline">Show every carrier</button>
        </p>
      ) : null}
      <div role="tablist" aria-label="Which bills" className="mb-4 flex w-full max-w-md rounded-xl border border-stone-200 bg-white p-1">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={filter === t.value}
            onClick={() => { const next = new URLSearchParams(params); if (t.value === 'open') next.delete('show'); else next.set('show', t.value); setParams(next, { replace: true }) }}
            className={cn('flex-1 rounded-lg px-3 py-2 text-sm font-semibold', filter === t.value ? 'bg-brand text-white shadow-sm' : 'text-stone-600 hover:text-stone-900')}>
            {t.label}
          </button>
        ))}
      </div>

      {q.error ? <Alert variant="error">{q.error}</Alert> : null}
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading freight bills…" className="text-brand" /></div> : (q.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center text-sm text-stone-600">
          {filter === 'open' ? 'Nothing to match. New bills arrive from the carriers\' emails.' : filter === 'unpaid' ? 'Nothing to pay.' : 'No bills here.'}
        </div>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {q.data!.map((b) => {
            const st = FREIGHT_STATUS[b.status]
            const open = b.freight_bill_lines.filter((l) => !l.confirmed).length
            const shippers = [...new Set(b.freight_bill_lines.map((l) => l.shipper_name).filter(Boolean))]
            return (
              <li key={b.id}>
                <Link to={`${ROUTES.freight}/${b.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-stone-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900">{b.carriers?.name ?? 'Carrier'}{b.carriers?.ups_account ? <span className="font-normal text-stone-500"> · UPS {b.carriers.ups_account}</span> : null}{b.invoice_number ? <span className="font-normal text-stone-500"> · #{b.invoice_number}</span> : null}</p>
                    <p className="truncate text-xs text-stone-500">{shippers.length ? shippers.join(', ') : b.status === 'needs_pdf' ? 'Waiting for the bill PDF' : '—'}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-stone-500">{shortDate(b.invoice_date)}</span>
                    <span className="font-medium text-stone-900">{money(b.total)}</span>
                    <Badge tone={st.tone}>{b.status === 'to_match' && open ? `${open} to match` : st.label}</Badge>
                    {b.paid_date ? <Badge tone="success">Paid {shortDate(b.paid_date)}</Badge> : <Badge tone="warning">Unpaid{b.due_date ? ` · due ${shortDate(b.due_date)}` : ''}</Badge>}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
