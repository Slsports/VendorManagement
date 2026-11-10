import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Plus, Snowflake } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { useTableSort } from '@/hooks/useTableSort'
import { addBooks, deleteBook, getSeason, lsSold, openSeasonByHand, uploadSeasonForm, type AddBooksInput, type SeasonView } from '@/services/snopark'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { BOOK_STATUS, KIND_LABELS, MAIL_TO, REPORT_STATUS, daysUntil, money, nextBookNumber, permitsIn, range, reportTitle } from '@/lib/snopark'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Modal } from '@/components/shared/Modal'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'
import type { SnoparkBook } from '@/types'

/**
 * Sno-Park passes (Dana, Nov 5-6, 2026): the season's books with the permit numbers inside each one, and the monthly reports
 * to the State. Books are entered when they arrive; each month Cat picks the empty ones on the report page.
 */
export default function SnoParkPage() {
  const { organization, profile, isAdmin } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? getSeason(organization.id) : null), [organization?.id])
  useLiveTable('snopark_books', organization ? `organization_id=eq.${organization.id}` : null, () => { void q.refetch() })
  useLiveTable('snopark_reports', organization ? `organization_id=eq.${organization.id}` : null, () => { void q.refetch() })
  const canEdit = ['admin', 'manager', 'buyer'].includes(profile?.role ?? '')
  const [adding, setAdding] = useState(false)
  const [opening, setOpening] = useState(false)
  const view = q.data
  const ls = useSupabaseQuery(async () => (view ? lsSold(view.season.id) : null), [view?.season.id])
  const books = view?.books ?? []
  const { sorted, sort, toggle } = useTableSort(books, {
    book: (b) => b.book_number,
    kind: (b) => b.kind,
    permits: (b) => b.first_permit,
    count: (b) => permitsIn(b),
    received: (b) => b.received_on ?? '',
    status: (b) => b.status,
  }, { param: 'bk_sort' })

  async function remove(b: SnoparkBook) {
    if (!window.confirm(`Remove book ${b.book_number} (permits ${range(b.first_permit, b.last_permit)})? Only for a book entered by mistake.`)) return
    try { await deleteBook(b.id); toast.success('Removed'); await q.refetch() } catch (e) { toast.error(errorMessage(e)) }
  }

  const onHand = books.filter((b) => b.status === 'on_hand')
  const permitsOnHand = (kind: SnoparkBook['kind']) => onHand.filter((b) => b.kind === kind).reduce((n, b) => n + permitsIn(b), 0)
  const reported = (kind: SnoparkBook['kind']) => books.filter((b) => b.kind === kind && b.status !== 'on_hand').reduce((n, b) => n + permitsIn(b), 0)

  return (
    <div>
      <BackLink fallback={ROUTES.dashboard} fallbackLabel="Dashboard" />
      <PageHeader title="Sno-Park passes" description="The State's permit books we hold, with the permit numbers inside each one, and the monthly reports. Books are entered when they arrive; on the 15th Cat reports the empty ones, and the report, the check and the empty books go by mail."
        actions={canEdit && view ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />Add books</Button> : null} />
      {q.isLoading ? <Spinner /> : q.error ? <Alert variant="error">{errorMessage(q.error)}</Alert> : !view ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
          <p>No season is open yet. It opens on its own when the State emails the season's vendor packet ("Vendor Registration") to billing@.</p>
          {isAdmin ? <Button className="mt-3" variant="secondary" onClick={() => setOpening(true)}>Open a season by hand</Button> : null}
        </section>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Season</p>
              <p className="mt-1 text-lg font-semibold text-stone-900">{view.season.label} <Badge tone={view.season.status === 'open' ? 'success' : 'neutral'}>{view.season.status === 'open' ? 'Open' : 'Closed'}</Badge></p>
              <p className="mt-1 text-xs text-stone-600">Reports due the 15th, the first for {reportTitle({ kind: 'monthly', month: view.season.first_report_month }).replace(' report', '')} on {shortDate(view.season.first_report_month.slice(0, 4) + '-12-15')}. Final due {shortDate(view.season.final_due)}.</p>
              {view.vendor ? <Link to={`${ROUTES.vendors}/${view.vendor.id}`} className="mt-1 inline-block text-xs text-brand hover:underline">{view.vendor.name}</Link> : null}
              <SeasonForm view={view} canEdit={canEdit} userId={profile?.id ?? null} onDone={() => { void q.refetch() }} />
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Permits on hand</p>
              <p className="mt-1 text-lg font-semibold text-stone-900">{permitsOnHand('day').toLocaleString()} day · {permitsOnHand('season').toLocaleString()} season</p>
              <p className="mt-1 text-xs text-stone-600">In {onHand.length} book{onHand.length === 1 ? '' : 's'}. Reported or returned: {reported('day').toLocaleString()} day, {reported('season').toLocaleString()} season.</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Sold in Lightspeed this season</p>
              {ls.isLoading ? <Spinner /> : ls.data ? <p className="mt-1 text-lg font-semibold text-stone-900">{ls.data.day.toLocaleString()} day · {ls.data.season.toLocaleString()} season</p> : <p className="mt-1 text-sm text-stone-500">Not available</p>}
              <p className="mt-1 text-xs text-stone-600">A check against the books, from LS sales since October 1. Permits sold from books that are not empty yet are the difference.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Snowflake className="size-4" aria-hidden="true" />Reports</h2>
            {view.reports.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">The first report appears on {shortDate(view.season.first_report_month.slice(0, 4) + '-12-01')}, as a task for the person who runs Sno-Park, due the 15th.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-2 pr-3">Report</th><th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Books</th><th className="py-2 pr-3 text-right">Check</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Mailed</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {view.reports.map((r) => {
                      const late = r.status !== 'mailed' && daysUntil(r.due_on) < 0
                      return (
                        <tr key={r.id}>
                          <td className="py-2 pr-3"><Link to={`${ROUTES.snoparkReport}/${r.id}`} className="font-medium text-stone-900 hover:text-brand">{reportTitle(r, view.season)}</Link></td>
                          <td className="py-2 pr-3 text-stone-700">{shortDate(r.due_on)}</td>
                          <td className="py-2 pr-3 text-stone-700">{books.filter((b) => b.report_id === r.id).length}</td>
                          <td className="py-2 pr-3 text-right text-stone-700">{r.built_at ? money(r.total_due) : '—'}</td>
                          <td className="py-2 pr-3"><Badge tone={late ? 'danger' : REPORT_STATUS[r.status].tone}>{late ? 'Past due' : REPORT_STATUS[r.status].text}</Badge></td>
                          <td className="py-2 pr-3 text-stone-700">{r.mailed_on ? shortDate(r.mailed_on) : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-stone-500">Everything goes by mail to {MAIL_TO}: the report, the check and the empty books. Nothing is emailed.</p>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><BookOpen className="size-4" aria-hidden="true" />Books</h2>
            {books.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">No books entered yet. When the FedEx box arrives, click <strong>Add books</strong> and enter the first book number, how many books came, how many permits are in each and the first permit number. VMS numbers the rest.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                      <SortHeader label="Book" sortKey="book" sort={sort} onSort={toggle} />
                      <SortHeader label="Kind" sortKey="kind" sort={sort} onSort={toggle} />
                      <SortHeader label="Permits" sortKey="permits" sort={sort} onSort={toggle} />
                      <SortHeader label="Count" sortKey="count" sort={sort} onSort={toggle} />
                      <SortHeader label="Received" sortKey="received" sort={sort} onSort={toggle} />
                      <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} />
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {sorted.map((b) => {
                      const rep = b.report_id ? view.reports.find((r) => r.id === b.report_id) : null
                      return (
                        <tr key={b.id}>
                          <td className="py-2 pr-3 font-medium text-stone-900">{b.book_number}</td>
                          <td className="py-2 pr-3 text-stone-700">{KIND_LABELS[b.kind]}</td>
                          <td className="py-2 pr-3 text-stone-700">{range(b.first_permit, b.last_permit)}</td>
                          <td className="py-2 pr-3 text-stone-700">{permitsIn(b)}</td>
                          <td className="py-2 pr-3 text-stone-700">{b.received_on ? shortDate(b.received_on) : ''}{b.order_id ? <> · <Link to={`${ROUTES.orders}/${b.order_id}`} className="text-brand hover:underline">order</Link></> : null}</td>
                          <td className="py-2 pr-3"><Badge tone={BOOK_STATUS[b.status].tone}>{BOOK_STATUS[b.status].text}</Badge>{rep ? <> <Link to={`${ROUTES.snoparkReport}/${rep.id}`} className="text-xs text-brand hover:underline">{reportTitle(rep, view.season)}</Link></> : null}</td>
                          <td className="py-2 text-right">{canEdit && b.status === 'on_hand' ? <button type="button" onClick={() => remove(b)} className="text-xs text-stone-500 hover:text-red-700">Remove</button> : null}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
      {adding && view ? <AddBooks seasonId={view.season.id} books={books} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void q.refetch() }} /> : null}
      {opening ? <OpenSeason onClose={() => setOpening(false)} onDone={() => { setOpening(false); void q.refetch() }} /> : null}
    </div>
  )
}

function AddBooks({ seasonId, books, onClose, onDone }: { seasonId: string; books: SnoparkBook[]; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<SnoparkBook['kind']>('day')
  const next = nextBookNumber(books, kind)
  const [firstBook, setFirstBook] = useState(next?.book ?? '')
  const [count, setCount] = useState('1')
  const [perBook, setPerBook] = useState(kind === 'day' ? '25' : '10')
  const [firstPermit, setFirstPermit] = useState(next ? String(next.permit) : '')
  const [received, setReceived] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = Number(count) || 0, per = Number(perBook) || 0, fp = Number(firstPermit) || 0
  const last = fp && n && per ? fp + n * per - 1 : null

  function pickKind(k: SnoparkBook['kind']) {
    setKind(k)
    const nx = nextBookNumber(books, k)
    setFirstBook(nx?.book ?? '')
    setFirstPermit(nx ? String(nx.permit) : '')
    setPerBook(k === 'day' ? '25' : '10')
  }

  async function submit() {
    setBusy(true); setError(null)
    try {
      const input: AddBooksInput = { season_id: seasonId, kind, first_book: firstBook.trim(), books: n, per_book: per, first_permit: fp, received_on: received || null, order_id: null }
      const added = await addBooks(input)
      toast.success(`${added} book${added === 1 ? '' : 's'} entered`)
      onDone()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Modal title="Add books" submitLabel={busy ? 'Saving…' : 'Add books'} busy={busy} onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-stone-600">From the FedEx box: the first book number, how many books came, how many permits are in each book, and the first permit number. VMS numbers the rest in order.</p>
      <FormField label="Kind" htmlFor="sp-kind">
        <Select id="sp-kind" value={kind} onChange={(e) => pickKind(e.target.value as SnoparkBook['kind'])}><option value="day">Day permits</option><option value="season">Season permits</option></Select>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First book number" htmlFor="sp-book" hint="As printed on the cover, like B450"><Input id="sp-book" value={firstBook} onChange={(e) => setFirstBook(e.target.value)} required /></FormField>
        <FormField label="How many books" htmlFor="sp-count"><Input id="sp-count" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} required /></FormField>
        <FormField label="Permits in each book" htmlFor="sp-per"><Input id="sp-per" type="number" min={1} max={500} value={perBook} onChange={(e) => setPerBook(e.target.value)} required /></FormField>
        <FormField label="First permit number" htmlFor="sp-permit" hint="The first permit in the first book"><Input id="sp-permit" type="number" min={1} value={firstPermit} onChange={(e) => setFirstPermit(e.target.value)} required /></FormField>
        <FormField label="Received on" htmlFor="sp-received"><Input id="sp-received" type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></FormField>
      </div>
      {last ? <p className="text-sm text-stone-700">Permits {fp.toLocaleString()} to {last.toLocaleString()}: {(n * per).toLocaleString()} {KIND_LABELS[kind].toLowerCase()} permits in {n} book{n === 1 ? '' : 's'}.</p> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
    </Modal>
  )
}

function OpenSeason({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(() => { const y = new Date().getFullYear(); return `${y}-${y + 1}` })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true); setError(null)
    try { await openSeasonByHand(label.trim()); toast.success('Season opened'); onDone() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Open a season" submitLabel={busy ? 'Opening…' : 'Open season'} busy={busy} onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-stone-600">Only when the State's packet came some other way. The first report is for November, due December 15; the final is due June 20.</p>
      <FormField label="Season" htmlFor="sp-season" hint="Written like 2026-2027"><Input id="sp-season" value={label} onChange={(e) => setLabel(e.target.value)} required /></FormField>
      {error ? <Alert variant="error">{error}</Alert> : null}
    </Modal>
  )
}

/** The State's form for the season: they send a new one every year; VMS fills whichever is on file. */
function SeasonForm({ view, canEdit, userId, onDone }: { view: SeasonView; canEdit: boolean; userId: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  async function pick(files: FileList | null) {
    if (!files?.[0] || !view.vendor || !userId) return
    setBusy(true)
    try { await uploadSeasonForm(view.season, view.vendor.id, files[0], userId); toast.success("The State's form is on file for this season"); onDone() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  return (
    <div className="mt-2 text-xs text-stone-600">
      {view.form ? <p>The State's form: <span className="font-medium text-stone-800">{view.form.file_name}</span></p> : <p>The State's form for this season is not on file; VMS uses the 2026-2027 form it was built with.</p>}
      {canEdit ? <label className="mt-1 inline-block cursor-pointer text-brand hover:underline">{busy ? 'Uploading…' : view.form ? 'Replace it' : "Upload the State's form (.xlsx)"}<input ref={ref} type="file" accept=".xlsx" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files)} /></label> : null}
    </div>
  )
}
