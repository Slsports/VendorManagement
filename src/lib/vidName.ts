// Vendor ID in item names (Dana, Oct 10): on per vendor, changeable per order and per item. Since Trevor's naming SOP
// (SOP-INV-001-NC, Oct 19) it goes last after a single space, no brackets: "LAZY ONE MENS PAJAMA SET BLUE 2XL PJ5512".

/** The item's setting: its own, else the order's, else the vendor's. */
export function vidOn(vendor: boolean | null | undefined, order: boolean | null | undefined, line?: boolean | null): boolean {
  return line ?? order ?? vendor ?? false
}

/** The description as it goes into LS: with " VENDORID" at the end when on (never twice; an old "[ID]" is replaced). */
export function itemName(description: string | null | undefined, vendorItemId: string | null | undefined, on: boolean): string {
  const d = (description ?? '').trim()
  const vid = (vendorItemId ?? '').trim()
  if (!on || !vid) return d
  const base = d.replace(new RegExp(`\\s*\\[${vid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]$`, 'i'), '')
  if (base.toUpperCase() === vid.toUpperCase() || base.toUpperCase().endsWith(` ${vid.toUpperCase()}`)) return base
  return base ? `${base} ${vid}` : vid
}
