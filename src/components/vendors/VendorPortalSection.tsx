import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { vendorPortal } from '@/services/wwdPortal'
import { FoldSection } from '@/components/shared/FoldSection'
import { Badge } from '@/components/ui'
import { programState } from '@/lib/vendors'
import type { VendorProgram } from '@/types'

interface PortalData {
  address?: { address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; phone?: string | null } | null
  po_address?: { address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null } | null
  product_lines?: { category: string; lines: string[] }[]
  resources?: { liability_insurance?: string | null; zero_upcharge?: boolean | null; rebate_program?: boolean | null } | null
  return_notes?: string | null
  brands?: string[]
  documents?: { name: string; description: string | null }[]
}

const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString() : '')

function Program({ p }: { p: VendorProgram }) {
  const state = programState(p)
  const docs = Array.isArray(p.documents) ? (p.documents as { name: string; description: string | null }[]) : []
  const rows: [string, string | null][] = [
    ['Discount', p.discount], ['Terms', p.billing_terms], ['Freight', p.freight_terms], ['Minimum', p.minimum_order],
    ['Ships from', p.shipping_points], ['Ship dates', p.ship_begin || p.ship_end ? `${day(p.ship_begin)} – ${day(p.ship_end)}` : null],
  ]
  return (
    <li className={state === 'expired' ? 'opacity-70' : undefined}>
      <p className="font-medium text-stone-900">
        {p.name}{' '}
        {state === 'expired' ? <Badge tone="neutral">expired {day(p.expires_on)}</Badge>
          : state === 'soon' ? <Badge tone="warning">ends {day(p.expires_on)}</Badge>
          : p.expires_on ? <Badge tone="success">until {day(p.expires_on)}</Badge> : null}
      </p>
      <dl className="mt-1 grid gap-x-3 text-xs sm:grid-cols-[6rem_1fr]">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-stone-500">{k}</dt><dd className="text-stone-800">{v}</dd></div>)}
      </dl>
      {docs.length ? <p className="mt-1 text-xs text-stone-500">Files on the portal: {docs.map((d) => d.description ?? d.name).join(', ')}</p> : null}
    </li>
  )
}

/** The vendor as the Worldwide portal shows it (Dana, Oct 16): programs (live first, expired kept), product lines, returns. */
export function VendorPortalSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => vendorPortal(vendorId), [vendorId])
  const entries = q.data?.entries ?? []
  const programs = [...(q.data?.programs ?? [])].sort((a, b) => Number(programState(a) === 'expired') - Number(programState(b) === 'expired'))
  if (!q.isLoading && entries.length === 0 && programs.length === 0) return null
  const read = entries.map((e) => e.read_at).sort().at(-1) ?? null
  return (
    <FoldSection title="Worldwide portal" summary={q.isLoading ? null : `${programs.length} program${programs.length === 1 ? '' : 's'}${read ? ` · read ${day(read)}` : ''}`}>
      <div className="space-y-4 text-sm">
        {programs.length ? <ul className="space-y-3">{programs.map((p) => <Program key={p.id} p={p} />)}</ul> : null}
        {entries.map((e) => {
          const d = (e.data ?? {}) as PortalData
          return (
            <div key={e.id} className="space-y-2 border-t border-stone-100 pt-3">
              <p className="text-xs text-stone-500">In the portal as <strong className="text-stone-700">{e.name}</strong> (vendor {e.number}), read {day(e.read_at)}</p>
              {d.product_lines?.length ? (
                <div>
                  <h3 className="text-xs font-medium text-stone-500">Product lines</h3>
                  <ul className="text-stone-800">{d.product_lines.map((l) => <li key={l.category}>{l.category}{l.lines.length ? <span className="text-stone-500">: {l.lines.join(', ')}</span> : null}</li>)}</ul>
                </div>
              ) : null}
              {(d.resources?.zero_upcharge ?? d.resources?.rebate_program) != null ? <p><span className="text-xs font-medium text-stone-500">Zero upcharge </span>{(d.resources?.zero_upcharge ?? d.resources?.rebate_program) ? 'Yes' : 'No'}</p> : null}
              {d.brands?.length ? <p><span className="text-xs font-medium text-stone-500">Brands </span>{d.brands.join(', ')}</p> : null}
              {d.return_notes ? <p><span className="text-xs font-medium text-stone-500">Returns </span>{d.return_notes.replace(/ \(Worldwide portal\)$/, '')}</p> : null}
              {d.po_address ? <p><span className="text-xs font-medium text-stone-500">PO address </span>{[d.po_address.address, d.po_address.city, d.po_address.state, d.po_address.postal_code].filter(Boolean).join(', ')}</p> : null}
              {d.resources?.liability_insurance ? <p><span className="text-xs font-medium text-stone-500">Liability insurance </span>{d.resources.liability_insurance}</p> : null}
              {d.documents?.length ? <p className="text-xs text-stone-500">Other files on the portal: {d.documents.map((x) => x.description ?? x.name).join(', ')}</p> : null}
            </div>
          )
        })}
      </div>
    </FoldSection>
  )
}
