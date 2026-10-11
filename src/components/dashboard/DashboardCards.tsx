import { useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { arrangeCards, moveCard, readLayout, type DashboardLayout } from '@/lib/dashboardLayout'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui'

export interface DashboardCard { id: string; label: string; node: ReactNode }

/** Saved on the profile: the cards, plus the number boxes at the top (Dana, Oct 11: "I want everything customizable"). */
interface SavedLayout extends DashboardLayout { tiles?: DashboardLayout }

function readSaved(raw: unknown): { cards: DashboardLayout | null; tiles: DashboardLayout | null } {
  const cards = readLayout(raw)
  const tiles = raw && typeof raw === 'object' ? readLayout((raw as { tiles?: unknown }).tiles) : null
  return { cards: cards && (cards.order.length || cards.hidden.length) ? cards : null, tiles }
}

/**
 * The whole dashboard in each person's own order (Dana, Oct 11): the number boxes and the cards. Customize moves
 * them up or down and hides them; it is saved to the person's login. Reset puts the standard order back.
 */
export function DashboardCards({ title, description, tiles, cards }: { title: string; description?: string; tiles: DashboardCard[]; cards: DashboardCard[] }) {
  const { profile, refreshProfile } = useAuth()
  const [layout, setLayout] = useState(() => readSaved(profile?.dashboard_layout))
  const [editing, setEditing] = useState(false)
  const tileView = arrangeCards(tiles, layout.tiles)
  const cardView = arrangeCards(cards, layout.cards)

  async function save(next: { cards: DashboardLayout | null; tiles: DashboardLayout | null }) {
    setLayout(next)
    if (!profile) return
    const stored: SavedLayout | null = next.cards || next.tiles ? { ...(next.cards ?? { order: [], hidden: [] }), ...(next.tiles ? { tiles: next.tiles } : {}) } : null
    const { error } = await supabase.from('profiles').update({ dashboard_layout: stored as never }).eq('id', profile.id)
    if (error) toast.error(errorMessage(error))
    else void refreshProfile()
  }
  const now = (v: { shown: DashboardCard[]; hidden: DashboardCard[] }): DashboardLayout => ({ order: [...v.shown, ...v.hidden].map((c) => c.id), hidden: v.hidden.map((c) => c.id) })
  const change = (group: 'tiles' | 'cards', next: DashboardLayout) => void save({ ...layout, [group]: next })

  const editor = (group: 'tiles' | 'cards', heading: string, view: { shown: DashboardCard[]; hidden: DashboardCard[] }) => {
    const all = [...view.shown, ...view.hidden]
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{heading}</h3>
        <ol className="mt-1 divide-y divide-stone-100">
          {all.map((c, i) => {
            const isHidden = view.hidden.some((h) => h.id === c.id)
            const l = now(view)
            return (
              <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input type="checkbox" className="size-4 accent-brand" checked={!isHidden}
                    onChange={(e) => change(group, { ...l, hidden: e.target.checked ? l.hidden.filter((h) => h !== c.id) : [...l.hidden, c.id] })} />
                  <span className={isHidden ? 'truncate text-stone-400 line-through' : 'truncate text-stone-900'}>{c.label}</span>
                </label>
                <button type="button" disabled={i === 0} onClick={() => change(group, { ...l, order: moveCard(l.order, c.id, -1) })} className="rounded p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label={`Move ${c.label} up`}><ArrowUp className="size-4" aria-hidden="true" /></button>
                <button type="button" disabled={i === all.length - 1} onClick={() => change(group, { ...l, order: moveCard(l.order, c.id, 1) })} className="rounded p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label={`Move ${c.label} down`}><ArrowDown className="size-4" aria-hidden="true" /></button>
              </li>
            )
          })}
        </ol>
      </div>
    )
  }

  return (
    <>
      <PageHeader title={title} description={description}
        actions={<Button size="sm" variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((v) => !v)} leftIcon={<SlidersHorizontal className="size-4" aria-hidden="true" />}>{editing ? 'Done' : 'Customize'}</Button>} />
      {editing ? (
        <section aria-label="Customize the dashboard" className="mb-6 rounded-2xl border border-brand/30 bg-white p-4">
          <p className="text-sm text-stone-600">Your own dashboard. Move things up or down, or untick to hide them. Only you see this.</p>
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            {editor('tiles', 'Number boxes at the top', tileView)}
            {editor('cards', 'Cards', cardView)}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>Done</Button>
            <Button size="sm" variant="ghost" onClick={() => void save({ cards: null, tiles: null })}>Reset to the standard dashboard</Button>
          </div>
          <p className="mt-2 text-xs text-stone-500">Some cards only show when they have something in them.</p>
        </section>
      ) : null}
      {tileView.shown.length ? (
        <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tileView.shown.map((c) => <div key={c.id} className="contents">{c.node}</div>)}
        </section>
      ) : null}
      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        {cardView.shown.map((c) => <div key={c.id} className="contents">{c.node}</div>)}
      </section>
    </>
  )
}
