import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { errorMessage, shortDate } from '@/lib/utils'
import { money } from '@/lib/freight'
import type { ReviewItem } from '@/types'
import { Button } from '@/components/ui'

interface Side { id: string; po: string | null; status: string; date: string | null; description: string | null; amount: number | null; show: string | null }
interface Details { vendor_name?: string; a?: Side; b?: Side; common?: string[] }

/**
 * Two orders that look like the same order entered twice (Dana, Oct 31): same vendor and show, the same kinds of items,
 * not two different confirmations. Keep one (the other is cancelled as a copy, its papers, mail and tasks moved over) or
 * Not the same order. Nothing is cancelled without this answer.
 */
export function OrderDuplicateReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const d = (item.details ?? {}) as Details
  const [busy, setBusy] = useState(false)
  async function answer(keep: string | null) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('order_duplicate_answer', { p_item: item.id, p_keep: keep })
      if (error) throw error
      toast.success(keep ? 'Kept one; the other is cancelled as a copy' : 'Both kept')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const side = (s: Side | undefined, label: string) => s ? (
    <div className="rounded-lg border border-amber-200 bg-white/70 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <Link to={`${ROUTES.orders}/${s.id}`} className="font-medium text-brand hover:underline">PO {s.po ?? '(none)'}</Link>
      <p className="text-stone-700">{s.description ?? 'No description'}</p>
      <p className="text-xs text-stone-500">{[shortDate(s.date), s.status, s.amount != null ? money(s.amount) : 'no amount'].filter(Boolean).join(' · ')}</p>
      {canEdit ? <Button size="sm" className="mt-2" loading={busy} onClick={() => void answer(s.id)}>Keep this one</Button> : null}
    </div>
  ) : null
  return (
    <div className="mt-2 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">{side(d.a, 'Order 1')}{side(d.b, 'Order 2')}</div>
      {d.common?.length ? <p className="text-xs text-stone-500">Both have: {d.common.map((w) => w.toLowerCase()).join(', ')}</p> : null}
      {canEdit ? <Button size="sm" variant="ghost" loading={busy} onClick={() => void answer(null)} leftIcon={<X className="size-4" aria-hidden="true" />}>Not the same order</Button> : null}
    </div>
  )
}
