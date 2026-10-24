// The PO on a vendor's confirmation against ours (Dana, Oct 20). Our PO is the vendor's PO code + the order date,
// YAKIMA080626 (Oct 13), typed by hand as letters for the vendor then the date; the same rules run in SQL
// (po_check_state) for the task and the email.

export type PoState = 'ours' | 'fits' | 'missing' | 'not_ours' | 'off'

/** Letters and digits only, capitals: "yakt-101226 early buy" → "YAKT101226EARLYBUY". */
export const poNorm = (p: string | null | undefined) => (p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export const isRealPo = (p: string | null | undefined) => !!p && poNorm(p).length >= 3 && !/^\s*(n\/?a|none|tbd|pending|na|no po)\s*$/i.test(p)

/** The vendor part of our PO when none is set: the name squeezed together when short, else its first word (as po_code_default). */
export function poCodeDefault(name: string): string {
  const s = name.replace(/\s*[-(]\s*(wwd|faire).*$/i, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase()
  const squeezed = s.replace(/ /g, '')
  if (squeezed.length <= 12) return squeezed
  const first = s.trim().split(' ')[0] ?? ''
  return first.length >= 4 ? first : squeezed.slice(0, 12)
}

/**
 * Ours written another way (Dana, Oct 24): the same vendor letters (or one starts the other, 4+ letters) and the same
 * date with or without leading zeros. OKUMA9126 = OKUMA090126; PLANET101926 = PLANETCOTTON101926. As po_same in SQL.
 */
export function poSame(theirs: string | null | undefined, ours: string | null | undefined): boolean {
  const t = /^([A-Z]+)([0-9]+)/.exec(poNorm(theirs))
  const o = /^([A-Z]+)([0-9]{6})/.exec(poNorm(ours))
  if (!t || !o) return false
  const [tl, td] = [t[1]!, t[2]!]
  const [ol, od] = [o[1]!, o[2]!]
  const letters = tl === ol || (Math.min(tl.length, ol.length) >= 4 && (ol.startsWith(tl) || tl.startsWith(ol)))
  const z = (s: string) => s.replace(/^0/, '')
  const [m, d, y] = [od.slice(0, 2), od.slice(2, 4), od.slice(4)]
  return letters && [od, z(m) + d + y, m + z(d) + y, z(m) + z(d) + y].includes(td)
}

/** What their PO is, and an example of ours for the vendor (code + the order date, else today, as MMDDYY). */
export function poState(theirs: string | null | undefined, ours: string | null | undefined, vendor: { name: string; po_code: string | null } | null, orderDate?: string | null): { state: PoState; example: string | null } {
  const code = vendor ? (vendor.po_code?.trim() || poCodeDefault(vendor.name)) : null
  const d = orderDate ? new Date(`${orderDate}T12:00:00`) : new Date()
  const example = code ? `${poNorm(code)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getFullYear()).slice(2)}` : null
  if (!isRealPo(theirs)) return { state: 'missing', example }
  if (isRealPo(ours)) return { state: poNorm(theirs).includes(poNorm(ours)) || poSame(theirs, ours) ? 'ours' : 'not_ours', example }
  // with a PO abbreviation on the vendor, ours start with it (Dana, Oct 20: WFS101526, PLANET51026); without one, letters
  // for the vendor then the date, as people type it: LUXPRO9226, Panthermrtn9126 (Oct 20 back-check)
  const set = vendor?.po_code?.trim()
  if (set ? new RegExp(`^${poNorm(set)}[0-9]{4,6}`).test(poNorm(theirs)) : /^[A-Z]{2,}[0-9]{4,6}/.test(poNorm(theirs))) return { state: 'fits', example }
  return { state: 'off', example }
}
