import { describe, expect, it } from 'vitest'
import { searchVendors, vendorMatchRank } from './vendorSearch'

const vendors = [
  { name: 'PARICON', aliases: ['PARICON - WWD'], is_active: true },
  { name: 'SMITH OPTICS - SUNCLOUD OPTICS', aliases: ['SMITH OPTICS - SUNCLOUD OPTICS - WWD'], is_active: true },
  { name: 'WORLDWIDE', aliases: ['Worldwide Warehouse', 'WWD', 'WDI'], is_active: true },
  { name: 'ANNGOTI', aliases: [], parent_company: 'JollyBuyer', is_active: true },
  { name: 'OLD WWD THING', aliases: [], is_active: false },
]

describe('finding a vendor by what you type (Dana, Nov 6)', () => {
  it('puts Worldwide first for wwd, ahead of every "- WWD" vendor', () => {
    expect(searchVendors(vendors, 'wwd')[0]?.name).toBe('WORLDWIDE')
    expect(searchVendors(vendors, 'WWD').map((v) => v.name)).toContain('PARICON')
  })
  it('finds a vendor by an other name the top bar used to miss', () => {
    expect(searchVendors(vendors, 'wdi').map((v) => v.name)).toEqual(['WORLDWIDE'])
    expect(vendorMatchRank(vendors[2]!, 'warehouse')).not.toBeNull()
  })
  it('still finds by name and by parent company', () => {
    expect(searchVendors(vendors, 'smith')[0]?.name).toBe('SMITH OPTICS - SUNCLOUD OPTICS')
    expect(searchVendors(vendors, 'jolly').map((v) => v.name)).toEqual(['ANNGOTI'])
  })
  it('lists inactive vendors after active ones, unless typed exactly', () => {
    const r = searchVendors(vendors, 'wwd').map((v) => v.name)
    expect(r.indexOf('OLD WWD THING')).toBe(r.length - 1)
  })
})
