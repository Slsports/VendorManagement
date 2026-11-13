import { describe, expect, it } from 'vitest'
import { isRecordPage, pageKeyFor } from './pageTexts'

describe('page wording keys', () => {
  it('names the page, not the record', () => {
    expect(pageKeyFor('/snopark')).toBe('/snopark')
    expect(pageKeyFor('/snopark/')).toBe('/snopark')
    expect(pageKeyFor('/orders', '?view=open&sort=x')).toBe('/orders?view=open')
    const k = pageKeyFor('/vendors/ad8e1c59-c9e4-41f2-a514-349ac0021696/edit')
    expect(k).toBe('/vendors/:id/edit')
    expect(isRecordPage(k)).toBe(true)
    expect(isRecordPage('/vendors')).toBe(false)
  })
})
