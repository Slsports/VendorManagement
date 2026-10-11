// Each person's dashboard (Dana, Oct 11): the cards in their order, some hidden. Saved on their profile.

export interface DashboardLayout { order: string[]; hidden: string[] }

/** The cards in this person's order: their saved order first, then any card added since, in the standard order. */
export function arrangeCards<T extends { id: string }>(cards: T[], layout: DashboardLayout | null): { shown: T[]; hidden: T[] } {
  if (!layout) return { shown: cards, hidden: [] }
  const rank = new Map(layout.order.map((id, i) => [id, i]))
  const standard = new Map(cards.map((c, i) => [c.id, i]))
  const sorted = [...cards].sort((a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return standard.get(a.id)! - standard.get(b.id)!
  })
  const hide = new Set(layout.hidden)
  return { shown: sorted.filter((c) => !hide.has(c.id)), hidden: sorted.filter((c) => hide.has(c.id)) }
}

/** Move one card up (-1) or down (+1) in the full list. */
export function moveCard(order: string[], id: string, step: -1 | 1): string[] {
  const i = order.indexOf(id)
  const j = i + step
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  return next
}

export function readLayout(raw: unknown): DashboardLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { order?: unknown; hidden?: unknown }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return { order: strings(r.order), hidden: strings(r.hidden) }
}
