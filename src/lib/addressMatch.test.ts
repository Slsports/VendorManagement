import { describe, expect, it } from 'vitest'
import { matchBook, pickAddress, typingPart } from './addressMatch'

const book = [
  { email: 'jarrett@shaverlakesports.com', name: 'Jarrett', where: 'Shaver Lake Sports' },
  { email: 'NicolaY@worldwidebuygroup.com', name: 'Nicola Young', where: 'Worldwide Distributors · Softlines (Merchandising)' },
  { email: 'shannon@careyonsports.com', name: 'Shannon Carey Parratto', where: 'Rep · Carey On Sports' },
  { email: 'jared.rod@me.com', name: 'Jared Rodriguez', where: 'SMITH OPTICS' },
]

describe('address suggestions (Dana, Nov 5)', () => {
  it('finds staff and vendor people by the start of a name', () => {
    expect(matchBook(book, 'jarr', []).map((b) => b.name)).toEqual(['Jarrett'])
    expect(matchBook(book, 'ja', []).map((b) => b.name)).toEqual(['Jared Rodriguez', 'Jarrett'])
  })
  it('finds by a last name, an email or the company', () => {
    expect(matchBook(book, 'parr', [])[0]?.name).toBe('Shannon Carey Parratto')
    expect(matchBook(book, 'worldwide', [])[0]?.name).toBe('Nicola Young')
    expect(matchBook(book, 'smith', [])[0]?.name).toBe('Jared Rodriguez')
  })
  it('leaves out anyone already in the field and waits for two letters', () => {
    expect(matchBook(book, 'jarr', ['JARRETT@shaverlakesports.com'])).toEqual([])
    expect(matchBook(book, 'j', [])).toEqual([])
  })
  it('works on the part after the last comma', () => {
    expect(typingPart('a@b.com, jarr')).toBe('jarr')
    expect(pickAddress('a@b.com, jarr', 'jarrett@shaverlakesports.com')).toBe('a@b.com, jarrett@shaverlakesports.com, ')
    expect(pickAddress('jarr', 'jarrett@shaverlakesports.com')).toBe('jarrett@shaverlakesports.com, ')
  })
})
