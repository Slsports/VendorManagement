// Shared cell readers for Dana's order sheets (Seasonal Buying Guide, Placed Order Summary).

const REP_TAG = /\s[-–]\s*(dandylines|arlene oom.*|manuf exchange|starlight|toyology|normark|ebay|faire|top pick global|eastern.*|l-bow|g\. pucci.*|reef|litezall|mukluks|coleman|sunny.*|northside|kai usa|industrial revolution|grandpa gus|enchanted moments)$/i

/** "ACE - TOYOLOGY" → "ACE", "A-ONE (Sunny @ Manuf. Exchange)" → "A-ONE". */
export const cleanName = (n) => n.replace(REP_TAG, '').replace(/\s*\(.*\)$/, '').trim()

/** 8/20/25, 8/20/2025 or an Excel serial → 2025-08-20; null when it is not a real date ("6/31/2026"). */
export function toDate(s) {
  if (!s) return null
  s = String(s).trim()
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10) }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!m) return null
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  if (y < 2000 || y > 2100) return null
  const iso = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  return new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso ? iso : null
}

export function toMoney(s) { if (!s) return null; const m = String(s).replace(/[,$\s]/g, '').match(/^-?\d+(\.\d+)?$/); return m ? Number(m[0]) : null }

export function yn(s) { return /^y/i.test(String(s || '').trim()) }

export function stores(s) {
  const t = String(s || '').toUpperCase()
  if (!t || t === '?') return []
  if (/\bALL\b/.test(t)) return ['SLS', 'SLH', 'SLM', 'GS']
  const out = new Set()
  if (/SLS|TOWN/.test(t)) out.add('SLS')
  if (/SLH/.test(t)) out.add('SLH')
  if (/SLM|MARINA/.test(t)) out.add('SLM')
  if (/HAPPY|\bHC\b|\bGS\b/.test(t)) out.add('GS')
  return [...out]
}

// Show windows (decisions log): spring late Jan–mid Feb, fall late Aug–early Sept; WWD orders up to 60 days after count.
export function showFor(dateStr, isWwd) {
  if (!dateStr || !isWwd) return null
  const d = new Date(dateStr + 'T00:00:00Z'); const y = d.getUTCFullYear()
  const windows = [
    { code: `wwd_spring_${y}`, from: Date.UTC(y, 0, 25), to: Date.UTC(y, 1, 20) },
    { code: `wwd_fall_${y}`, from: Date.UTC(y, 7, 20), to: Date.UTC(y, 8, 10) },
    { code: `wwd_fall_${y - 1}`, from: Date.UTC(y - 1, 7, 20), to: Date.UTC(y - 1, 8, 10) },
  ]
  for (const w of windows) { const t = d.getTime(); if (t >= w.from && t <= w.to + 60 * 86400000) return { code: w.code, firm: t <= w.to + 30 * 86400000 } }
  return null
}
