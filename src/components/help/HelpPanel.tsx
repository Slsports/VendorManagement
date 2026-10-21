import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, Search, X } from 'lucide-react'
import { searchHelp, type HelpArticle } from '@/lib/help'
import { helpArticles } from '@/lib/helpArticles'
import { helpForPage } from '@/lib/helpForPage'
import { ROUTES } from '@/lib/constants'
import { HelpArticleBody } from './HelpArticleBody'

/**
 * The Help panel (Dana, Oct 21): opens beside the page being worked on with that page's help articles, so nobody has to
 * leave the work to look something up. Search covers all help; All help opens the Help page.
 */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation()
  const page = useMemo(() => helpForPage(helpArticles, pathname), [pathname])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<HelpArticle | null>(null)
  const list = q.trim() ? searchHelp(helpArticles, q) : page.articles
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/20" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          {open ? (
            <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><ChevronLeft className="size-4" aria-hidden="true" />Help for {page.name}</button>
          ) : <h2 className="text-base font-semibold text-stone-900">Help for {page.name}</h2>}
          <button type="button" onClick={onClose} aria-label="Close help" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          {open ? (
            <article className="leading-relaxed text-stone-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">{open.section}</p>
              <h3 className="mb-3 text-lg font-semibold text-stone-900">{open.title}</h3>
              <HelpArticleBody article={open} onLink={onClose} />
            </article>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all help" aria-label="Search all help"
                  className="h-10 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:text-sm" />
              </div>
              {list.length ? (
                <ul className="divide-y divide-stone-100">
                  {list.map((a) => (
                    <li key={a.slug}>
                      <button type="button" onClick={() => setOpen(a)} className="w-full py-2 text-left hover:text-brand">
                        <span className="block font-medium text-stone-900">{a.title}</span>
                        <span className="block text-xs text-stone-500">{a.section}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-stone-500">Nothing matches. Try other words.</p>}
            </>
          )}
        </div>
        <div className="border-t border-stone-200 px-4 py-3 text-sm">
          <Link to={open ? `${ROUTES.help}/${open.slug}` : ROUTES.help} onClick={onClose} className="font-medium text-brand hover:underline">{open ? 'Open on the Help page' : 'All help'}</Link>
        </div>
      </aside>
    </div>
  )
}
