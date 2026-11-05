import { describe, expect, it } from 'vitest'
import { dollars, parseChat } from './chatText'

describe('Ask VMS answer text', () => {
  it('reads paragraphs, lists, headings and tables', () => {
    const md = [
      'Smith goggles sold fewer units last winter.',
      '',
      '**Units sold at SLS**',
      '',
      '| Smith Optics | Winter 24-25 | Winter 25-26 |',
      '|---|---|---|',
      '| Goggles: adult | 300 | 251 |',
      '| **Helmets total** | **42** | **61** |',
      '',
      '## What this means',
      '- **Goggles:** more on the shelf',
      '- Helmets: thin sizes',
      '  carried on',
      '1. Ask Shannon',
      '2. Check the order',
    ].join('\n')
    const b = parseChat(md)
    expect(b.map((x) => x.kind)).toEqual(['p', 'p', 'table', 'h', 'ul', 'ol'])
    const table = b[2] as { kind: 'table'; head: string[]; rows: string[][] }
    expect(table.head).toEqual(['Smith Optics', 'Winter 24-25', 'Winter 25-26'])
    expect(table.rows).toEqual([['Goggles: adult', '300', '251'], ['**Helmets total**', '**42**', '**61**']])
    expect((b[4] as { items: string[] }).items).toEqual(['**Goggles:** more on the shelf', 'Helmets: thin sizes carried on'])
    expect((b[5] as { items: string[] }).items).toEqual(['Ask Shannon', 'Check the order'])
  })
  it('keeps a line starting with a pipe that is not a table as text', () => {
    expect(parseChat('| not a table')).toEqual([{ kind: 'p', text: '| not a table' }])
  })
  it('shows dollars with cents', () => {
    expect(dollars(0.14842)).toBe('$0.15')
    expect(dollars(5)).toBe('$5.00')
  })
})
