import { describe, expect, it } from 'vitest'
import { arrangeCards, moveCard, readLayout } from './dashboardLayout'

const cards = [{ id: 'mail' }, { id: 'review' }, { id: 'art' }, { id: 'new' }]

describe('dashboard layout', () => {
  it('keeps the standard order with no layout', () => {
    expect(arrangeCards(cards, null).shown.map((c) => c.id)).toEqual(['mail', 'review', 'art', 'new'])
  })
  it('follows the saved order, hides cards, and puts new cards after', () => {
    const r = arrangeCards(cards, { order: ['art', 'mail', 'review'], hidden: ['review'] })
    expect(r.shown.map((c) => c.id)).toEqual(['art', 'mail', 'new'])
    expect(r.hidden.map((c) => c.id)).toEqual(['review'])
  })
  it('moves a card up or down', () => {
    expect(moveCard(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveCard(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
  })
  it('reads a saved layout safely', () => {
    expect(readLayout(null)).toBeNull()
    expect(readLayout({ order: ['a', 3], hidden: 'x' })).toEqual({ order: ['a'], hidden: [] })
  })
})
