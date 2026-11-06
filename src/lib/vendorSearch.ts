/**
 * Finding a vendor by what you type (Dana, Nov 6: "When I search for a vendor with wwd, it should bring up Worldwide, it doesnt.
 * I entered it as an alias"). Used by the top search bar, the vendor pickers and the Vendors page. A vendor matches on its
 * name, any other name (alias) or its parent company; what you typed exactly (WWD = Worldwide's other name) comes first.
 */
export interface SearchableVendor { name: string; aliases?: string[] | null; parent_company?: string | null; lightspeed_name?: string | null; is_active?: boolean }

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
const words = (t: string) => t.toLowerCase().split(/[\s\-&/,.()]+/).filter(Boolean)

/**
 * How well a vendor matches, lower is better; null when it does not match.
 * 0 the name or an other name is exactly it · 1 the name starts with it · 2 a word of the name starts with it ·
 * 3 an other name starts with it · 4 the name contains it · 5 an other name or the LS name contains it · 6 the parent company.
 */
export function vendorMatchRank(v: SearchableVendor, typed: string): number | null {
  const q = typed.trim().toLowerCase()
  if (!q) return null
  const sq = squash(q)
  const name = v.name.toLowerCase()
  const others = [...(v.aliases ?? []), ...(v.lightspeed_name ? [v.lightspeed_name] : [])].map((a) => a.toLowerCase())
  if (sq && (squash(name) === sq || (v.aliases ?? []).some((a) => squash(a) === sq))) return 0
  if (name.startsWith(q)) return 1
  if (words(name).some((w) => w.startsWith(q))) return 2
  if (others.some((a) => a.startsWith(q))) return 3
  if (name.includes(q)) return 4
  if (others.some((a) => a.includes(q))) return 5
  if (v.parent_company && sq.length >= 3 && squash(v.parent_company).includes(sq)) return 6
  return null
}

/** The vendors that match, best first: exact before partial, active before inactive, then by name. */
export function searchVendors<T extends SearchableVendor>(all: T[], typed: string, max?: number): T[] {
  const hits: { v: T; r: number }[] = []
  for (const v of all) { const r = vendorMatchRank(v, typed); if (r !== null) hits.push({ v, r }) }
  hits.sort((a, b) => Number(a.r !== 0) - Number(b.r !== 0) || Number(a.v.is_active === false) - Number(b.v.is_active === false) || a.r - b.r || a.v.name.localeCompare(b.v.name))
  const out = hits.map((h) => h.v)
  return max ? out.slice(0, max) : out
}
