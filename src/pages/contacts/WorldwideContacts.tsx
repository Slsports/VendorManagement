import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Phone, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getPartner } from '@/services/partners'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { ComposeDialog, type ComposeDraft } from '@/components/mail/ComposeDialog'
import { Alert, Spinner } from '@/components/ui'

const tel = (s: string) => `tel:${s.replace(/[^\d+]/g, '')}`

/** Everyone at Worldwide, for the rare times we need them: a vendor not cooperating, a warehouse problem, a missing invoice. */
export default function WorldwideContactsPage() {
  const { organization, role } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? getPartner(organization.id, 'worldwide') : null), [organization?.id])
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const canSend = role === 'admin' || role === 'manager' || role === 'buyer'
  const p = q.data

  const groups = useMemo(() => {
    const s = filter.trim().toLowerCase()
    const people = (p?.partner_contacts ?? []).filter((c) => !s || [c.name, c.department, c.title, c.email, c.initial_range].some((x) => (x ?? '').toLowerCase().includes(s)))
    const by = new Map<string, typeof people>()
    const key = people.filter((c) => c.show_on_vendor)
    if (key.length) by.set('Key contacts', key)
    for (const c of people.filter((x) => !x.show_on_vendor)) {
      const k = c.department || 'Other'
      by.set(k, [...(by.get(k) ?? []), c])
    }
    return [...by.entries()]
  }, [p, filter])

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!p) return <Alert variant="info">The Worldwide roster is not set up yet. Dana adds it in Settings &gt; Worldwide.</Alert>

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="WWD contacts"
        description={<>
          {p.name}{p.member_number ? <> · Member #{p.member_number}</> : null}
          {p.main_phone ? <> · <a href={tel(p.main_phone)} className="text-brand hover:underline">{p.main_phone}</a></> : null}
        </>}
      />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name, department or vendor letter"
          aria-label="Search WWD contacts"
          className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand" />
      </div>
      {groups.length === 0 ? <p className="text-sm text-stone-500">Nobody matches.</p> : groups.map(([dept, people]) => (
        <section key={dept} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{dept}</h2>
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
            {people.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">{c.name}</p>
                  <p className="text-xs text-stone-600">
                    {[c.title && c.title !== c.department ? c.title.replace(/\s*\(.*\)$/, '') : null, c.initial_range ? `vendors ${c.initial_range}` : null].filter(Boolean).join(' · ')}
                  </p>
                  {c.notes ? <p className="text-xs text-stone-500">{c.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {c.phone || c.extension ? (
                    <a href={tel(c.phone ?? p.main_phone ?? '')} className="inline-flex items-center gap-1 text-stone-700 hover:text-brand">
                      <Phone className="size-3.5" aria-hidden="true" />{c.phone ?? p.main_phone}{c.extension ? ` ext ${c.extension}` : ''}
                    </a>
                  ) : null}
                  {c.email ? (
                    canSend
                      ? <button type="button" onClick={() => setDraft({ to: [c.email!], subject: '', body: '' })} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail className="size-3.5" aria-hidden="true" />{c.email}</button>
                      : <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail className="size-3.5" aria-hidden="true" />{c.email}</a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {role === 'admin' ? <Link to={`${ROUTES.settings}/worldwide`} className="text-xs text-brand hover:underline">Edit the roster in Settings</Link> : null}
      {draft ? <ComposeDialog draft={draft} onClose={() => setDraft(null)} onSent={() => setDraft(null)} /> : null}
    </div>
  )
}
