import { describe, expect, it } from 'vitest'
import { isImage, isPdf, uploadDayLabel } from './uploadPdf'

describe('Invoice Uploads helpers', () => {
  it('names the upload-day folders', () => {
    expect(uploadDayLabel('2026-10-20', '2026-10-20')).toBe('Today')
    expect(uploadDayLabel('2026-10-19', '2026-10-20')).toBe('Yesterday')
    expect(uploadDayLabel('2026-10-12', '2026-10-20')).toMatch(/Oct 12, 2026/)
  })
  it('tells photos from PDFs', () => {
    expect(isPdf({ type: 'application/pdf', name: 'a' })).toBe(true)
    expect(isPdf({ type: '', name: 'scan.PDF' })).toBe(true)
    expect(isImage({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe(true)
    expect(isImage({ type: '', name: 'photo.jpg' })).toBe(true)
    expect(isImage({ type: 'application/pdf', name: 'a.pdf' })).toBe(false)
  })
})
