import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { bySection, parseBlocks, parseInline, searchHelp, type HelpArticle } from '@/lib/help'
import { helpArticles } from '@/lib/helpArticles'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'

/**
 * Help (Dana, Oct 11): "a complete list of features and exactly how to use them as help files so someone could
 * search the Knowledge Base to learn how to do things." Search across every article, or browse by section.
 */
export default function HelpPage() {
  const { slug } = useParams()
  const article = slug ? helpArticles.find((a) => a.slug === slug) : null
  if (slug) return article ? <ArticleView article={article} /> : <NotFound />
  return <HelpHome />
}

function HelpHome() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const results = useMemo(() => searchHelp(helpArticles, q), [q])
  const sections = useMemo(() => bySection(helpArticles), [])
  function setQ(v: string) {
    const next = new URLSearchParams(params)
    if (v) next.set('q', v)
    else next.delete('q')
    setParams(next, { replace: true })
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Help" description={`How to do things in VMS: ${helpArticles.length} articles. Search, or pick a topic.`} />
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="What do you want to do? e.g. save a price list, add a task, reply to an email"
          aria-label="Search help" className="h-12 w-full rounded-xl border border-stone-300 bg-white pl-9 pr-3 text-base shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand" />
      </div>
      {q.trim() ? (
        results.length ? (
          <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {results.map((a) => (
              <li key={a.slug}>
                <Link to={`${ROUTES.help}/${a.slug}`} className="block px-4 py-3 hover:bg-stone-50">
                  <span className="block font-medium text-stone-900">{a.title}</span>
                  <span className="block text-xs text-stone-500">{a.section} · {firstLine(a)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-2xl border border-dashed border-stone-300 py-10 text-center text-sm text-stone-600">Nothing matches "{q}". Try fewer or different words.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map((s) => (
            <section key={s.section} className="rounded-2xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-stone-900">{s.section}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {s.articles.map((a) => <li key={a.slug}><Link to={`${ROUTES.help}/${a.slug}`} className="text-brand hover:underline">{a.title}</Link></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

const firstLine = (a: HelpArticle) => {
  const p = parseBlocks(a.body).find((b) => b.kind === 'p')
  const text = p && 'text' in p ? p.text.replace(/\*\*/g, '') : ''
  return text.length > 140 ? `${text.slice(0, 137)}…` : text
}

function ArticleView({ article }: { article: HelpArticle }) {
  const related = helpArticles.filter((a) => a.section === article.section && a.slug !== article.slug).sort((x, y) => x.title.localeCompare(y.title))
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink fallback={ROUTES.help} fallbackLabel="Help" />
      <PageHeader eyebrow={article.section} title={article.title} description={article.who !== 'Everyone' ? `For: ${article.who}` : undefined} />
      <article className="rounded-2xl border border-stone-200 bg-white p-5 text-sm leading-relaxed text-stone-800 sm:p-6">
        {parseBlocks(article.body).map((b, i) => {
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
      </article>
      {related.length ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-stone-900">More in {article.section}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {related.map((a) => <li key={a.slug}><Link to={`${ROUTES.help}/${a.slug}`} className="text-brand hover:underline">{a.title}</Link></li>)}
          </ul>
        </section>
      ) : null}
      <p className="mt-6 text-sm"><Link to={ROUTES.help} className="font-medium text-brand hover:underline">Search all help</Link></p>
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

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink fallback={ROUTES.help} fallbackLabel="Help" />
      <p className="rounded-2xl border border-dashed border-stone-300 py-10 text-center text-sm text-stone-600">That help article has moved or been renamed. <Link to={ROUTES.help} className="font-medium text-brand hover:underline">Search help</Link></p>
    </div>
  )
}
