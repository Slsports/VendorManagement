// Vendor ID in item names (Dana, Oct 10): on per vendor, changeable per order and per item; when on, the
// Vendor ID goes at the end in brackets: "MENS HOODIE NAVY [AB1234]".

/** The item's setting: its own, else the order's, else the vendor's. */
export function vidOn(vendor: boolean | null | undefined, order: boolean | null | undefined, line?: boolean | null): boolean {
  return line ?? order ?? vendor ?? false
}

/** The description as it goes into LS: with " [Vendor ID]" at the end when on (never twice). */
export function itemName(description: string | null | undefined, vendorItemId: string | null | undefined, on: boolean): string {
  const d = (description ?? '').trim()
  const vid = (vendorItemId ?? '').trim()
  if (!on || !vid) return d
  const tag = `[${vid}]`
  if (d.toUpperCase().endsWith(tag.toUpperCase())) return d
  return d ? `${d} ${tag}` : tag
}
