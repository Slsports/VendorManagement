import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/utils'
import type { ItemChange } from '@/types'

/**
 * What the vendor says is backordered on this order (Dana, Oct 31: "just show backorders on the order"): still coming,
 * just later, so nothing to decide and nothing written to Lightspeed. Each line links the paper that said so.
 */
export function OrderBackorders({ orderId }: { orderId: string }) {
  const q = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('item_changes').select('*').eq('order_id', orderId).eq('read_as', 'backordered').order('vendor_item_id')
    if (error) throw error
    return (data ?? []) as ItemChange[]
  }, [orderId])
  const rows = q.data ?? []
  if (!rows.length) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">On backorder ({rows.length})</h2>
      <p className="mt-1 text-xs text-stone-500">The vendor says these are still coming, later.</p>
      <ul className="mt-2 divide-y divide-stone-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="py-1.5">
            <span className="font-medium text-stone-900">{[r.vendor_item_id, r.item_name].filter(Boolean).join(' ') || 'Item'}</span>
            {r.ls_name ? <span className="text-stone-500"> · in LS as {r.ls_name}</span> : null}
            <span className="block text-xs text-stone-500">
              {r.vendor_words ? `“${r.vendor_words}”` : 'Backordered'}
              {r.back_date ? ` · ships ${shortDate(r.back_date)}` : ''}
              {r.check_id ? <> · <Link to={`${ROUTES.orderChecks}/${r.check_id}`} className="text-brand hover:underline">where it came from</Link></> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
