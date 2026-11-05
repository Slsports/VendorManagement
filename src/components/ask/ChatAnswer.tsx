import { Link } from 'react-router-dom'
import { parseInline } from '@/lib/help'
import { parseChat } from '@/lib/chatText'

/** An Ask VMS answer: paragraphs, lists, small tables, bold, and links to where each number came from (Dana, Nov 5). */
export function ChatAnswer({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-stone-800">
      {parseChat(text).map((b, i) => {
        if (b.kind === 'h') return <p key={i} className="mb-2 mt-3 font-semibold text-stone-900 first:mt-0"><Inline text={b.text} /></p>
        if (b.kind === 'p') return <p key={i} className="mb-2"><Inline text={b.text} /></p>
        if (b.kind === 'hr') return <hr key={i} className="my-3 border-stone-200" />
        if (b.kind === 'table') return (
          <div key={i} className="mb-3 overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold text-stone-600">
                <tr>{b.head.map((h, j) => <th key={j} className="px-3 py-2"><Inline text={h} /></th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="px-3 py-1.5 align-top"><Inline text={c} /></td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )
        const List = b.kind === 'ol' ? 'ol' : 'ul'
        return (
          <List key={i} className={`mb-2 space-y-1 pl-5 ${b.kind === 'ol' ? 'list-decimal' : 'list-disc'}`}>
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
        // bold can hold a link: **[PO 123](/orders/…)**
        if (part.kind === 'bold') return <strong key={i} className="font-semibold text-stone-900">{part.text.includes('](') ? <Inline text={part.text} /> : part.text}</strong>
        if (part.kind === 'link') {
          return part.to.startsWith('/')
            ? <Link key={i} to={part.to} className="text-brand hover:underline">{part.text}</Link>
            : <a key={i} href={part.to} target="_blank" rel="noreferrer" className="text-brand hover:underline">{part.text}</a>
        }
        return <span key={i}>{part.text}</span>
      })}
    </>
  )
}
