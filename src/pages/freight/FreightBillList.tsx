import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink, Truck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listCarriers, listFreightBills, type FreightFilter } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { FREIGHT_STATUS, money, shortDate } from '@/lib/freight'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Spinner } from '@/components/ui'

const TABS: { value: FreightFilter; label: string }[] = [
  { value: 'open', label: 'To do' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
]

/** Freight bills from the carriers, for Trevor: match each shipment to its vendor and order. */
export default function FreightBillListPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('show') ?? 'open') as FreightFilter
  const carriers = useSupabaseQuery(async () => (organization ? listCarriers(organization.id) : []), [organization?.id])
  const q = useSupabaseQuery(async () => (organization ? listFreightBills(organization.id, filter) : []), [organization?.id, filter])

  return (
    <div>
      <PageHeader title="Freight bills" description="Bills from our carriers. Each shipment goes to the vendor that shipped it; the freight lands on that order." />

      {(carriers.data ?? []).length ? (
        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {carriers.data!.map((c) => (
            <div key={c.id} className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-stone-900"><Truck className="size-4 text-stone-400" aria-hidden="true" />{c.name}<Badge tone="neutral">{c.mode === 'ltl' ? 'LTL' : 'Parcel'}</Badge></p>
              {c.account_number ? <p className="text-xs text-stone-500">Account {c.account_number}</p> : null}
              {c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand hover:underline">Log in <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
            </div>
          ))}
        </section>
      ) : null}

      <div role="tablist" aria-label="Which bills" className="mb-4 flex w-full max-w-sm rounded-xl border border-stone-200 bg-white p-1">
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
          {filter === 'open' ? 'Nothing to do. New bills arrive from the carriers\' emails.' : 'No bills here.'}
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
                    <p className="font-medium text-stone-900">{b.carriers?.name ?? 'Carrier'}{b.invoice_number ? <span className="font-normal text-stone-500"> · #{b.invoice_number}</span> : null}</p>
                    <p className="truncate text-xs text-stone-500">{shippers.length ? shippers.join(', ') : b.status === 'needs_pdf' ? 'Waiting for the bill PDF' : '—'}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-stone-500">{shortDate(b.invoice_date)}</span>
                    <span className="font-medium text-stone-900">{money(b.total)}</span>
                    <Badge tone={st.tone}>{b.status === 'to_match' && open ? `${open} to match` : st.label}</Badge>
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
