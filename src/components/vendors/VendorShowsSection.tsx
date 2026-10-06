import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorShows } from '@/services/lines'
import { ROUTES } from '@/lib/constants'

/** Which Worldwide shows this vendor exhibited at, the booth, and who shared it. */
export function VendorShowsSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => listVendorShows(vendorId), [vendorId])
  const shows = q.data ?? []
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Worldwide shows</h2>
      {shows.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">Not on a show list we have loaded. That does not mean they are not WWD.</p>
      ) : (
        <ul className="mt-3 space-y-3 text-sm">
          {shows.map((s) => (
            <li key={s.id}>
              <p className="font-medium text-stone-900">{s.show_label}{s.booth ? <span className="font-normal text-stone-600"> · booth {s.booth}</span> : null}{s.is_new ? <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">new exhibitor</span> : null}</p>
              {s.exhibitor ? <p className="text-xs text-stone-500">Exhibitor: {s.exhibitor}</p> : null}
              {s.booth_mates.length ? (
                <p className="mt-0.5 text-xs text-stone-600">
                  Shared the booth with {s.booth_mates.slice(0, 10).map((m, i) => <span key={m.line_id}>{i ? ', ' : ''}{m.vendor_id ? <Link to={`${ROUTES.vendors}/${m.vendor_id}`} className="hover:text-brand hover:underline">{m.name}</Link> : <Link to={`${ROUTES.lines}?q=${encodeURIComponent(m.name)}&only=all`} className="hover:text-brand hover:underline">{m.name}</Link>}</span>)}
                  {s.booth_mates.length > 10 ? ` and ${s.booth_mates.length - 10} more` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
