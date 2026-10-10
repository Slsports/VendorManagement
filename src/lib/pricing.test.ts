import { describe, expect, it } from 'vitest'
import { breakdown, DEFAULT_PRICING, hasWwdUpcharge, freightPct, parsePastedLines, pct, pricingSettings, retailPrice } from './pricing'

describe('check-in pricing (Dana, Oct 8)', () => {
  it('freight is a percent of the product invoice', () => {
    expect(freightPct(100, 1000)).toBe(10)
    expect(freightPct(null, 1000)).toBeNull()
    expect(freightPct(50, 0)).toBeNull()
  })
  it('adds margin, freight and the WWD upcharge', () => {
    expect(breakdown(DEFAULT_PRICING, 100, 1000, true)).toEqual({ marginPct: 55, freightPct: 10, upchargePct: 1.5, totalPct: 66.5 })
    expect(breakdown(DEFAULT_PRICING, 100, 1000, false).totalPct).toBe(65)
    expect(breakdown(DEFAULT_PRICING, null, 1000, true).totalPct).toBe(56.5)
    // Worldwide's pallet rate is used as the freight % for each vendor on the pallet.
    expect(breakdown(DEFAULT_PRICING, 100, 1000, true, 10.7).totalPct).toBeCloseTo(67.2)
  })
  it('prices as a true margin, exact to the cent: a $5 toy at 66.5% is $14.93', () => {
    expect(retailPrice(5, 66.5)).toBe(14.93)
    expect(retailPrice(10, 55)).toBe(22.22)
    expect(retailPrice(5, 100)).toBeNull()
  })
  it('reads the settings, with defaults', () => {
    expect(pricingSettings({ pricing: { margin_pct: 50 } })).toEqual({ margin_pct: 50, wwd_upcharge_pct: 1.5 })
    expect(pricingSettings(null)).toEqual(DEFAULT_PRICING)
    expect(pct(66.5)).toBe('66.5%')
    expect(pct(10)).toBe('10%')
  })
  it('reads lines pasted from a spreadsheet', () => {
    expect(parsePastedLines('Vendor ID\tItem\tQty\tCost\nTOY-1\tBouncy ball\t12\t$5.00\nTOY-2\tKite\t6\t8.5\n')).toEqual([
      { vendor_item_id: 'TOY-1', description: 'Bouncy ball', quantity: 12, unit_cost: 5 },
      { vendor_item_id: 'TOY-2', description: 'Kite', quantity: 6, unit_cost: 8.5 },
    ])
  })
  it('WWD upcharge: billed through WWD and not a 0% vendor', () => {
    const v = (zero: boolean, routes: string[]) => ({ wwd_zero_upcharge: zero, vendor_billing_routes: routes.map((route) => ({ route })) })
    expect(hasWwdUpcharge({ billing_route: 'worldwide', vendor: v(false, []) })).toBe(true)
    expect(hasWwdUpcharge({ billing_route: 'worldwide', vendor: v(true, ['worldwide']) })).toBe(false)
    expect(hasWwdUpcharge({ billing_route: 'direct', vendor: v(false, ['worldwide']) })).toBe(false)
    expect(hasWwdUpcharge({ billing_route: null, vendor: v(false, ['worldwide']) })).toBe(true)
  })
})
