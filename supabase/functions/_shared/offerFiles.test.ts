import { describe, expect, it } from 'vitest'
import { extractLinks, guessKind, seasonLabel, wantAttachment, wantLink } from './offerFiles.ts'

describe('what kind of file', () => {
  it('reads the file name first, then the subject', () => {
    expect(guessKind('Fall_2026_Price_List.pdf', null)).toBe('price_list')
    expect(guessKind('SLS Order Writer.xlsx', 'Our new catalog')).toBe('order_form')
    expect(guessKind('2026-lookbook.pdf', null)).toBe('catalog')
    expect(guessKind('document.pdf', 'December Buy Group specials.')).toBe('specials')
    expect(guessKind('document.pdf', 'Hello')).toBe('other')
  })
  it('finds the season, else the month it came', () => {
    expect(seasonLabel('Fall 2026 Price List', '2026-08-01T00:00:00Z')).toBe('Fall 2026')
    expect(seasonLabel('SPRING-27 line sheet', '2026-08-01T00:00:00Z')).toBe('Spring 2027')
    expect(seasonLabel('price list', '2026-10-08T18:00:00Z')).toBe('Oct 2026')
  })
})

describe('what gets saved', () => {
  it('keeps documents from offers mail, only named ones from other mail, never signature logos', () => {
    expect(wantAttachment({ file_name: 'Catalog 2026.pdf', size: 4_000_000 }, 'offers', 'New catalog')).toBe('catalog')
    expect(wantAttachment({ file_name: 'flyer.pdf', size: 200_000 }, 'offers', 'Hello')).toBe('other')
    expect(wantAttachment({ file_name: 'Invoice 7787.pdf', size: 90_000 }, 'attention', 'Invoice 7787')).toBeNull()
    expect(wantAttachment({ file_name: 'WFS Order Form.xlsx', size: 90_000 }, 'attention', 'Re: order')).toBe('order_form')
    expect(wantAttachment({ file_name: 'image001.png', size: 300_000 }, 'offers', 'Specials')).toBeNull()
    expect(wantAttachment({ file_name: 'tiny.png', size: 8_000 }, 'offers', 'Specials')).toBeNull()
    expect(wantAttachment({ file_name: 'huge catalog.pdf', size: 40_000_000 }, 'offers', 'Catalog')).toBeNull()
  })
  it('keeps catalog and price list links, not unsubscribe or social links', () => {
    const links = extractLinks('<p><a href="https://brand.example/files/Fall26_PriceList.pdf">here</a> <a href="https://issuu.com/brand/2026">View our catalog</a> <a href="https://brand.example/unsubscribe?u=1">Unsubscribe</a> <a href="https://facebook.com/brand">Facebook</a></p>')
    expect(links).toHaveLength(4)
    expect(links.map((l) => wantLink(l, 'Fall news'))).toEqual(['price_list', 'catalog', null, null])
  })
})
