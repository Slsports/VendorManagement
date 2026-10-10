import type { VendorLinkKind } from '@/types'

// The vendor's Documents folders (Dana, Oct 8): each holds certain kinds of file, with a year folder inside.
export type DocFolder = 'price_lists' | 'catalogs' | 'orders' | 'ls_pos' | 'confirmations' | 'invoices' | 'credits' | 'order_forms' | 'specials' | 'shipping' | 'images' | 'proofs' | 'other'

export const DOC_FOLDERS: { id: DocFolder; label: string; kinds: VendorLinkKind[] }[] = [
  { id: 'price_lists', label: 'Price lists', kinds: ['price_list'] },
  { id: 'catalogs', label: 'Catalogs', kinds: ['catalog'] },
  // the four documents to an order (Dana, Oct 10): our order, the LS PO, the vendor's confirmation, the invoice
  { id: 'orders', label: 'Our orders', kinds: ['order'] },
  { id: 'ls_pos', label: 'LS POs', kinds: ['ls_po'] },
  { id: 'confirmations', label: 'Confirmations', kinds: ['confirmation'] },
  { id: 'invoices', label: 'Invoices', kinds: ['invoice', 'payment'] },
  { id: 'credits', label: 'Credits', kinds: ['credit'] },
  { id: 'order_forms', label: 'Order forms', kinds: ['order_form'] },
  { id: 'specials', label: 'Show specials', kinds: ['specials'] },
  { id: 'shipping', label: 'Shipping', kinds: ['packing_slip', 'delivery_receipt', 'freight_bill'] },
  { id: 'images', label: 'Images', kinds: ['image'] },
  // the final artwork proof, saved by hand once approved (Dana, Oct 10)
  { id: 'proofs', label: 'Approved proofs', kinds: ['approved_proof'] },
  { id: 'other', label: 'Other', kinds: ['other', 'website'] },
]

export function folderOf(kind: VendorLinkKind): DocFolder {
  return DOC_FOLDERS.find((f) => f.kinds.includes(kind))?.id ?? 'other'
}

/** The kind a file gets when put in a folder: its own kind when that already belongs there. */
export function kindFor(folder: DocFolder, current?: VendorLinkKind): VendorLinkKind {
  const f = DOC_FOLDERS.find((x) => x.id === folder)!
  return current && f.kinds.includes(current) ? current : f.kinds[0]!
}

export const folderLabel = (id: DocFolder) => DOC_FOLDERS.find((f) => f.id === id)!.label

/** Years for the year picker: next year back to six years ago. */
export function yearChoices(now = new Date()): number[] {
  const y = now.getFullYear()
  return Array.from({ length: 8 }, (_, i) => y + 1 - i)
}

/** Files grouped by year, newest year first. */
export function byYear<T extends { doc_year: number | null }>(rows: T[]): [number | null, T[]][] {
  const m = new Map<number | null, T[]>()
  for (const r of rows) m.set(r.doc_year, [...(m.get(r.doc_year) ?? []), r])
  return [...m.entries()].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0))
}

export const thisYear = () => new Date().getFullYear()
export const todayIso = () => new Date().toISOString().slice(0, 10)

const GUESS: [DocFolder, RegExp][] = [
  ['shipping', /packing ?(slip|list)|\bbol\b|bill of lading|delivery receipt|proof of delivery|\bpod\b|tracking/i],
  ['credits', /credit|\bcm\b ?\d|\brma\b|return authori[sz]ation/i],
  ['confirmations', /order ?confirm|confirmation|acknowledg|\bso\b ?#? ?\d|sales ?order|pro ?forma/i],
  ['ls_pos', /\bls ?po\b|lightspeed/i],
  ['invoices', /invoice|\binv\b|statement|receipt|remittance/i],
  ['orders', /purchase ?order|\bpo\b ?#? ?\d/i],
  ['order_forms', /order ?(form|writer|sheet)|reorder|booking form/i],
  ['price_lists', /price ?(list|sheet|book)|pricing|\bmsrp\b|wholesale/i],
  ['specials', /special|promo|close ?out|clearance|show (offer|program)|buy group/i],
  ['catalogs', /catalog|catalogue|line ?sheet|look ?book|brochure|collection/i],
  ['proofs', /\bproofs?\b|mock ?up|virtual sample|art ?approval/i],
  // pictures with no other clue (Dana, Oct 10: "we need an images folder")
  ['images', /\b(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i],
]

/** The folder an email attachment most likely belongs in, from its file name and the subject. */
export function guessFolder(fileName: string, subject?: string | null): DocFolder {
  const name = fileName.replace(/[_\-.]+/g, ' ')
  for (const [f, re] of GUESS) if (re.test(name)) return f
  for (const [f, re] of GUESS) if (re.test(subject ?? '')) return f
  return 'other'
}

/** A picture file (not HEIC, which browsers cannot show). */
export const isPictureFile = (f: { file_name: string | null; mime_type: string | null }) =>
  /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.mime_type ?? '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.file_name ?? '')
