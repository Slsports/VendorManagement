import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileText } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listRoutingLetters, listRoutingSends, routingLetterUrl } from '@/services/routingLetter'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { FoldSection } from '@/components/shared/FoldSection'
import { Badge } from '@/components/ui'

/**
 * The routing letter on a vendor's page (Dana, Oct 13: "It should say the date, name and email it was sent to"): every
 * send with its version, and whether that person confirmed receiving it; the button opens the current letter.
 */
export function VendorRoutingLetter({ vendorId, organizationId }: { vendorId: string; organizationId: string }) {
  const letters = useSupabaseQuery(() => listRoutingLetters(organizationId), [organizationId])
  const sends = useSupabaseQuery(() => listRoutingSends(organizationId, vendorId), [organizationId, vendorId])
  const current = letters.data?.[0]
  if (!current) return null
  const rows = sends.data ?? []
  const latest = rows.filter((s) => s.letter_id === current.id && s.sent_at)
  const summary = !rows.some((s) => s.sent_at) ? 'Not sent yet'
    : latest.length ? `v${current.version} sent${latest.some((s) => s.received_at) ? ', confirmed' : ', not confirmed'}`
    : `Has an older version (latest is v${current.version})`
  async function open() {
    try { window.open(await routingLetterUrl(current!.storage_path), '_blank', 'noopener') } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <FoldSection title="Routing letter" summary={summary}>
      <button type="button" onClick={() => void open()} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><FileText className="size-4" aria-hidden="true" />Routing letter (version {current.version})</button>
      {rows.length ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-stone-800">{s.sent_at ? `Sent ${shortDate(s.sent_at)}` : 'In Drafts, not sent'} to {s.contact_name ? `${s.contact_name}, ` : ''}{s.email}</span>
              <span className="text-xs text-stone-500">v{s.letter?.version}</span>
              {s.received_at ? <Badge tone="success">Confirmed {shortDate(s.received_at)}</Badge> : s.sent_at ? <Badge tone="warning">Not confirmed{s.reminded_at ? ', reminded' : ''}</Badge> : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-stone-500">Not sent to this vendor yet. Prepare the emails on <Link to={ROUTES.routingLetter} className="text-brand hover:underline">Freight › Routing letter</Link>.</p>}
    </FoldSection>
  )
}
