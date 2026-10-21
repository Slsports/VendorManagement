import { useState } from 'react'
import toast from 'react-hot-toast'
import { PackageSearch } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { lsReasonLabel, lsReceivingHistory, type LsStockChange } from '@/services/lightspeed'
import type { LsPoLine } from '@/services/lsPos'
import { errorMessage, shortDate } from '@/lib/utils'
import { Button } from '@/components/ui'

const SALES = new Set(['removeInventoryForTransaction', 'addInventoryForTransaction'])

/**
 * What LS received (Dana, Oct 21): for each item on this PO that is in LS, the stock added in LS since the order date:
 * how (a PO checked in, a quantity typed in), the store, the date and who. Sales are left out. Read from LS when asked.
 */
export function LsReceivedBox({ lines, from }: { lines: LsPoLine[]; from: string | null }) {
  const { stores } = useAuth()
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ complete: boolean; read_up_to: string | null; changes: LsStockChange[] } | null>(null)
  const inLs = lines.filter((l) => l.ls_item_id && l.qty > 0)
  if (!inLs.length || !from) return null
  const storeOf = (shop: string | null) => stores.find((s) => s.ls_shop_id === shop)?.code ?? (shop ? `store ${shop}` : '')

  async function check() {
    setBusy(true)
    try {
      setRes(await lsReceivingHistory(inLs.map((l) => l.ls_item_id!), from!))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">What LS received</h2>
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => void check()} leftIcon={<PackageSearch className="size-4" aria-hidden="true" />}>{res ? 'Check again' : 'Check LS'}</Button>
      </div>
      <p className="mt-1 text-xs text-stone-500">Stock added in LS since {shortDate(from)} for the {inLs.length} item{inLs.length === 1 ? '' : 's'} already in LS. It can take a minute.</p>
      {res ? (
        <>
          {!res.complete ? <p className="mt-2 text-xs text-amber-700">LS was read up to {res.read_up_to ? shortDate(res.read_up_to) : 'part of the way'}; click Check again for the rest.</p> : null}
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {inLs.map((l, i) => {
              const added = res.changes.filter((c) => c.item_id === l.ls_item_id && !SALES.has(c.reason ?? '') && c.change !== 0)
              const total = added.reduce((n, c) => n + c.change, 0)
              return (
                <li key={`${l.ls_item_id}-${i}`} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 text-stone-800">{l.name || l.desc}{l.vid ? <span className="text-stone-500"> · {l.vid}</span> : null}</span>
                    <span className={total >= l.qty ? 'font-medium text-emerald-700' : total > 0 ? 'font-medium text-amber-700' : 'text-stone-500'}>Ordered {l.qty} · added in LS {total}</span>
                  </div>
                  {added.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                      {added.map((c, j) => <li key={j}>{c.change > 0 ? '+' : ''}{c.change} {storeOf(c.shop_id)} · {c.at ? shortDate(c.at) : ''} · {lsReasonLabel(c.reason)}{c.who ? ` · ${c.who}` : ''}</li>)}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}
