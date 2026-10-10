import type { ReactNode } from 'react'
import { Construction } from 'lucide-react'

/**
 * Placeholder body for pages whose features arrive in a later phase. Says what
 * the page will do so the navigation is meaningful before the data exists.
 */
export function ComingSoon({ phase, title, children }: { phase: number; title?: string; children?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
      <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Construction className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold text-stone-900">{title ?? `Arrives in Phase ${phase}`}</h2>
      {children ? <div className="mx-auto mt-2 max-w-xl text-sm text-stone-600">{children}</div> : null}
      {title ? <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-400">Phase {phase}</p> : null}
    </section>
  )
}
