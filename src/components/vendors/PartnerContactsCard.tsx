import { Link } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { contactsForVendor, getPartner } from '@/services/partners'
import { ROUTES } from '@/lib/constants'
import type { BillingRoute } from '@/types'

/** Our contacts at the billing partner (Worldwide: member number, main line, AR, liaison, warehouse). */
export function PartnerContactsCard({ route, vendorName }: { route: BillingRoute; vendorName: string }) {
  const { organization, role } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? getPartner(organization.id, route) : null), [organization?.id, route])
  const p = q.data
  if (q.isLoading || !p) return null
  const contacts = contactsForVendor(p.partner_contacts, vendorName)
  return (
    <section className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Our contacts at {p.name}</h2>
      <p className="mt-1 text-sm text-stone-700">
        {p.member_number ? <>Member #{p.member_number}</> : null}
        {p.main_phone ? <> · <a href={`tel:${p.main_phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone className="size-3.5" aria-hidden="true" />{p.main_phone}</a></> : null}
      </p>
      {contacts.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {contacts.map((c) => (
            <li key={c.id}>
              <p className="font-medium text-stone-900">{c.name}{c.extension ? <span className="font-normal text-stone-600"> · ext {c.extension}</span> : null}</p>
              <p className="text-xs text-stone-600">{c.department}{c.title && c.title !== c.department ? ` · ${c.title.replace(/\s*\(.*\)$/, '')}` : ''}{c.initial_range ? ` · vendors ${c.initial_range}` : ''}</p>
              {c.email ? <a href={`mailto:${c.email}`} className="text-xs text-brand hover:underline">{c.email}</a> : null}
              {c.notes ? <p className="text-xs text-stone-500">{c.notes}</p> : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-stone-500">No contacts marked for the vendor box yet.</p>}
      {role === 'admin' ? <Link to={`${ROUTES.settings}/worldwide`} className="mt-3 inline-block text-xs text-brand hover:underline">Full {p.name} roster</Link> : null}
    </section>
  )
}
