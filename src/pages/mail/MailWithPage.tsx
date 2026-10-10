import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Paperclip } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import { listMailWith, type MailWithRow } from '@/services/mail'
import { emailDomain, isFreeMail } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Spinner } from '@/components/ui'

const COLUMNS = {
  date: (r: MailWithRow) => r.received_at,
  who: (r: MailWithRow) => (r.direction === 'out' ? r.to_emails[0] : r.from_name || r.from_email),
  subject: (r: MailWithRow) => r.subject,
  vendor: (r: MailWithRow) => r.vendor_name,
}

/**
 * All mail with one person (Dana, Oct 10: "click on the name of the 'from' email and have it bring up all my
 * emails with them in chronological order newest to oldest"). Every email from, to or copied to the address,
 * newest first; "Everyone at this company" widens it to the whole address ending.
 */
export default function MailWithPage() {
  const { organization } = useAuth()
  const [params, setParams] = useSearchParams()
  const email = (params.get('email') ?? '').trim().toLowerCase()
  const company = params.get('company') === '1' && !isFreeMail(email)
  const q = useSupabaseQuery(async () => (organization && email ? listMailWith(organization.id, email, company) : []), [organization?.id, email, company])
  const rows = q.data ?? []
  const { sorted, sort, toggle } = useTableSort(rows, COLUMNS, { descFirst: ['date'] })
  const name = rows.find((r) => r.from_email?.toLowerCase() === email && r.from_name)?.from_name
  const vendor = rows.find((r) => r.vendor_name)?.vendor_name

  function setCompany(on: boolean) {
    const p = new URLSearchParams(params)
    if (on) p.set('company', '1')
    else p.delete('company')
    setParams(p, { replace: true })
  }

  const title = company ? `Everyone at ${emailDomain(email)}` : name ?? email
  const description = company ? 'Every email with anyone at this company, newest first.' : `${name ? `${email} · ` : ''}every email from, to or copied to them, newest first.`
  return (
    <div className="mx-auto max-w-6xl">
      <BackLink fallback={ROUTES.mail} fallbackLabel="Mail" />
      <PageHeader eyebrow={vendor ? `Mail with · ${vendor}` : 'Mail with'} title={title || 'Mail'} description={email ? description : undefined} />
      {!email ? <Alert variant="error">No email address chosen.</Alert> : null}
      {email && !isFreeMail(email) ? (
        <label className="mb-4 flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={company} onChange={(e) => setCompany(e.target.checked)} className="size-4 rounded border-stone-300 accent-brand" />
          Everyone at this company (@{emailDomain(email)})
        </label>
      ) : null}
      {q.error ? <Alert variant="error">{q.error}</Alert> : null}
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner label="Loading mail…" className="text-brand" /></div> : email && !q.error ? (
        rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 px-6 py-12 text-center text-sm text-stone-600">No emails with {company ? `anyone at ${emailDomain(email)}` : email}.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-stone-600">{rows.length}{rows.length >= 1000 ? '+' : ''} email{rows.length === 1 ? '' : 's'}</p>
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs text-stone-500">
                  <tr>
                    <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggle} className="px-3 py-2" />
                    <SortHeader label="From / to" sortKey="who" sort={sort} onSort={toggle} className="px-3 py-2" />
                    <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={toggle} className="px-3 py-2" />
                    <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {sorted.map((r) => {
                    const out = r.direction === 'out'
                    const link = `${ROUTES.mail}/${r.thread_id}`
                    return (
                      <tr key={r.id} className="align-top hover:bg-stone-50">
                        <td className="whitespace-nowrap px-3 py-2 text-stone-600">
                          <Link to={link} className="block" title={new Date(r.received_at).toLocaleString()}>{new Date(r.received_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link to={link} className="flex items-center gap-1">
                            {out ? <ArrowUpRight className="size-4 shrink-0 text-brand" aria-label="We sent" /> : <ArrowDownLeft className="size-4 shrink-0 text-stone-400" aria-label="From them" />}
                            <span className="min-w-0 truncate">{out ? `To ${r.to_emails.join(', ')}` : r.from_name || r.from_email}</span>
                          </Link>
                        </td>
                        <td className="max-w-md px-3 py-2">
                          <Link to={link} className="block hover:text-brand">
                            <span className="flex items-center gap-1 font-medium text-stone-900">
                              <span className="truncate">{r.subject || '(no subject)'}</span>
                              {r.has_attachments ? <Paperclip className="size-3.5 shrink-0 text-stone-400" aria-label="Has attachments" /> : null}
                            </span>
                            <span className="block truncate text-xs text-stone-500">{r.snippet}</span>
                          </Link>
                        </td>
                        <td className="hidden px-3 py-2 text-stone-600 md:table-cell">{r.vendor_name ?? ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </div>
  )
}
