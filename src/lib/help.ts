// The Knowledge Base (Dana, Oct 11): help articles live in docs/help/*.md, one "how do I…" per file, with a small
// header (title, section, keywords, who). Every change to a feature updates its article in the same commit.

export const HELP_SECTIONS = [
  'Getting started', 'Dashboard', 'Tasks', 'Mail', 'Vendors', 'Documents', 'Rep groups & lines',
  'Ordering', 'Orders', 'Order paperwork', 'Freight', 'Payments', 'Review queue', 'Reports', 'Accounting', 'Settings',
] as const

export interface HelpArticle {
  slug: string
  title: string
  section: string
  keywords: string[]
  who: string
  body: string
}

/** Read one article file: the header between --- lines, then the Markdown body. */
export function parseArticle(slug: string, raw: string): HelpArticle {
  const text = raw.replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const head: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) head[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return {
    slug,
    title: head.title || slug,
    section: head.section || 'Getting started',
    keywords: (head.keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean),
    who: head.who || 'Everyone',
    body: (m ? m[2] : text).trim(),
  }
}

/** "orders--change-status.md" or a full path → "orders--change-status". */
export const slugOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
const plain = (md: string) => md.replace(/\*\*|__|`|#+\s|\[([^\]]*)\]\([^)]*\)/g, '$1')

/**
 * Articles that match every word typed (a word can match the start of a word in the article), best first:
 * title, then keywords, then section, then the text.
 */
export function searchHelp(articles: HelpArticle[], query: string): HelpArticle[] {
  const q = words(query)
  if (!q.length) return []
  const scored: { a: HelpArticle; score: number }[] = []
  for (const a of articles) {
    const fields = [
      { w: words(a.title), weight: 10 },
      { w: words(a.keywords.join(' ')), weight: 6 },
      { w: words(a.section), weight: 3 },
      { w: words(plain(a.body)), weight: 1 },
    ]
    let score = 0
    let all = true
    for (const term of q) {
      let best = 0
      for (const f of fields) {
        const exact = f.w.includes(term)
        const prefix = exact || (term.length >= 3 && f.w.some((x) => x.startsWith(term)))
        if (prefix) best = Math.max(best, f.weight * (exact ? 2 : 1))
      }
      if (!best) { all = false; break }
      score += best
    }
    if (all) scored.push({ a, score })
  }
  return scored.sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title)).map((x) => x.a)
}

export function bySection(articles: HelpArticle[]): { section: string; articles: HelpArticle[] }[] {
  const known = HELP_SECTIONS as readonly string[]
  const sections = [...known, ...new Set(articles.map((a) => a.section).filter((s) => !known.includes(s)))]
  return sections
    .map((section) => ({ section, articles: articles.filter((a) => a.section === section).sort((x, y) => x.title.localeCompare(y.title)) }))
    .filter((s) => s.articles.length)
}

// A small Markdown reader for the articles: headings, numbered and bullet lists, paragraphs; bold and links inline.
export type HelpBlock =
  | { kind: 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'ol' | 'ul'; items: string[] }

export function parseBlocks(md: string): HelpBlock[] {
  const out: HelpBlock[] = []
  let para: string[] = []
  let list: { kind: 'ol' | 'ul'; items: string[] } | null = null
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') })
    para = []
    if (list) out.push(list)
    list = null
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const h = line.match(/^(#{2,3})\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (!line.trim()) { flush(); continue }
    if (h) { flush(); out.push({ kind: h[1] === '##' ? 'h2' : 'h3', text: h[2]! }); continue }
    if (ol || ul) {
      const kind = ol ? 'ol' : 'ul'
      if (para.length || (list && list.kind !== kind)) flush()
      list ??= { kind, items: [] }
      list.items.push((ol ?? ul)![1]!)
      continue
    }
    // an indented line continues the list item above it
    if (list && /^\s+/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue }
    if (list) flush()
    para.push(line.trim())
  }
  flush()
  return out
}

export type HelpInline = { kind: 'text' | 'bold'; text: string } | { kind: 'link'; text: string; to: string }

/** **bold** and [text](link) in a line of an article. */
export function parseInline(text: string): HelpInline[] {
  const out: HelpInline[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] })
    else out.push({ kind: 'link', text: m[2]!, to: m[3]! })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}
