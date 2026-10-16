import { Link } from 'react-router-dom'
import { parseBlocks, parseInline } from '@/lib/help'
import { ROUTES } from '@/lib/constants'

/** Plain Markdown the way Help renders it (headings, lists, paragraphs, **bold**, [links](…)). Procedures use it too. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'h2') return <h2 key={i} className="mb-2 mt-5 text-base font-semibold text-stone-900 first:mt-0"><Inline text={b.text} /></h2>
        if (b.kind === 'h3') return <h3 key={i} className="mb-1 mt-4 font-semibold text-stone-900"><Inline text={b.text} /></h3>
        if (b.kind === 'p') return <p key={i} className="mb-3"><Inline text={b.text} /></p>
        if (b.kind !== 'ol' && b.kind !== 'ul') return null
        const List = b.kind === 'ol' ? 'ol' : 'ul'
        return (
          <List key={i} className={`mb-3 space-y-1.5 pl-5 ${b.kind === 'ol' ? 'list-decimal' : 'list-disc'}`}>
            {b.items.map((item, j) => <li key={j}><Inline text={item} /></li>)}
          </List>
        )
      })}
    </div>
  )
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'bold') return <strong key={i} className="font-semibold text-stone-900">{part.text}</strong>
        if (part.kind === 'link') {
          const to = part.to.startsWith('help:') ? `${ROUTES.help}/${part.to.slice(5)}` : part.to
          return to.startsWith('/') ? <Link key={i} to={to} className="text-brand hover:underline">{part.text}</Link>
            : <a key={i} href={to} target="_blank" rel="noreferrer" className="text-brand hover:underline">{part.text}</a>
        }
        return <span key={i}>{part.text}</span>
      })}
    </>
  )
}
