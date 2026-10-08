import { describe, expect, it } from 'vitest'
import { byYear, folderOf, kindFor, yearChoices } from './documents'

describe('vendor document folders', () => {
  it('puts each kind in its folder', () => {
    expect(folderOf('price_list')).toBe('price_lists')
    expect(folderOf('delivery_receipt')).toBe('shipping')
    expect(folderOf('confirmation')).toBe('invoices')
    expect(folderOf('website')).toBe('other')
  })
  it('keeps a kind that fits the folder, else uses the folder kind', () => {
    expect(kindFor('shipping', 'freight_bill')).toBe('freight_bill')
    expect(kindFor('shipping', 'price_list')).toBe('packing_slip')
    expect(kindFor('invoices')).toBe('invoice')
  })
  it('years newest first', () => {
    expect(yearChoices(new Date('2026-10-08T12:00:00'))[0]).toBe(2027)
    expect(byYear([{ doc_year: 2025 }, { doc_year: 2026 }, { doc_year: 2025 }]).map(([y, r]) => [y, r.length])).toEqual([[2026, 1], [2025, 2]])
  })
})

describe('folder for an email attachment', () => {
  it('reads the file name, then the subject', async () => {
    const { guessFolder } = await import('./documents')
    expect(guessFolder('INV_802289.pdf')).toBe('invoices')
    expect(guessFolder('Fall 2026 Price List.pdf')).toBe('price_lists')
    expect(guessFolder('scan001.pdf', 'Packing slip for PO 60851')).toBe('shipping')
    expect(guessFolder('photo.jpg', 'Hello')).toBe('other')
  })
})
