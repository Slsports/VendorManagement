import { useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { arrangeCards, moveCard, readLayout, type DashboardLayout } from '@/lib/dashboardLayout'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui'

export interface DashboardCard { id: string; label: string; node: ReactNode }

/**
 * The dashboard cards in each person's own order (Dana, Oct 11: "Is it possible for each ee to have the ability
 * to see the dashboard in different order of cards?"). Customize moves cards up or down and hides them; it is
 * saved to the person's login. Reset puts the standard order back.
 */
export function DashboardCards({ cards }: { cards: DashboardCard[] }) {
  const { profile, refreshProfile } = useAuth()
  const [layout, setLayout] = useState<DashboardLayout | null>(() => readLayout(profile?.dashboard_layout))
  const [editing, setEditing] = useState(false)
  const { shown, hidden } = arrangeCards(cards, layout)
  const all = [...shown, ...hidden]

  async function save(next: DashboardLayout | null) {
    setLayout(next)
    if (!profile) return
    const { error } = await supabase.from('profiles').update({ dashboard_layout: next as never }).eq('id', profile.id)
    if (error) toast.error(errorMessage(error))
    else void refreshProfile()
  }
  const current = (): DashboardLayout => ({ order: all.map((c) => c.id), hidden: hidden.map((c) => c.id) })

  return (
    <>
      <div className="mt-6 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} leftIcon={<SlidersHorizontal className="size-4" aria-hidden="true" />}>{editing ? 'Done' : 'Customize'}</Button>
      </div>
      {editing ? (
        <section aria-label="Customize the dashboard" className="mt-2 rounded-2xl border border-brand/30 bg-white p-4">
          <p className="text-sm text-stone-600">Your own order. Move cards up or down, or untick to hide one. Only you see this.</p>
          <ol className="mt-3 divide-y divide-stone-100">
            {all.map((c, i) => {
              const isHidden = hidden.some((h) => h.id === c.id)
              return (
                <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" className="size-4 accent-brand" checked={!isHidden}
                      onChange={(e) => { const l = current(); void save({ ...l, hidden: e.target.checked ? l.hidden.filter((h) => h !== c.id) : [...l.hidden, c.id] }) }} />
                    <span className={isHidden ? 'truncate text-stone-400 line-through' : 'truncate text-stone-900'}>{c.label}</span>
                  </label>
                  <button type="button" disabled={i === 0} onClick={() => { const l = current(); void save({ ...l, order: moveCard(l.order, c.id, -1) }) }} className="rounded p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label={`Move ${c.label} up`}><ArrowUp className="size-4" aria-hidden="true" /></button>
                  <button type="button" disabled={i === all.length - 1} onClick={() => { const l = current(); void save({ ...l, order: moveCard(l.order, c.id, 1) }) }} className="rounded p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label={`Move ${c.label} down`}><ArrowDown className="size-4" aria-hidden="true" /></button>
                </li>
              )
            })}
          </ol>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>Done</Button>
            <Button size="sm" variant="ghost" onClick={() => void save(null)}>Reset to the standard order</Button>
          </div>
          <p className="mt-2 text-xs text-stone-500">Some cards only show when they have something in them.</p>
        </section>
      ) : null}
      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        {shown.map((c) => <div key={c.id} className="contents">{c.node}</div>)}
      </section>
    </>
  )
}
