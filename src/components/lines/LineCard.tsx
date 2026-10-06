import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BookOpen, Building2, Plus } from 'lucide-react'
import { promoteLine, type LineRow } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { BILLING_ROUTE_LABELS, BILLING_ROUTE_TONE } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import { Badge, Button } from '@/components/ui'

/** One line (a brand a rep carries or a show listed). Shows its catalog, shows, and the way to make it a vendor. */
export function LineCard({ line, canEdit, onPromoted, showRepGroup = false }: { line: LineRow; canEdit: boolean; onPromoted: (vendorId: string) => void; showRepGroup?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function promote() {
    if (!window.confirm(`Make "${line.name}" a vendor? It keeps the rep group, route and catalog link.`)) return
    setBusy(true)
    try {
      const id = await promoteLine(line.id)
      toast.success('Vendor created')
      onPromoted(id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-stone-900">{line.vendor ? <Link to={`${ROUTES.vendors}/${line.vendor.id}`} className="hover:text-brand">{line.name}</Link> : line.name}</p>
          {showRepGroup && line.rep_group ? <Link to={`${ROUTES.repGroups}/${line.rep_group.id}`} className="text-xs text-stone-500 hover:text-brand">{line.rep_group.name}</Link> : null}
        </div>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {line.vendor ? <Badge tone="brand">Vendor</Badge> : null}
          <Badge tone={BILLING_ROUTE_TONE[line.route]}>{BILLING_ROUTE_LABELS[line.route]}</Badge>
          {line.zero_upcharge ? <Badge tone="success">0% upcharge</Badge> : null}
        </span>
      </div>
      {line.show_appearances.length ? (
        <p className="text-xs text-stone-600">
          {line.show_appearances.map((s) => `${s.show_label.replace(/\s*\(.*\)$/, '')}${s.booth ? ` · booth ${s.booth}` : ''}${s.exhibitor && s.exhibitor.toLowerCase() !== line.name.toLowerCase() ? ` (${s.exhibitor})` : ''}${s.is_new ? ' · new' : ''}`).join(' | ')}
        </p>
      ) : null}
      {line.specials ? <p className="text-xs text-stone-600"><span className="font-medium">{line.specials_label ?? 'Specials'}:</span> {line.specials}</p> : null}
      {line.notes ? <p className="text-xs text-stone-500">{line.notes}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {line.catalog_url ? (
          <a href={line.catalog_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><BookOpen className="size-4" aria-hidden="true" /> Catalog</a>
        ) : <span className="text-xs text-stone-400">No catalog link</span>}
        {line.vendor ? (
          <Link to={`${ROUTES.vendors}/${line.vendor.id}`} className="ml-auto inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand"><Building2 className="size-4" aria-hidden="true" /> Open vendor</Link>
        ) : canEdit ? (
          <Button size="sm" variant="secondary" className="ml-auto" loading={busy} onClick={() => void promote()} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Make a vendor</Button>
        ) : null}
      </div>
    </li>
  )
}
