/**
 * What a vendor sells (Dana, Nov 6): "I want the category of what we purchase from a vendor to show as well as what WWD lists as
 * their categories. WWD's categories are not as broad as ours but I want to know what other categories they sell other than the
 * ones we buy from them." "No matching list necessary. I'd rather see too much than not enough."
 * Two lists side by side, each in its own system's words: our LS categories for their items, and Worldwide's Product Lines.
 */
export interface BuyCategory { path: string; items: number; carried: number }
export interface WwdLine { category: string; line: string; portal: string | null }

/** Our LS categories for a vendor's items, the most items still carried first; ones with nothing carried any more last. */
export function buyCategories(items: { category_path: string | null; archived: boolean }[]): BuyCategory[] {
  const by = new Map<string, BuyCategory>()
  for (const it of items) {
    const path = (it.category_path ?? '').trim() || '(no category)'
    const c = by.get(path) ?? { path, items: 0, carried: 0 }
    c.items++
    if (!it.archived) c.carried++
    by.set(path, c)
  }
  return [...by.values()].sort((a, b) => Number(b.carried > 0) - Number(a.carried > 0) || b.carried - a.carried || b.items - a.items || a.path.localeCompare(b.path))
}

/** Worldwide's Product Lines from the portal ({category, lines[]}), one entry per line, no repeats. */
export function wwdLines(records: { number: string | null; data: unknown }[]): WwdLine[] {
  const out: WwdLine[] = []
  const seen = new Set<string>()
  for (const r of records) {
    const pl = (r.data as { product_lines?: { category?: string; lines?: string[] }[] } | null)?.product_lines ?? []
    for (const g of pl) {
      const category = (g.category ?? '').trim()
      const lines = (g.lines ?? []).map((l) => l.trim()).filter(Boolean)
      for (const line of lines.length ? lines : ['']) {
        const key = `${category}|${line}`.toLowerCase()
        if (!category && !line) continue
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ category, line, portal: r.number })
      }
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.line.localeCompare(b.line))
}

/** "WINTERSPORTS/GOGGLES/ADULT" → "WINTERSPORTS › GOGGLES › ADULT". */
export const pathLabel = (path: string) => path.split('/').map((p) => p.trim()).filter(Boolean).join(' › ')
