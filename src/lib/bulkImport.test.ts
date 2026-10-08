import { describe, expect, it } from 'vitest'
import { folderFromName, guessFromPath, isImportable, vendorMatcher, yearFromName } from './bulkImport'

const m = vendorMatcher([
  { id: 'stan', name: 'STANSPORT', aliases: [], is_active: true },
  { id: 'pc', name: 'Planet Cotton', aliases: ['PLANET COTTON INC'], is_active: true },
  { id: 'rd', name: 'ROYAL DELUXE ACCESSORIES', aliases: [], is_active: true },
  { id: 'rb', name: 'ROYAL BRUSH', aliases: [], is_active: true },
])
const t = new Date('2021-06-01T12:00:00').getTime()

describe('bulk import: what the folder path says', () => {
  it('reads Dana\'s Vendor/Folder/Year filing', () => {
    expect(guessFromPath('Stansport/Invoices/2024/INV 1.pdf', t, m)).toMatchObject({ vendorId: 'stan', folder: 'invoices', year: 2024, sure: true })
    expect(guessFromPath('Vendors/Planet Cotton/Catalogs/2027/spring.pdf', t, m)).toMatchObject({ vendorId: 'pc', folder: 'catalogs', year: 2027, sure: true })
  })
  it('falls back to the file name, then the file date', () => {
    expect(guessFromPath('Royal Deluxe Accessories/Price List 2025.xlsx', t, m)).toMatchObject({ vendorId: 'rd', folder: 'price_lists', year: 2025, sure: true })
    expect(guessFromPath('Stansport/scan0001.pdf', t, m)).toMatchObject({ vendorId: 'stan', folder: null, year: 2021, yearFromFile: true, sure: false })
    expect(guessFromPath('Random Co/Invoices/x.pdf', t, m)).toMatchObject({ vendorId: null, folder: 'invoices', sure: false })
  })
  it('folder and year words', () => {
    expect(folderFromName('Packing Slips')).toBe('shipping')
    expect(folderFromName('2024 Price Lists')).toBe('price_lists')
    expect(folderFromName('Stansport')).toBeNull()
    expect(yearFromName('FY2023')).toBe(2023)
    expect(yearFromName('INV_2025-03-01.pdf')).toBe(2025)
    expect(yearFromName('PO 60851')).toBeNull()
  })
  it('skips system files', () => {
    expect(isImportable('Stansport/.DS_Store')).toBe(false)
    expect(isImportable('Stansport/~$order.xlsx')).toBe(false)
    expect(isImportable('__MACOSX/Stansport/a.pdf')).toBe(false)
    expect(isImportable('Stansport/a.pdf')).toBe(true)
  })
})
