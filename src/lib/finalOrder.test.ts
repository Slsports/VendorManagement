import { describe, expect, it } from 'vitest'
import { buildFinalOrder, finalOrderEmail, isFieldRow, itemOf, priceFlag, qtyIn, rowQtys } from './finalOrder'

const lines = [
  { vendor_item_id: 'BG81', description: 'Air Pad', quantity: 8, unit_cost: 9.5 },
  { vendor_item_id: '983', description: 'Self Inflating Mattress', quantity: 8, unit_cost: 20 },
  { vendor_item_id: 'QAC-ROCKER', description: 'Rocker Chair', quantity: 4, unit_cost: 30 },
  { vendor_item_id: 'GZ37', description: 'Stars & Stripes Gazebo', quantity: 24, unit_cost: 50 },
]
const rows = [
  { what: 'BG81 Air Pad', ours: '18', theirs: '8', ok: false, note: 'Short 10' },
  { what: '983 Self Inflating Mattress', ours: '12', theirs: '8', ok: false, note: null },
  { what: 'QAC-ROCKER Rocker Chair', ours: null, theirs: '4', ok: false, note: 'Not ordered' },
  { what: 'GZ32-BLUE Gazebo Blue', ours: '12', theirs: null, ok: false, note: 'Missing' },
  { what: 'GZ37 Stars & Stripes Gazebo', ours: '24', theirs: '24', ok: true, note: null },
  { what: 'Freight', ours: 'Free over $2,500', theirs: '50% prepaid', ok: false, note: null },
]

describe('the final confirmed order (Oct 16)', () => {
  it('reads quantities and knows header rows', () => {
    expect(qtyIn('144 at $0.15 = $21.60')).toBe(144)
    expect(qtyIn('1,200')).toBe(1200)
    expect(qtyIn(null)).toBeNull()
    expect(isFieldRow({ what: 'Freight' })).toBe(true)
    expect(isFieldRow({ what: 'Ship date' })).toBe(true)
    expect(isFieldRow({ what: 'BG81 Air Pad' })).toBe(false)
    expect(rowQtys(rows[3]!, undefined).final).toBe(12)
    expect(rowQtys(rows[0]!, { ok: true }).final).toBe(8)
    expect(itemOf({ what: '(no ID) Umbrella for chair GREEN' }, lines)).toEqual({ item: '', name: 'Umbrella for chair GREEN' })
    expect(itemOf({ what: 'X-LITE ultra lite bag (confirmation: X-LITE GREY/BLACK)' }, lines)).toEqual({ item: 'X-LITE', name: 'ultra lite bag' })
  })
  it('lists each change with the item number and name, and the whole final order', () => {
    const { items, changes } = buildFinalOrder(rows, { 'BG81 Air Pad': { qty: 18 }, '983 Self Inflating Mattress': { ok: true }, 'QAC-ROCKER Rocker Chair': { removed: true } }, lines)
    expect(changes).toEqual([
      { item: 'BG81', name: 'Air Pad', text: '8 → 18' },
      { item: 'QAC-ROCKER', name: 'Rocker Chair', text: 'please remove' },
      { item: 'GZ32-BLUE', name: 'Gazebo Blue', text: 'please add 12' },
    ])
    expect(items.map((i) => `${i.item} ${i.qty}`)).toEqual(['BG81 18', '983 8', 'GZ32-BLUE 12', 'GZ37 24'])
    const email = finalOrderEmail({ firstName: 'Dom', docNumber: 'S102112', po: null, items, changes })
    expect(email).toContain('- BG81 Air Pad: 8 → 18')
    expect(email).toContain('- QAC-ROCKER Rocker Chair: please remove')
    expect(email).toContain("Please reply to confirm this order. If any quantities don't fit your case packs, let me know so I can adjust and then we can finalize the order.")
    expect(email).toContain('- GZ37 Stars & Stripes Gazebo: 24 at $50.00')
    expect(email).not.toContain('Freight')
  })
})

describe('prices (Oct 16)', () => {
  it('flags their price more than 20% over our last cost, and asks only when ticked', () => {
    const r = { what: 'BG81 Air Pad', ours: '18', theirs: '18', ok: true, note: null, our_cost: 12, their_price: 15.95 }
    expect(priceFlag(r)).toEqual({ theirs: 15.95, ours: 12 })
    expect(priceFlag({ ...r, their_price: 14 })).toBeNull()
    expect(priceFlag({ ...r, our_cost: null })).toBeNull()
    expect(buildFinalOrder([r], {}, lines).changes).toEqual([])
    const asked = buildFinalOrder([r], { 'BG81 Air Pad': { askPrice: true } }, lines)
    expect(asked.changes[0]).toEqual({ item: 'BG81', name: 'Air Pad', text: 'your price $15.95 is quite a bit higher than we paid last time. Can you check it?' })
    expect(asked.items[0]?.cost).toBe(15.95)
  })
  it('never puts our cost on the final order', () => {
    const r = { what: 'ZZ9 Lantern', ours: '6 at $10.00', theirs: '6', ok: true, note: null, our_cost: 10, their_price: null }
    expect(buildFinalOrder([r], {}, []).items[0]?.cost).toBeNull()
  })

  it('says unavailable items in plain words and puts the replacement on the order (Dana, Oct 18)', () => {
    const lines = [{ vendor_item_id: '71237', description: 'GRAND SIERRA GLOVE LG', quantity: 0, unit_cost: null }, { vendor_item_id: '60894', description: 'NECK GAITER', quantity: 0, unit_cost: null }, { vendor_item_id: '33074', description: 'CAMO GLOVE', quantity: 12, unit_cost: 4 }]
    const rows = [
      { what: '71237 GRAND SIERRA GLOVE LG', ours: '12', theirs: '0', ok: false, note: null },
      { what: '60894 NECK GAITER', ours: '6', theirs: '0', ok: false, note: null },
      { what: '33074 CAMO GLOVE', ours: '12', theirs: '12', ok: true, note: null },
    ]
    const u = [
      { vendor_item_id: '71237', decision: 'replacement' as const, replacement_vendor_item_id: '71240', replacement_name: 'GRAND SIERRA GLOVE II LG', replacement_price: 12.5, back_date: null },
      { vendor_item_id: '60894', decision: 'out_of_stock' as const, replacement_vendor_item_id: null, replacement_name: null, replacement_price: null, back_date: '2026-11-15' },
    ]
    const f = buildFinalOrder(rows, {}, lines, [], u)
    expect(f.items.map((i) => [i.item, i.qty, i.cost])).toEqual([['71240', 12, 12.5], ['33074', 12, 4]])
    const email = finalOrderEmail({ firstName: 'Sam', docNumber: null, po: 'BECKER101826', items: f.items, changes: f.changes })
    expect(email).toContain('- 71237 GRAND SIERRA GLOVE LG was discontinued, replaced with 71240 GRAND SIERRA GLOVE II LG')
    expect(email).toContain('- 60894 NECK GAITER is out of stock, back 11/15/26')
  })

  it('never takes a number inside an item number as the quantity (Dana, Oct 18: Final showed 582)', () => {
    expect(qtyIn('TS582S qty 1 @ $10.45; PP582S qty 1 @ $13.95')).toBe(1)
    expect(qtyIn('TS582L qty 2; PP582L qty 2')).toBe(2)
    expect(qtyIn('qty 2 each')).toBe(2)
    expect(qtyIn('2 Womens Small')).toBe(2)
    expect(qtyIn('1 Mens XL (Sept 28 email)')).toBe(1)
    expect(qtyIn('144 at $0.15')).toBe(144)
    expect(qtyIn('KID5824T')).toBeNull()
    expect(qtyIn('12')).toBe(12)
  })
})
