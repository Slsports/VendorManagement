// Vendor IDs read from a vendor's paper. Pure, shared by order-check (through ai.ts) and the tests.

/**
 * An Item Code the paper cut off ("PS 317 BL...") stops where the print stops: "PS 317 BL" (Dana, Oct 24), also before
 * a "/design #" added after it.
 */
export function cutOffVids<T extends { lines: { vendor_item_id?: string | null }[] }>(r: T): T {
  for (const l of r.lines) {
    if (l.vendor_item_id) l.vendor_item_id = l.vendor_item_id.replace(/\s*(\.{2,}|…)\s*(?=\/|$)/g, '').trim() || null
  }
  return r
}
