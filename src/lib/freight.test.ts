import { describe, expect, it } from 'vitest'
import { domainsFrom } from './freight'

describe('carrier email domains', () => {
  it('reads domains however they are typed', () => {
    expect(domainsFrom('XPO.com, @ltl.xpo.com https://www.estes-express.com/contact')).toEqual(['xpo.com', 'ltl.xpo.com', 'estes-express.com'])
    expect(domainsFrom('deliveryreceipt@xpo.com; xpo.com')).toEqual(['xpo.com'])
    expect(domainsFrom('not a domain')).toEqual([])
  })
})
