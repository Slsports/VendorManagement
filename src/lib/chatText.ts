/**
 * The text of an Ask VMS answer (Dana, Nov 5): Claude writes short Markdown with headings, lists, small tables, **bold**
 * and [links](/orders/…) to where each number came from. Parsed here into blocks the chat draws; inline bold and links
 * use the Help parser.
 */
export type ChatBlock =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' }

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim())

export function parseChat(md: string): ChatBlock[] {
  const out: ChatBlock[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join(' ') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const t = line.trim()
    if (!t) { flush(); continue }
    // a table: a row of cells, a separator, then rows
    if (t.startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      flush()
      const head = cells(t)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) { rows.push(cells(lines[i]!)); i++ }
      i--
      out.push({ kind: 'table', head, rows })
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t)
    if (h) { flush(); out.push({ kind: 'h', level: h[1]!.length, text: h[2]! }); continue }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push({ kind: 'hr' }); continue }
    const ul = /^[-*]\s+(.*)$/.exec(t)
    const ol = /^\d+[.)]\s+(.*)$/.exec(t)
    if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const prev = out[out.length - 1]
      const item = (ul ?? ol)![1]!
      if (prev && prev.kind === kind) prev.items.push(item)
      else out.push({ kind, items: [item] })
      continue
    }
    // a line that carries on the list item above it
    const prev = out[out.length - 1]
    if (!para.length && prev && (prev.kind === 'ul' || prev.kind === 'ol') && /^\s{2,}/.test(line)) {
      prev.items[prev.items.length - 1] += ' ' + t
      continue
    }
    para.push(t)
  }
  flush()
  return out
}

/** Dollars for the page: "$0.15", "$4.20". */
export const dollars = (n: number) => `$${n.toFixed(2)}`
