// Retail pricing at check-in (Dana, Oct 8). Freight % = freight ÷ product invoice; total % = margin +
// freight % + the WWD upcharge when the vendor carries it; retail = item cost ÷ (1 − total %), a true
// margin ($5.00 at 66.5% = $14.93). The exact number, rounded to the cent; Trevor edits any price.

export interface PricingSettings { margin_pct: number; wwd_upcharge_pct: number }
export const DEFAULT_PRICING: PricingSettings = { margin_pct: 55, wwd_upcharge_pct: 1.5 }

export function pricingSettings(settings: unknown): PricingSettings {
  const p = (settings as { pricing?: Partial<PricingSettings> } | null)?.pricing ?? {}
  return {
    margin_pct: typeof p.margin_pct === 'number' ? p.margin_pct : DEFAULT_PRICING.margin_pct,
    wwd_upcharge_pct: typeof p.wwd_upcharge_pct === 'number' ? p.wwd_upcharge_pct : DEFAULT_PRICING.wwd_upcharge_pct,
  }
}

/** Freight as a percent of the product invoice, or null when there is no freight bill yet or no product cost. */
export function freightPct(freight: number | null | undefined, productTotal: number): number | null {
  if (freight === null || freight === undefined || !(productTotal > 0)) return null
  return (freight / productTotal) * 100
}

export interface PriceBreakdown { marginPct: number; freightPct: number | null; upchargePct: number; totalPct: number }

/** ratePct: freight quoted as a percent (a Worldwide pallet, 10.7%) wins over freight cost ÷ product. */
export function breakdown(s: PricingSettings, freight: number | null | undefined, productTotal: number, wwdUpcharge: boolean, ratePct?: number | null): PriceBreakdown {
  const f = ratePct !== null && ratePct !== undefined ? ratePct : freightPct(freight, productTotal)
  const up = wwdUpcharge ? s.wwd_upcharge_pct : 0
  return { marginPct: s.margin_pct, freightPct: f, upchargePct: up, totalPct: s.margin_pct + (f ?? 0) + up }
}

/** Retail for one item at a total percent, to the cent. Null when the percent leaves nothing to divide by. */
export function retailPrice(unitCost: number, totalPct: number): number | null {
  if (!(unitCost >= 0) || totalPct >= 100) return null
  const raw = unitCost / (1 - totalPct / 100)
  return Math.round((raw + Number.EPSILON) * 100) / 100
}

/** Worldwide's upcharge applies when the order is billed through WWD (or, with no route on the order, the
 * vendor is a WWD vendor) and the vendor is not one of the 0% upcharge vendors. */
export function hasWwdUpcharge(o: { billing_route: string | null; vendor: { wwd_zero_upcharge: boolean; vendor_billing_routes: { route: string }[] } | null }): boolean {
  if (!o.vendor || o.vendor.wwd_zero_upcharge) return false
  return o.billing_route ? o.billing_route === 'worldwide' : o.vendor.vendor_billing_routes.some((r) => r.route === 'worldwide')
}

export const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1).replace(/\.0$/, '')}%`)

/** Paste from a spreadsheet: Vendor ID, description, quantity, unit cost (tabs or commas; a header row is skipped). */
export function parsePastedLines(text: string): { vendor_item_id: string | null; description: string | null; quantity: number; unit_cost: number }[] {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const cells = (raw.includes('\t') ? raw.split('\t') : raw.split(',')).map((c) => c.trim())
    const num = (s: string | undefined) => Number((s ?? '').replace(/[$,\s]/g, ''))
    const [id, desc, qty, cost] = cells
    if (!Number.isFinite(num(qty)) || !Number.isFinite(num(cost)) || cells.length < 4) continue
    out.push({ vendor_item_id: id || null, description: desc || null, quantity: num(qty) || 1, unit_cost: num(cost) })
  }
  return out
}
