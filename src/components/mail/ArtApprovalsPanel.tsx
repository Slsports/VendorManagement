import { Link } from 'react-router-dom'
import { Palette } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listArtApprovals } from '@/services/mail'
import { artWaitDays } from '@/lib/art'
import { ROUTES } from '@/lib/constants'
import { CountCard } from '@/components/dashboard/CountCard'

/**
 * Dashboard (Dana, Oct 10): artwork, proofs and designs a vendor is waiting on us to approve before the order
 * goes ahead, oldest first, each a link to its email. Red after 2 days. Hidden when there are none.
 * "Needs changes" is on us (Dana: "I need it to pop up in there that I have something to do on it"), so it is
 * listed with the approvals as "Need to send revisions" (Dana, Oct 20); "Waiting on revisions" waits on the vendor and goes last, in grey.
 */
export function ArtApprovalsPanel() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listArtApprovals(organization.id) : []), [organization?.id])
  const rows = [...(q.data ?? [])].sort((a, b) => Number(a.art_status === 'changes_sent') - Number(b.art_status === 'changes_sent'))
  const todo = rows.filter((t) => t.art_status !== 'changes_sent').length
  if (!rows.length) return null
  return (
    <CountCard id="art" title={<span className="flex items-center gap-2"><Palette className="size-4 text-fuchsia-600" aria-hidden="true" /> Artwork approvals{rows.length > todo ? <span className="font-normal text-stone-500">+ {rows.length - todo} waiting on vendor</span> : null}</span>} count={todo}
      alert={rows.some((t) => t.art_status !== 'changes_sent' && artWaitDays(t.art_since) >= 2)}>
      <ul className="divide-y divide-stone-100 text-sm">
        {rows.slice(0, 8).map((t) => {
          const days = artWaitDays(t.art_since)
          const sent = t.art_status === 'changes_sent'
          const when = days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`
          return (
            <li key={t.id}>
              <Link to={`${ROUTES.mail}/${t.id}`} className="block py-2 hover:text-brand">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`min-w-0 truncate font-medium ${sent ? 'text-stone-500' : 'text-stone-900'}`}>{t.vendor?.name ?? 'Vendor not filed'}</span>
                  <span className={`shrink-0 text-xs ${!sent && days >= 2 ? 'font-semibold text-red-700' : 'text-stone-500'}`}>
                    {sent ? 'waiting on revisions' : t.art_status === 'needs_changes' ? `Need to send revisions · ${when}` : when}
                  </span>
                </span>
                <span className="block truncate text-xs text-stone-500">{t.subject || '(no subject)'}{t.art_note ? ` · ${t.art_note}` : ''}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      {rows.length > 8 ? <p className="mt-1 text-xs text-stone-500">and {rows.length - 8} more</p> : null}
    </CountCard>
  )
}
