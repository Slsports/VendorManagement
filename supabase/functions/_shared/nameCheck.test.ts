import { describe, expect, it } from 'vitest'
import { namesToCheck, namesVendor } from './nameCheck.ts'

const email = (subject: string, body = '', from = 'Patti Johansen') => ({ id: 'e1', subject, body_text: body, from_name: from, files: [] })

describe('another name re-checks the old mail', () => {
  it('looks for the added name the way mail matching reads it', () => {
    const r = namesToCheck({ vendor_id: 'v', vendor_name: 'BLOKEES', aliases: ['SUNNY PALS - WWD'], added: ['SUNNY PALS - WWD'], removed: [] }, ['Shaver Lake'])
    expect(r.added).toEqual(['sunny pals'])
    expect(namesVendor(r.full, 'v', email('Show specials', 'We now carry Sunny Pals swim toys'))).toBe(true)
    expect(namesVendor(r.full, 'v', email('Show specials', 'Nothing new'))).toBe(false)
  })
  it('a removed name: mail that named the vendor only by it no longer does; other names still count', () => {
    const r = namesToCheck({ vendor_id: 'v', vendor_name: 'BLOKEES', aliases: ['BLOKEES - TOYOLOGY'], added: [], removed: ['TOYOLOGY'] }, ['Shaver Lake'])
    expect(r.removed).toEqual(['toyology'])
    expect(namesVendor(r.full, 'v', email('Toyology Show Specials'))).toBe(false)
    expect(namesVendor(r.full, 'v', email('Blokees Price Increases 5/18'))).toBe(true)
  })
  it('a common word is no clue', () => {
    const r = namesToCheck({ vendor_id: 'v', vendor_name: 'ACME', aliases: ['Sports'], added: ['Sports'], removed: [] }, [])
    expect(r.added).toEqual([])
  })
})
