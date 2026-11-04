import { describe, expect, it } from 'vitest'
import { SUGGESTED_TEXT_CATEGORIES, TEXT_CATEGORIES, textCategory, textWanted } from '../../supabase/functions/_shared/textAlerts.ts'

describe('text alert categories', () => {
  it('sorts tasks by their kind', () => {
    expect(textCategory('wwd:abc:disc')).toBe('payments')
    expect(textCategory('policy_renewal:x')).toBe('insurance')
    expect(textCategory('proof_due:x')).toBe('insurance')
    expect(textCategory('proof:x')).toBe('proofs')
    expect(textCategory('pricelist:x')).toBe('price_lists')
    expect(textCategory('ask:x')).toBe('questions')
    expect(textCategory('bofollow:v:2026-11-03')).toBe('admin')
    expect(textCategory(null)).toBe('from_person')
  })
  it('texts only the chosen categories; a task can say otherwise', () => {
    expect(textWanted('payments', SUGGESTED_TEXT_CATEGORIES)).toBe(true)
    expect(textWanted('admin', SUGGESTED_TEXT_CATEGORIES)).toBe(false)
    expect(textWanted('admin', SUGGESTED_TEXT_CATEGORIES, true)).toBe(true)
    expect(textWanted('payments', SUGGESTED_TEXT_CATEGORIES, false)).toBe(false)
    expect(textWanted('admin', null)).toBe(true)
    expect(textWanted('admin', [])).toBe(true)
  })
  it('suggested picks are real categories', () => {
    const keys = TEXT_CATEGORIES.map((c) => c.key as string)
    for (const k of SUGGESTED_TEXT_CATEGORIES) expect(keys).toContain(k)
  })
})
