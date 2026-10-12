import { describe, expect, it } from 'vitest'
import { reviewTabOfCheck, reviewTabOfKind } from './reviews'

describe('review tabs', () => {
  it('puts each review kind on its tab', () => {
    expect(reviewTabOfKind('email_sender')).toBe('who')
    expect(reviewTabOfKind('mail_reply')).toBe('answer')
    expect(reviewTabOfKind('delivery_receipt')).toBe('freight')
    expect(reviewTabOfKind('vendor_duplicate')).toBe('vendor')
    expect(reviewTabOfKind('category_change')).toBe('vendor')
  })
  it('puts paperwork on Confirmations, Invoices or Needs a hand', () => {
    expect(reviewTabOfCheck({ kind: 'confirmation', status: 'to_review' })).toBe('confirmations')
    expect(reviewTabOfCheck({ kind: 'invoice', status: 'to_review' })).toBe('invoices')
    expect(reviewTabOfCheck({ kind: 'invoice', status: 'needs_order' })).toBe('hand')
    expect(reviewTabOfCheck({ kind: 'confirmation', status: 'failed' })).toBe('hand')
  })
})
