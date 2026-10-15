import { describe, expect, it } from 'vitest'
import { extractLinks, guessKind, itemPicture, maybePaperwork, paperworkKind, pictureLabel, seasonLabel, wantAttachment, wantLink } from './offerFiles.ts'

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
    expect(wantAttachment({ file_name: 'Blue Kayak.jpg', size: 200_000 }, 'offers', 'Hello')).toBeNull()
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

describe('order paperwork', () => {
  const f = (file_name: string, size = 200_000) => ({ file_name, size })
  it('finds confirmations and invoices by file name, then subject', () => {
    expect(paperworkKind(f('Order Confirmation 55123.pdf'), null)).toBe('confirmation')
    expect(paperworkKind(f('SO-55123.pdf'), null)).toBe('confirmation')
    expect(paperworkKind(f('Sales_Order_Acknowledgement.pdf'), null)).toBe('confirmation')
    expect(paperworkKind(f('INV_88123.pdf'), null)).toBe('invoice')
    expect(paperworkKind(f('Invoice 88123.pdf'), 'Your order has shipped')).toBe('invoice')
    // Dom's WFS forward: only the email says "sales order"
    expect(paperworkKind(f('S102112.pdf'), 'FW: Shaver Lake - S102112', 'Does attached look correct? … I have attached S102112 for Shaver Lake. Please review the sales order')).toBe('confirmation')
    expect(paperworkKind(f('S102112.pdf'), 'FW: Shaver Lake - S102112', 'Does attached look correct?')).toBeNull()
    expect(maybePaperwork(f('S102112.pdf'))).toBe(true)
    // credits go to Credits (Dana, Oct 14); WFS's NetSuite invoice by its name
    expect(paperworkKind(f('Credit Memo CM2600409.pdf'), null)).toBe('credit')
    expect(paperworkKind(f('C2600409.pdf'), 'World Famous Sports, Inc.: Credit Memo #CM2600409')).toBe('credit')
    expect(paperworkKind(f('Invoice_I88431-4_1791912395312.pdf'), 'World Famous Sports, Inc.: Invoice #I88431-4')).toBe('invoice')
    // the email's own words win over the mail quoted under it; return labels aren't bills
    expect(paperworkKind(f('C2500557.pdf'), 'Re: World Famous Sports missing', 'HI Jane,\nPlease find the credit memo attached for the shortage.\n\nOn Mon, Oct 27, 2025 Jane wrote:\n> the invoice was short')).toBe('credit')
    expect(paperworkKind(f('RA2500525.pdf'), 'Re: WORLD FAMOUS SPORTS SENT WRONG ONE', 'please find the return label attached.\n\nOn Mon Jane wrote:\n> invoice')).toBeNull()
    expect(maybePaperwork(f('Spring Catalog.pdf'))).toBe(false)
    expect(paperworkKind(f('55123.pdf'), 'Order Confirmation for PO SLS-4471')).toBe('confirmation')
    expect(paperworkKind(f('88123.pdf'), 'Invoice 88123 from Ty')).toBe('invoice')
  })
  it('leaves other files alone', () => {
    expect(paperworkKind(f('Price List 2026.pdf'), 'Invoice attached')).toBeNull()
    expect(paperworkKind(f('Statement.pdf'), 'Invoice')).toBeNull()
    expect(paperworkKind(f('image001.png', 5000), 'Order confirmation')).toBeNull()
    expect(paperworkKind(f('Price List.xlsx'), 'Order confirmation')).toBeNull()
    expect(paperworkKind(f('88123.pdf'), 'Past due invoice reminder')).toBeNull()
    expect(paperworkKind(f('photo.pdf'), 'Hello')).toBeNull()
  })
})

describe('item pictures', () => {
  it('keeps real pictures, not logos or icons', () => {
    expect(itemPicture({ file_name: 'image003.jpg', size: 250_000 })).toBe(true)
    expect(itemPicture({ file_name: 'IMG_4471.HEIC', size: 2_000_000 })).toBe(true)
    expect(itemPicture({ file_name: 'image001.png', size: 9_000 })).toBe(false)
    expect(itemPicture({ file_name: 'company-logo.png', size: 120_000 })).toBe(false)
    expect(itemPicture({ file_name: 'specs.pdf', size: 120_000 })).toBe(false)
  })
  it('names generic pictures by the email subject', () => {
    expect(pictureLabel('image003.jpg', 'RE: New hats for spring')).toBe('New hats for spring – image003.jpg')
    expect(pictureLabel('Blue Kayak.jpg', 'Kayaks')).toBe('Blue Kayak')
  })
})

describe('spreadsheets as paperwork (Oct 15)', () => {
  it('takes an order copy or confirmation spreadsheet, never a price list or report', async () => {
    const { maybeSheetPaperwork } = await import('./offerFiles.ts')
    expect(maybeSheetPaperwork({ file_name: 'WW PO# PantherMrtn9126 for Shaver Lake Sports #816.xlsx' })).toBe(true)
    expect(maybeSheetPaperwork({ file_name: '2026 Price List.xlsx' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: 'WFS SALES 365 DAYS.xlsx' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: 'Fall Order Form.xls' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: 'Alexander New Summer 2026 Sunglasses Order Wrtiter.xlsx' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: '2026 UPC List_12192025.xlsx' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: 'WFS ATS 1.14.26.xlsx' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: '_REALTREE TOY COSTS.xlsx' })).toBe(false)
    expect(maybeSheetPaperwork({ file_name: 'Shaver Lake REVISED PO 082725.xlsx' })).toBe(true)
    expect(paperworkKind({ file_name: 'Order Confirmation 5521.xlsx', size: 9000 }, null)).toBe('confirmation')
    expect(paperworkKind({ file_name: 'Invoice 7781.csv', size: 900 }, null)).toBe('invoice')
  })
})
