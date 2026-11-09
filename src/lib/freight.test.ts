import { describe, expect, it } from 'vitest'
import { domainsFrom, orderShippingLine } from './freight'

describe('carrier email domains', () => {
  it('reads domains however they are typed', () => {
    expect(domainsFrom('XPO.com, @ltl.xpo.com https://www.estes-express.com/contact')).toEqual(['xpo.com', 'ltl.xpo.com', 'estes-express.com'])
    expect(domainsFrom('deliveryreceipt@xpo.com; xpo.com')).toEqual(['xpo.com'])
    expect(domainsFrom('not a domain')).toEqual([])
  })
})

describe('orderShippingLine', () => {
  it('says free, half, capped or the freight paid', () => {
    expect(orderShippingLine({ free_shipping: true, freight_cost: null })).toEqual({ text: 'Free freight', free: true })
    expect(orderShippingLine({ free_shipping: false, freight_terms: 'half', freight_cost: 120 })).toEqual({ text: '1/2 freight: $120.00', free: false })
    expect(orderShippingLine({ free_shipping: false, freight_terms: 'half', freight_cost: null })?.text).toBe('1/2 freight')
    expect(orderShippingLine({ free_shipping: false, freight_terms: 'capped', freight_cap_pct: 8, freight_cost: null })?.text).toBe('Freight capped 8%')
    expect(orderShippingLine({ free_shipping: null, freight_cost: 45.5 })?.text).toBe('+$45.50 freight')
    expect(orderShippingLine({ free_shipping: null, freight_cost: null })).toBeNull()
  })
})
