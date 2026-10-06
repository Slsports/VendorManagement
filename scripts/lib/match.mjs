// Shared name matching for import scripts: find an existing vendor for a line name.
// Exact key match on name / Lightspeed name / aliases, then a unique prefix match.
const STOP = /\b(inc|llc|co|corp|corporation|company|ltd|usa|the|intl|international|dist|distributors|enterprises|ent|mfg|manufacturing|sales|products|brands|group)\b/g

/** Loose key: lower-case, drop a rep/parent tag after " - " or "(", drop stop words and punctuation. */
export function nameKey(s) {
  return String(s || '').toLowerCase().replace(/\s[-–(].*$/, '').replace(STOP, '').replace(/[^a-z0-9]/g, '')
}

/** Strict key as the database computes it (vendor_directory.name_key). */
export function dbKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/gi, '')
}

export function buildIndex(vendors) {
  const index = new Map()
  for (const v of vendors) {
    for (const n of [v.name, v.lightspeed_name, ...(v.aliases || [])]) {
      const k = n && nameKey(n)
      if (k && !index.has(k)) index.set(k, v)
    }
  }
  return index
}

// Words that reps and show programs add to a brand name without changing who it is.
const GENERIC = /\b(outdoor|outdoors|fishing|tackle|companies|supply|knives|belts|footwear|footcare|pet|treats|toys|games|apparel|sweets|snacks)\b/g
function genericKey(s) {
  return String(s || '').toLowerCase().replace(/\s[-–(].*$/, '').replace(STOP, '').replace(GENERIC, '').replace(/[^a-z0-9]/g, '')
}
/** The generic words a name carried, so "Eastman Footwear Group" never equals "Eastman Outdoors". */
function genericWords(s) {
  return new Set((String(s || '').toLowerCase().replace(/\s[-–(].*$/, '').match(GENERIC) || []))
}
function compatible(a, b) {
  const wa = genericWords(a), wb = genericWords(b)
  if (wa.size === 0 || wb.size === 0) return true
  return [...wa].every((w) => wb.has(w)) || [...wb].every((w) => wa.has(w))
}

export function findVendor(index, name) {
  const k = nameKey(name)
  if (!k) return null
  if (index.has(k)) return { vendor: index.get(k), how: 'exact' }
  // "Buck Knives" = BUCK, "Eagle Claw Fishing Tackle" = EAGLE CLAW: same key once generic words go.
  const gk = genericKey(name)
  if (gk && gk.length >= 4) {
    if (!index.generic) {
      index.generic = new Map()
      for (const [ik, v] of index) { const g = genericKey(v.name) || ik; if (!index.generic.has(g)) index.generic.set(g, v); if (!index.generic.has(ik)) index.generic.set(ik, v) }
    }
    const gv = index.generic.get(gk)
    if (gv && compatible(name, gv.name)) return { vendor: gv, how: 'generic' }
  }
  // Prefix only when both sides are substantial and the shorter covers most of the longer:
  // "coghlans" ~ "coghlan" yes; "mountain" ~ "mountainsmith" no; "ace" ~ "acecamp" no.
  // A missed link is cheap (Dana links it by hand); a wrong link is not.
  if (k.length >= 6) {
    const pref = [...index.keys()].filter((ik) => ik.length >= 6 && (ik.startsWith(k) || k.startsWith(ik)) && Math.min(ik.length, k.length) / Math.max(ik.length, k.length) >= 0.75)
    if (pref.length === 1) return { vendor: index.get(pref[0]), how: 'prefix' }
  }
  return null
}

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

export function die(msg) { console.error(msg); process.exit(1) }
