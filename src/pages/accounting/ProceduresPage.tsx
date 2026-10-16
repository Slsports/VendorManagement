import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listProcedures } from '@/services/procedures'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_CATEGORY_LABELS } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { Alert, Button, Spinner } from '@/components/ui'

/** The handbook (Dana, Oct 16): one procedure per job, by category, so someone else could do the bookkeeping. */
export default function ProceduresPage() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (organization ? listProcedures(organization.id) : []), [organization?.id])
  const rows = q.data ?? []

  return (
    <div>
      <BackLink fallback={ROUTES.accounting} fallbackLabel="Accounting" />
      <PageHeader title="Procedures" description="How each bookkeeping job is done, in plain steps: who to call, which account pays, what to check. Tasks open their procedure."
        actions={<Button onClick={() => navigate(`${ROUTES.accountingProcedures}/new`)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Write a procedure</Button>} />
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
        : q.error ? <Alert variant="error">{q.error}</Alert>
        : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-600">No procedures yet. Write the first one, or send Claude a document and it drafts one.</p>
        : (
          <div className="space-y-6">
            {ACCOUNTING_CATEGORIES.filter((c) => rows.some((r) => r.category === c)).map((c) => (
              <section key={c}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{ACCOUNTING_CATEGORY_LABELS[c]}</h2>
                <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
                  {rows.filter((r) => r.category === c).map((r) => (
                    <li key={r.id}>
                      <Link to={`${ROUTES.accountingProcedures}/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-stone-50">
                        <BookOpen className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-medium text-stone-900">{r.title}</span>
                          {r.summary ? <span className="block text-sm text-stone-600">{r.summary}</span> : null}
                          <span className="block text-xs text-stone-400">Updated {new Date(r.updated_at).toLocaleDateString()}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </div>
  )
}
