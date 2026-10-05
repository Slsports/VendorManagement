import { useNavigate } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listReviewQueue } from '@/services/vendors'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReviewItemCard } from '@/components/vendors/ReviewItemCard'
import { Alert, Button, Spinner } from '@/components/ui'

const KIND_LABELS: Record<string, { title: string; help: string }> = {
  vendor_merge: { title: 'Merged at import', help: 'Lightspeed had these names for what looked like one vendor. Confirm, or split a name back out.' },
  vendor_duplicate: { title: 'Possible duplicates', help: 'Two records that look alike. Keep both, or merge into the one you choose.' },
  vendor_marker: { title: 'Lightspeed markers', help: 'Names that carried an asterisk in Lightspeed.' },
}

export default function ReviewQueuePage() {
  const { role, organization } = useAuth()
  const navigate = useNavigate()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listReviewQueue(organization.id) : []), [organization?.id])

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading review queue…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const items = q.data ?? []
  const kinds = [...new Set(items.map((i) => i.kind))].sort((a, b) => Object.keys(KIND_LABELS).indexOf(a) - Object.keys(KIND_LABELS).indexOf(b))

  return (
    <div>
      <PageHeader
        title="Review queue"
        description={items.length ? `${items.length} item${items.length === 1 ? '' : 's'} waiting for a decision.` : 'Nothing waiting. New items land here from imports, the mailbox and the vendor form.'}
        actions={<Button variant="secondary" onClick={() => navigate(ROUTES.mergeReport)}>Lightspeed merge report</Button>}
      />
      {items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 py-16 text-center">
          <ClipboardCheck className="size-8 text-stone-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-stone-600">All clear.</p>
        </div>
      ) : (
        kinds.map((kind) => {
          const meta = KIND_LABELS[kind] ?? { title: kind, help: '' }
          const group = items.filter((i) => i.kind === kind)
          return (
            <section key={kind} className="mb-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{meta.title} <span className="font-normal text-stone-400">({group.length})</span></h2>
              {meta.help ? <p className="mb-3 text-sm text-stone-600">{meta.help}</p> : null}
              <div className="space-y-2">
                {group.map((item) => (
                  <ReviewItemCard key={item.id} item={item} vendor={item.vendor} other={item.other} canEdit={canEdit} onDone={() => q.refetch()} />
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
