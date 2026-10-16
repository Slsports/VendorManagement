import { describe, expect, it } from 'vitest'
import { freeShipping, freightTier, portalDate, readPortalVendor, termsKey } from './wwdPortal'
import { buildIndex, findVendor } from './vendorMatch'
// @ts-expect-error plain JS helper shared with the import scripts
import * as scriptMatch from '../../../scripts/lib/match.mjs'

const crosman = {
  number: '1234', name: 'Crosman Corp',
  detail: { success: true, vendorDetail: {
    vendorAddress: { name: 'Crosman Corp', address1: 'PO Box 74708', address2: '', address3: '', city: 'Cleveland', state: 'OH', zip: '44194-4583', phone: '800-724-7486', fax: '' },
    poAddress: { name: 'Crosman Corp', address1: 'PO Box 74708', address2: '', address3: '', city: 'Cleveland', state: 'OH', zip: '44194-4583', phone: '800-724-7486', fax: '' },
    contactList: [
      { firstName: 'Dan', lastName: 'Gainor', jobTitle: 'Sales Manager', udf: '', category: '', email: 'DGainor@crosman.com', phone: '480-460-9134', mobile: '808-227-8887', geographicalArea: 'National' },
      { firstName: 'Harry', lastName: 'Spotts', jobTitle: 'Sales Rep', udf: '', category: 'Proactive Sales and Marketing', email: 'harryspotts@proactivesalesco.com', phone: '239-633-4162', mobile: '', geographicalArea: '' },
      { firstName: 'Ann', lastName: 'Lee', jobTitle: 'AR Contact', udf: '', category: '', email: 'not an email', phone: '', mobile: '', geographicalArea: '' },
    ],
    productLineList: [{ masterCategory: 'SHOOTING SPORTS', detailCategoryList: ['AIR GUNS & ACCESSORIES'] }],
    programList: [
      { name: 'Standard', year: '0', show: '   ', showDescription: '', discount1: 'Buy Group Price', discount2: '', discount3: '', discount4: '', billingTerms1: 'Net 30 Days', billingTerms2: '', billingTerms3: '', freightTerms1: 'Collect', freightTerms2: 'PPD $4000', freightTerms3: '', minimumOrder1: '$500         ', minimumOrder2: '  ', minimumOrder3: '', shippingPoints1: 'Rogers, AR      ', shippingPoints2: '', shippingPoints3: '', beginingShipDate: '0', endShipDate: '0', expirationDate: '0', uploadedDocumentList: [] },
      { name: 'SHOW', year: '2026', show: 'FAL', showDescription: 'Fall Show                ', discount1: '5% Off', billingTerms1: '2% 30 Net 60 Days', freightTerms1: 'FFA $1500', freightTerms2: '50% FA $750', minimumOrder1: '$1000', beginingShipDate: '20260901', endShipDate: '20261231', expirationDate: '20260930', uploadedDocumentList: [] },
    ],
    resourceList: [{ rebateProgram: 'N', liabilityInsurance: 'Yes', liabilityInsuranceAmount: '2000000', defectiveGoodsPolicy1: 'Call For RA', raRequired: 'Y', goodsReturnAddress1: 'Crosman Corp', goodsReturnAddress2: '7629 Routes 5 & 20', goodsReturnAddress3: 'Bloomfield, NY  14443', goodsReturnAddress4: '', defectiveCompensationMethod: 'Credit Memo' }],
    uploadedDocumentList: [{}, { FAL2026SHOW: [{ documentName: 'FALL26 OW.XLSX   ', documentDesc: 'Order Writer   ' }] }],
    brands: '<br><br>Brands: Crosman, Benjamin',
  } },
}

describe('readPortalVendor', () => {
  const v = readPortalVendor(crosman)!
  it('reads the address once (PO address only when different)', () => {
    expect(v.address).toEqual({ address: 'PO Box 74708', city: 'Cleveland', state: 'OH', postal_code: '44194-4583', phone: '800-724-7486', fax: null })
    expect(v.po_address).toBeNull()
  })
  it('reads people: own vs rep company, kinds, phones, bad emails dropped', () => {
    expect(v.contacts[0]).toMatchObject({ name: 'Dan Gainor', email: 'dgainor@crosman.com', company: null, territory: 'National', kind: 'rep', phones: [{ type: 'work', number: '480-460-9134' }, { type: 'cell', number: '808-227-8887' }] })
    expect(v.contacts[1]).toMatchObject({ company: 'Proactive Sales and Marketing', kind: 'rep' })
    expect(v.contacts[2]).toMatchObject({ email: null, kind: 'ap' })
    expect(v.email).toBe('dgainor@crosman.com')
  })
  it('reads the standard and show programs with dates, tiers and documents', () => {
    expect(v.programs[0]).toMatchObject({ key: 'standard', kind: 'standard', minimum_order: '$500', freight_terms: 'Collect; PPD $4000', shipping_points: 'Rogers, AR', expires_on: null })
    expect(v.programs[1]).toMatchObject({ key: 'FAL2026', kind: 'show', name: 'Fall Show 2026', season: 'Fall', year: 2026, expires_on: '2026-09-30', ship_begin: '2026-09-01', ship_end: '2026-12-31', documents: [{ name: 'FALL26 OW.XLSX', description: 'Order Writer' }] })
    expect(v.standard).toEqual({ minimum_order: '$500', billing_terms: 'Net 30 Days', freight_program: 'Collect; PPD $4000', free_shipping_policy: 'sometimes', free_shipping_threshold: 4000 })
  })
  it('keeps one program per brand when a vendor lists several Standard programs', () => {
    const two = readPortalVendor({ ...crosman, detail: { vendorDetail: { ...crosman.detail.vendorDetail, programList: [
      { name: 'Standard', group: 'SMITH GOGGLES', year: '0', show: '', discount1: '17% Off' },
      { name: 'Standard', group: 'SMITH SUNGLASSES', year: '0', show: '', discount1: '10%' },
    ] } } })!
    expect(two.programs.map((p) => [p.key, p.name])).toEqual([['standard:smith goggles', 'Standard (SMITH GOGGLES)'], ['standard:smith sunglasses', 'Standard (SMITH SUNGLASSES)']])
  })
  it('reads product lines, returns and brands', () => {
    expect(v.product_lines).toEqual([{ category: 'SHOOTING SPORTS', lines: ['AIR GUNS & ACCESSORIES'] }])
    expect(v.return_notes).toBe('Defective goods: Call For RA. RA required. Return to: Crosman Corp, 7629 Routes 5 & 20, Bloomfield, NY 14443. Paid back by: Credit Memo. (Worldwide portal)')
    expect(v.resources?.liability_insurance).toBe('Yes ($2,000,000)')
    expect(v.brands).toEqual(['Crosman', 'Benjamin'])
  })
  it('skips a vendor the portal sent nothing for', () => {
    expect(readPortalVendor({ number: 1, name: 'X', detail: null })).toBeNull()
  })
})

describe('freight terms', () => {
  it('reads each kind', () => {
    expect(freightTier('PPD $1,500 Continental US')).toMatchObject({ kind: 'prepaid', at: 1500 })
    expect(freightTier('FFA Over $500')).toMatchObject({ kind: 'allowance', at: 500 })
    expect(freightTier('50% FA $3000')).toMatchObject({ kind: 'part_allowance', at: 3000, pct: 50 })
    expect(freightTier('PPD & Add To Invoice').kind).toBe('prepaid_add')
    expect(freightTier('Collect With 10% Freight Cap')).toMatchObject({ kind: 'collect', pct: 10 })
  })
  it('turns them into free shipping', () => {
    const f = (...t: string[]) => freeShipping(t.map(freightTier))
    expect(f('Collect', 'PPD $4000')).toEqual({ policy: 'sometimes', threshold: 4000 })
    expect(f('FFA $1000', 'PPD $500')).toEqual({ policy: 'sometimes', threshold: 500 })
    expect(f('PPD')).toEqual({ policy: 'always', threshold: null })
    expect(f('FFA Lower 48 States')).toEqual({ policy: 'always', threshold: null })
    expect(f('PPD 6 Guns')).toEqual({ policy: 'sometimes', threshold: null })
    expect(f('Collect')).toEqual({ policy: 'never', threshold: null })
    expect(f('PPD & Add To Invoice')).toEqual({ policy: 'never', threshold: null })
    expect(f()).toEqual({ policy: null, threshold: null })
  })
  it('reads dates and terms keys', () => {
    expect(portalDate('20260903')).toBe('2026-09-03')
    expect(portalDate('0')).toBeNull()
    expect(termsKey('2% 10 Net 30 Days')).toBe('2% 10 net 30')
  })
})

describe('vendor matching', () => {
  const vendors = [
    { id: '1', name: 'BUCK' }, { id: '2', name: 'Eagle Claw' }, { id: '3', name: "Coghlan's" }, { id: '4', name: 'Eastman Outdoors' },
    { id: '5', name: 'Mountainsmith' }, { id: '6', name: 'Crosman', aliases: ['Crosman Corporation'] },
  ]
  const names = ['Buck Knives', 'Eagle Claw Fishing Tackle', 'Coghlans Ltd', 'Eastman Footwear Group', 'Mountain', 'Crosman Corp', 'Nobody Here']
  it('matches the same way as the import scripts', () => {
    const a = buildIndex(vendors), b = scriptMatch.buildIndex(vendors)
    for (const n of names) {
      const x = findVendor(a, n), y = scriptMatch.findVendor(b, n)
      expect([n, x?.vendor.id ?? null, x?.how ?? null]).toEqual([n, y?.vendor.id ?? null, y?.how ?? null])
    }
    expect(findVendor(a, 'Crosman Corp')).toMatchObject({ how: 'exact', vendor: { id: '6' } })
    expect(findVendor(a, 'Eastman Footwear Group')).toBeNull()
  })
})
