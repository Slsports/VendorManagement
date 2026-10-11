// Bulk import of old vendor documents (Dana, Oct 8): what the Dropbox folder path says about a file. Dana
// files as "<Vendor>/<Folder>/<Year>/file" ("Stansport/Invoices/2024/INV 1.pdf", "Planet Cotton/Catalogs/2027").
// The vendor is the first folder name that matches a VMS vendor; the folder and year come from the folder
// names, then the file name. What the path cannot settle, Claude reads; a person reviews every row.
import { buildVendorIndex, shipperVendors, type VendorIndex, type VendorRef } from '../../supabase/functions/_shared/mailMatch.ts'
import type { DocFolder } from '@/lib/documents'

export type { VendorIndex }

const FOLDER_WORDS: [DocFolder, RegExp][] = [
  ['shipping', /packing ?(slip|list)s?|\bbols?\b|bills? of lading|delivery receipts?|proof of delivery|\bpods?\b|freight|shipping|tracking/i],
  ['credits', /credits?|credit memos?|\bcms?\b|\brmas?\b|return authori[sz]ations?/i],
  ['confirmations', /confirmations?|acknowledg(e?ments?)?|\backs?\b|sales orders?/i],
  ['ls_pos', /\bls ?pos?\b|lightspeed/i],
  ['invoices', /invoices?|\binv\b|statements?|receipts?|remittances?|payments?|paid|billing|bills\b/i],
  ['order_forms', /order ?(forms?|writers?|sheets?)|reorder|booking forms?/i],
  ['orders', /\borders?\b|\bpos?\b|purchase orders?/i],
  ['price_lists', /price ?(lists?|sheets?|books?)|pricing|\bmsrp\b|wholesale|\bprices?\b/i],
  ['specials', /specials?|promos?|promotions?|close ?outs?|clearance|show (offers?|programs?|deals?)|buy group|deals?/i],
  ['catalogs', /catalogs?|catalogues?|line ?sheets?|look ?books?|brochures?|collections?|new arrivals/i],
  ['damaged', /damaged?( items?)?|broken|defects?/i],
  ['proofs', /approved proofs?|final proofs?|\bproofs?\b/i],
  ['images', /\bimages?\b|photos?|pictures?|\bpics?\b|artwork|logos?\b/i],
  ['other', /^(other|misc|miscellaneous|general|docs?|documents?|files?)$/i],
]

/** "Invoices" → invoices, "2024 Price Lists" → price_lists; null when the name says nothing about the folder. */
export function folderFromName(name: string): DocFolder | null {
  const n = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-.]+/g, ' ').trim()
  for (const [f, re] of FOLDER_WORDS) if (re.test(n)) return f
  return null
}

/** A year in a folder or file name: "2024", "FY2023", "Fall 2026", "INV_2025-03-01". */
export function yearFromName(name: string): number | null {
  const m = name.match(/(?:^|[^0-9])(19[9]\d|20\d\d)(?:[^0-9]|$)/)
  return m ? Number(m[1]) : null
}

const squeeze = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')

export interface MatchVendor extends VendorRef { is_active: boolean }

export interface VendorMatcher { index: VendorIndex; exact: Map<string, string[]> }

export function vendorMatcher(vendors: MatchVendor[]): VendorMatcher {
  const exact = new Map<string, string[]>()
  for (const v of vendors) for (const n of [v.name, ...v.aliases]) {
    const k = squeeze(n)
    if (k.length >= 2) exact.set(k, [...new Set([...(exact.get(k) ?? []), v.id])])
  }
  return { index: buildVendorIndex(vendors, ['Shaver Lake']), exact }
}

/** The vendors a folder name means: the exact name or alias first, then the name matcher. */
export function vendorsForName(m: VendorMatcher, name: string): string[] {
  const hit = m.exact.get(squeeze(name))
  if (hit) return hit
  return shipperVendors(m.index, name)
}

export interface PathGuess {
  vendorId: string | null
  /** Several vendors match the folder name; a person picks. */
  vendorChoices: string[]
  folder: DocFolder | null
  year: number
  yearFromFile: boolean
  sure: boolean
}

export function guessFromPath(path: string, lastModified: number, m: VendorMatcher): PathGuess {
  const parts = path.split('/').filter(Boolean)
  const fileName = parts.pop() ?? path
  let vendorId: string | null = null
  let vendorChoices: string[] = []
  for (const dir of parts) {
    if (yearFromName(dir) && /^\W*(fy)?\s*\d{4}\W*$/i.test(dir)) continue
    if (folderFromName(dir) && !m.exact.has(squeeze(dir))) continue
    const ids = vendorsForName(m, dir)
    if (ids.length === 1) { vendorId = ids[0]!; vendorChoices = []; break }
    if (ids.length > 1 && !vendorChoices.length) vendorChoices = ids
  }
  let folder: DocFolder | null = null
  for (const dir of [...parts].reverse()) { folder = folderFromName(dir); if (folder) break }
  folder ??= folderFromName(fileName)
  let year: number | null = null
  for (const dir of [...parts].reverse()) { year = yearFromName(dir); if (year) break }
  year ??= yearFromName(fileName)
  const yearFromFile = !year
  return { vendorId, vendorChoices, folder, year: year ?? new Date(lastModified).getFullYear(), yearFromFile, sure: !!vendorId && !!folder }
}

/** Files worth importing: not system junk (.DS_Store, Thumbs.db, ~$ lock files, hidden files). */
export function isImportable(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  return !!name && !name.startsWith('.') && !name.startsWith('~$') && !/^(thumbs\.db|desktop\.ini|icon\r?)$/i.test(name) && !path.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')
}
