import { describe, expect, it } from 'vitest'
import { askLink } from './ask'

describe('askLink', () => {
  it('opens a chat that knows the vendor or order of the page', () => {
    expect(askLink('/vendors/6a7cbef9-0000-4000-8000-000000000001')).toBe('/ask?vendor=6a7cbef9-0000-4000-8000-000000000001')
    expect(askLink('/orders/6a7cbef9-0000-4000-8000-000000000002/edit')).toBe('/ask?order=6a7cbef9-0000-4000-8000-000000000002')
    expect(askLink('/payments')).toBe('/ask')
  })
})
