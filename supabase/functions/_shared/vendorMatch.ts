// Name matching for imports, the same rules as scripts/lib/match.mjs (a test keeps the two in step): exact key on name /
// Lightspeed name / other names, then the same name without generic words ("Buck Knives" = BUCK), then one clear prefix.
// "exact" is sure; "generic" and "prefix" are guesses a person confirms.
export interface MatchVendor { id: string; name: string; lightspeed_name?: string | null; aliases?: string[] | null }
export type MatchHow = 'exact' | 'generic' | 'prefix'
type Index<V> = Map<string, V> & { generic?: Map<string, V> }

const STOP = /\b(inc|llc|co|corp|corporation|company|ltd|usa|the|intl|international|dist|distributors|enterprises|ent|mfg|manufacturing|sales|products|brands|group)\b/g
const GENERIC = /\b(outdoor|outdoors|fishing|tackle|companies|supply|knives|belts|footwear|footcare|pet|treats|toys|games|apparel|sweets|snacks)\b/g

/** Loose key: lower-case, drop a rep/parent tag after " - " or "(", drop stop words and punctuation. */
export function nameKey(s: string | null | undefined): string {
  return String(s || '').toLowerCase().replace(/\s[-–(].*$/, '').replace(STOP, '').replace(/[^a-z0-9]/g, '')
}
/** Strict key as the database computes it (vendor_directory.name_key). */
export function dbKey(s: string | null | undefined): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/gi, '')
}
function genericKey(s: string | null | undefined) {
  return String(s || '').toLowerCase().replace(/\s[-–(].*$/, '').replace(STOP, '').replace(GENERIC, '').replace(/[^a-z0-9]/g, '')
}
function genericWords(s: string | null | undefined) {
  return new Set(String(s || '').toLowerCase().replace(/\s[-–(].*$/, '').match(GENERIC) || [])
}
function compatible(a: string, b: string) {
  const wa = genericWords(a), wb = genericWords(b)
  if (wa.size === 0 || wb.size === 0) return true
  return [...wa].every((w) => wb.has(w)) || [...wb].every((w) => wa.has(w))
}

export function buildIndex<V extends MatchVendor>(vendors: V[]): Index<V> {
  const index: Index<V> = new Map()
  for (const v of vendors) {
    for (const n of [v.name, v.lightspeed_name, ...(v.aliases || [])]) {
      const k = n && nameKey(n)
      if (k && !index.has(k)) index.set(k, v)
    }
  }
  return index
}

export function findVendor<V extends MatchVendor>(index: Index<V>, name: string): { vendor: V; how: MatchHow } | null {
  const k = nameKey(name)
  if (!k) return null
  if (index.has(k)) return { vendor: index.get(k)!, how: 'exact' }
  const gk = genericKey(name)
  if (gk && gk.length >= 4) {
    if (!index.generic) {
      index.generic = new Map()
      for (const [ik, v] of index) { const g = genericKey(v.name) || ik; if (!index.generic.has(g)) index.generic.set(g, v); if (!index.generic.has(ik)) index.generic.set(ik, v) }
    }
    const gv = index.generic.get(gk)
    if (gv && compatible(name, gv.name)) return { vendor: gv, how: 'generic' }
  }
  if (k.length >= 6) {
    const pref = [...index.keys()].filter((ik) => ik.length >= 6 && (ik.startsWith(k) || k.startsWith(ik)) && Math.min(ik.length, k.length) / Math.max(ik.length, k.length) >= 0.75)
    if (pref.length === 1) return { vendor: index.get(pref[0])!, how: 'prefix' }
  }
  return null
}
