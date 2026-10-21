import { describe, expect, it } from 'vitest'
import { helpForPage } from './helpForPage'
import { helpArticles } from './helpArticles'

describe('helpForPage', () => {
  it('names the page and puts its own articles first', () => {
    const h = helpForPage(helpArticles, '/ls-pos/abc')
    expect(h.name).toBe('LS POs')
    expect(h.articles[0]!.slug).toBe('ordering--ls-po')
  })
  it('a vendor page gets the vendor page article first, then Vendors, Ordering and Documents', () => {
    const h = helpForPage(helpArticles, '/vendors/123')
    expect(h.articles[0]!.slug).toBe('vendors--read-a-vendor-page')
    expect(h.articles.some((a) => a.section === 'Ordering')).toBe(true)
  })
  it('every part of VMS has some help', () => {
    for (const p of ['/', '/orders', '/orders/1', '/freight', '/payments', '/review', '/mail', '/tasks', '/reports', '/settings', '/accounting', '/upload', '/supplies', '/rep-groups'])
      expect(helpForPage(helpArticles, p).articles.length, p).toBeGreaterThan(0)
  })
})
