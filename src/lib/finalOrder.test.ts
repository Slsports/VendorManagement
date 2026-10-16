import { describe, expect, it } from 'vitest'
import { buildFinalOrder, finalOrderEmail, isFieldRow, itemOf, qtyIn, rowQtys } from './finalOrder'

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
