import { describe, expect, it } from 'vitest'
import { docType } from './viewer'

describe('what the viewer shows', () => {
  it('knows each kind of file', () => {
    expect(docType('INV 802289.PDF')).toBe('pdf')
    expect(docType('photo.jpg')).toBe('image')
    expect(docType('order writer.xlsx')).toBe('sheet')
    expect(docType('old.xls')).toBe('sheet')
    expect(docType('prices.csv')).toBe('sheet')
    expect(docType('letter.docx')).toBe('word')
    expect(docType('ancient.doc')).toBe('other')
    expect(docType('scan', 'application/pdf')).toBe('pdf')
  })
})
