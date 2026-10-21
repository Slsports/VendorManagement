import { headlineParts, WHY_LABEL } from '@/lib/mailSearch'
import type { MailMatch } from '@/services/mailSearch'

/** Under a found conversation's subject: why it came up, and the matching words (Dana, Oct 21). */
export function MailMatchLine({ m }: { m: MailMatch }) {
  return (
    <span className="mt-0.5 block text-xs text-stone-500">
      {m.why ? <span className="mr-1 rounded bg-stone-100 px-1 py-0.5 font-medium text-stone-600">{WHY_LABEL[m.why] ?? m.why}</span> : null}
      {m.headline ? headlineParts(m.headline).map((p, i) => p.hit ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-stone-900">{p.text}</mark> : <span key={i}>{p.text}</span>) : null}
    </span>
  )
}
