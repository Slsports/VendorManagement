import { describe, expect, it } from 'vitest'
import { categorySuggestions } from './reviews'

describe('category rule suggestions', () => {
  it('top levels and subcategories, starts-with first, one per name', () => {
    const cats = ['Camping', 'Camping/Coolers', 'Camping/Lighting', 'Sunglasses', 'Sunglasses/Goggles', 'Hunting/Airguns']
    expect(categorySuggestions('camp', cats)).toEqual(['CAMPING', 'Camping/Coolers', 'Camping/Lighting'])
    expect(categorySuggestions('sun', cats)).toEqual(['Sunglasses', 'SUNGLASSES & ACCESSORIES', 'Sunglasses/Goggles'])
    expect(categorySuggestions('air', cats)).toEqual(['Hunting/Airguns'])
  })
})
