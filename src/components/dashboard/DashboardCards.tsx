import { useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { arrangeCards, moveCard, readLayout, type DashboardLayout } from '@/lib/dashboardLayout'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui'

/** A number box (small, four to a row) or a card (three to a row). */
export interface DashboardCard { id: string; label: string; node: ReactNode; size?: 'tile' | 'card' }

/** One list for the whole dashboard; an earlier layout that kept the number boxes apart is read with them first. */
function readSaved(raw: unknown): DashboardLayout | null {
  const cards = readLayout(raw)
  const tiles = raw && typeof raw === 'object' ? readLayout((raw as { tiles?: unknown }).tiles) : null
  if (!cards && !tiles) return null
  const order = [...(tiles?.order ?? []), ...(cards?.order ?? [])]
  const hidden = [...(tiles?.hidden ?? []), ...(cards?.hidden ?? [])]
  return order.length || hidden.length ? { order, hidden } : null
}

/** Neighbouring number boxes share a row of four; cards go three to a row. The order is the person's. */
function runs(items: DashboardCard[]): DashboardCard[][] {
  const out: DashboardCard[][] = []
  for (const c of items) {
    const last = out[out.length - 1]
    if (last && (last[0]!.size === 'tile') === (c.size === 'tile')) last.push(c)
    else out.push([c])
  }
  return out
}

/**
 * The whole dashboard in each person's own order (Dana, Oct 11: "I want everything customizable", "make all cards
 * eligible to be on top"): number boxes and cards in one list. Customize moves anything up or down and hides it;
 * it is saved to the person's login. Reset puts the standard order back.
 */
export function DashboardCards({ title, description, items }: { title: string; description?: string; items: DashboardCard[] }) {
  const { profile, refreshProfile } = useAuth()
  const [layout, setLayout] = useState(() => readSaved(profile?.dashboard_layout))
  const [editing, setEditing] = useState(false)
  const view = arrangeCards(items, layout)
  const all = [...view.shown, ...view.hidden]

  async function save(next: DashboardLayout | null) {
    setLayout(next)
    if (!profile) return
    const { error } = await supabase.from('profiles').update({ dashboard_layout: next as never }).eq('id', profile.id)
    if (error) toast.error(errorMessage(error))
    else void refreshProfile()
  }
  const current = (): DashboardLayout => ({ order: all.map((c) => c.id), hidden: view.hidden.map((c) => c.id) })

  return (
    <>
      <PageHeader title={title} description={description}
        actions={<Button size="sm" variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((v) => !v)} leftIcon={<SlidersHorizontal className="size-4" aria-hidden="true" />}>{editing ? 'Done' : 'Customize'}</Button>} />
      {editing ? (
        <section aria-label="Customize the dashboard" className="mb-6 rounded-2xl border border-brand/30 bg-white p-4">
          <p className="text-sm text-stone-600">Your own dashboard, top to bottom. Move anything up or down, or untick to hide it. Only you see this.</p>
          <ol className="mt-3 divide-y divide-stone-100">
            {all.map((c, i) => {
              const isHidden = view.hidden.some((h) => h.id === c.id)
              return (
                <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" className="size-4 accent-brand" checked={!isHidden}
                      onChange={(e) => { const l = current(); void save({ ...l, hidden: e.target.checked ? l.hidden.filter((h) => h !== c.id) : [...l.hidden, c.id] }) }} />
                    <span className={isHidden ? 'truncate text-stone-400 line-through' : 'truncate text-stone-900'}>{c.label}</span>
                    {c.size === 'tile' ? <span className="shrink-0 text-xs text-stone-400">number box</span> : null}
                  </label>
                  <button type="button" disabled={i === 0} onClick={() => { const l = current(); void save({ ...l, order: moveCard(l.order, c.id, -1) }) }} className="rounded p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label={`Move ${c.label} up`}><ArrowUp className="size-4" aria-hidden="true" /></button>
                  <button type="button" disabled={i === all.length - 1} onClick={() => { const l = current(); void save({ ...l, order: moveCard(l.order, c.id, 1) }) }} className="rounded p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label={`Move ${c.label} down`}><ArrowDown className="size-4" aria-hidden="true" /></button>
                </li>
              )
            })}
          </ol>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>Done</Button>
            <Button size="sm" variant="ghost" onClick={() => void save(null)}>Reset to the standard dashboard</Button>
          </div>
          <p className="mt-2 text-xs text-stone-500">Some cards only show when they have something in them.</p>
        </section>
      ) : null}
      <div className="space-y-4">
        {runs(view.shown).map((run) => (
          <section key={run[0]!.id} className={run[0]!.size === 'tile' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'grid gap-4 lg:grid-cols-3'}>
            {run.map((c) => <div key={c.id} className="contents">{c.node}</div>)}
          </section>
        ))}
      </div>
    </>
  )
}
