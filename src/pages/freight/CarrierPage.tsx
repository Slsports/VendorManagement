import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Pencil } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { listCarrierThreads } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { CarrierDialog } from '@/components/freight/CarrierDialog'
import { Alert, Badge, Button, Spinner } from '@/components/ui'
import type { Carrier } from '@/types'

const ROLE_LABEL: Record<Carrier['role'], string> = { billing: 'Billing company', trucking: 'Trucking company', other: 'Other freight company' }

/** One freight company (Dana, Oct 12): its details and every email from it; billing companies link to their bills. */
export default function CarrierPage() {
  const { id = '' } = useParams()
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const [editing, setEditing] = useState(false)
  const carrier = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('carriers').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  }, [id])
  const mail = useSupabaseQuery(async () => (organization ? listCarrierThreads(organization.id, id) : []), [organization?.id, id])
  const c = carrier.data

  if (carrier.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (carrier.error) return <Alert variant="error">{carrier.error}</Alert>
  if (!c) return <Alert variant="error">Freight company not found.</Alert>
  const rows = mail.data ?? []

  return (
    <div>
      <BackLink fallback={ROUTES.freight} fallbackLabel="Freight" />
      <PageHeader title={c.name}
        description={[ROLE_LABEL[c.role], c.mode === 'ltl' ? 'LTL' : 'Parcel', c.email_domains.length ? `mail from ${c.email_domains.join(', ')}` : null].filter(Boolean).join(' · ')}
        actions={<span className="flex flex-wrap gap-2">
          {c.role === 'billing' ? <Link to={`${ROUTES.freight}?carrier=${c.id}&show=all`}><Button variant="secondary">Its bills</Button></Link> : null}
          {canEdit ? <Button variant="ghost" onClick={() => setEditing(true)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button> : null}
        </span>} />
      {!c.is_active ? <Badge tone="neutral" className="mb-3">Inactive</Badge> : null}
      {c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="mb-3 inline-flex items-center gap-1 text-sm text-brand hover:underline">Website <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
      {c.notes ? <p className="mb-4 text-sm text-stone-600">{c.notes}</p> : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Emails</h2>
          {rows.length >= 100 ? <span className="text-xs text-stone-500">Showing the newest 100</span> : null}
        </div>
        {mail.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading mail…</p>
          : mail.error ? <p className="mt-3 text-sm text-red-700">{mail.error}</p>
          : rows.length === 0 ? <p className="mt-3 text-sm text-stone-500">No emails from {c.name} yet.</p>
          : <div className="mt-3"><ThreadTable rows={rows} sortParam="mail_sort" /></div>}
      </section>
      {editing ? <CarrierDialog carrier={c} onClose={() => setEditing(false)} onDone={async () => { setEditing(false); await carrier.refetch() }} /> : null}
    </div>
  )
}
