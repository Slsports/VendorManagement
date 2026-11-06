import { describe, expect, it } from 'vitest'
import { buyCategories, pathLabel, wwdLines } from './vendorSells'

describe('what a vendor sells (Dana, Nov 6)', () => {
  it('lists our LS categories, most items still carried first, no-longer-carried last', () => {
    const r = buyCategories([
      { category_path: 'WINTERSPORTS/HELMETS', archived: false },
      { category_path: 'WINTERSPORTS/GOGGLES/ADULT', archived: false },
      { category_path: 'WINTERSPORTS/GOGGLES/ADULT', archived: false },
      { category_path: 'SUNGLASSES & ACCESSORIES', archived: true },
    ])
    expect(r.map((c) => [c.path, c.carried, c.items])).toEqual([
      ['WINTERSPORTS/GOGGLES/ADULT', 2, 2], ['WINTERSPORTS/HELMETS', 1, 1], ['SUNGLASSES & ACCESSORIES', 0, 1],
    ])
  })
  it("lists every Worldwide Product Line in Worldwide's words, once", () => {
    const r = wwdLines([
      { number: '10101', data: { product_lines: [{ category: 'ATHLETICS', lines: ['SPORTS'] }, { category: 'BOATING', lines: ['SUNGLASSES'] }] } },
      { number: '10102', data: { product_lines: [{ category: 'BOATING', lines: ['SUNGLASSES'] }] } },
      { number: null, data: null },
    ])
    expect(r.map((l) => `${l.category} › ${l.line}`)).toEqual(['ATHLETICS › SPORTS', 'BOATING › SUNGLASSES'])
  })
  it('shows a category path with arrows', () => {
    expect(pathLabel('WINTERSPORTS/GOGGLES/ADULT')).toBe('WINTERSPORTS › GOGGLES › ADULT')
  })
})
