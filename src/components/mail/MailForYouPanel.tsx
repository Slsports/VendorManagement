import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMailForMe, type ThreadRow } from '@/services/mail'
import { senderLabel, waited } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'

/** Dashboard: vendor replies waiting on you, and mail you sent that has had no answer past the follow-up date. */
export function MailForYouPanel() {
  const { organization, profile } = useAuth()
  const q = useSupabaseQuery(async () => (organization && profile ? listMailForMe(organization.id, profile.id, profile.sees_freight) : { needs: [], noAnswer: [] }), [organization?.id, profile?.id, profile?.sees_freight])
  const needs = q.data?.needs ?? []
  const noAnswer = q.data?.noAnswer ?? []
  const total = needs.length + noAnswer.length
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm lg:col-span-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Mail for you{total ? ` (${total})` : ''}</h2>
        <Link to={ROUTES.mail} className="text-sm font-medium text-brand hover:underline">Open Mail</Link>
      </div>
      {q.isLoading ? <p className="mt-4 text-sm text-stone-500">Checking…</p>
        : q.error ? <p className="mt-4 text-sm text-red-700">{q.error}</p>
        : total === 0 ? (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-stone-50 p-4">
            <Mail className="mt-0.5 size-5 shrink-0 text-stone-400" aria-hidden="true" />
            <p className="text-sm text-stone-600">Nothing waiting on you. Vendor replies to mail you own land here, and so does mail you sent that has had no answer.</p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {needs.slice(0, 8).map((t) => <Row key={t.id} t={t} kind="needs" />)}
            {noAnswer.slice(0, 8).map((t) => <Row key={t.id} t={t} kind="no_answer" />)}
          </ul>
        )}
      {needs.length > 8 || noAnswer.length > 8 ? <Link to={`${ROUTES.mail}?status=needs`} className="mt-2 inline-block text-xs text-brand hover:underline">See all</Link> : null}
    </div>
  )
}

function Row({ t, kind }: { t: ThreadRow; kind: 'needs' | 'no_answer' }) {
  return (
    <li className="py-2">
      <Link to={`${ROUTES.mail}/${t.id}`} className="block rounded-lg px-1 hover:bg-stone-50">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-stone-900">
            {kind === 'no_answer' ? <span className="mr-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">No answer yet</span> : null}
            {t.vendor?.name ?? senderLabel(t.last)} · {t.subject || '(no subject)'}
          </p>
          <span className="shrink-0 text-xs text-stone-500">{waited(kind === 'no_answer' ? t.follow_up_at : t.last_message_at)}</span>
        </div>
        {t.last?.snippet ? <p className="truncate text-xs text-stone-500">{t.last.snippet}</p> : null}
      </Link>
    </li>
  )
}
