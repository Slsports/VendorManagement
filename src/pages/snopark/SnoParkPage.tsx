import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, PackageOpen, Pencil, Snowflake } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { useTableSort } from '@/hooks/useTableSort'
import { deleteBook, getSeason, lsSold, openSeasonByHand, seasonCheck, seasonOrders, startShipment, updateBookNumbers, uploadSeasonForm, type SeasonView } from '@/services/snopark'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { BOOK_STATUS, KIND_LABELS, MAIL_TO, REPORT_STATUS, SHIPMENT_STATUS, daysUntil, money, permitsIn, range, reportTitle, type SeasonCheck } from '@/lib/snopark'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Modal } from '@/components/shared/Modal'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'
import type { SnoparkBook } from '@/types'

/**
 * Sno-Park passes (Dana, Nov 5-10, 2026): the season's books with the permit numbers inside each one, the boxes received
 * (checked against the State's sheet before they go into Lightspeed), and the monthly reports to the State.
 */
export default function SnoParkPage() {
  const { organization, profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (organization ? getSeason(organization.id) : null), [organization?.id])
  useLiveTable('snopark_books', organization ? `organization_id=eq.${organization.id}` : null, () => { void q.refetch() })
  useLiveTable('snopark_reports', organization ? `organization_id=eq.${organization.id}` : null, () => { void q.refetch() })
  const canEdit = ['admin', 'manager', 'buyer'].includes(profile?.role ?? '')
  const [receiving, setReceiving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [editing, setEditing] = useState<SnoparkBook | null>(null)
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
    returned: (b) => b.returned_on ?? '',
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
        actions={canEdit && view && view.season.status === 'open' ? <Button onClick={() => setReceiving(true)}><PackageOpen className="size-4" aria-hidden="true" />Receive books</Button> : null} />
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
              <SeasonEndCheck view={view} canEdit={canEdit} onDone={() => { void q.refetch() }} />
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
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><PackageOpen className="size-4" aria-hidden="true" />Boxes received</h2>
            {view.shipments.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">No box received yet. When the FedEx box arrives, click <strong>Receive books</strong>: scan the State's sheet, enter every book, and VMS checks the box against the sheet before the books go into Lightspeed.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-2 pr-3">Received</th><th className="py-2 pr-3">Books</th><th className="py-2 pr-3">Permits</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Lightspeed</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {view.shipments.map((sh) => {
                      const mine = books.filter((b) => b.shipment_id === sh.id)
                      const st = SHIPMENT_STATUS[sh.status]
                      return (
                        <tr key={sh.id}>
                          <td className="py-2 pr-3"><Link to={`${ROUTES.snoparkReceive}/${sh.id}`} className="font-medium text-stone-900 hover:text-brand">{shortDate(sh.received_on)}</Link></td>
                          <td className="py-2 pr-3 text-stone-700">{mine.filter((b) => b.kind === 'day').length} day · {mine.filter((b) => b.kind === 'season').length} season</td>
                          <td className="py-2 pr-3 text-stone-700">{mine.filter((b) => b.kind === 'day').reduce((n, b) => n + permitsIn(b), 0).toLocaleString()} day · {mine.filter((b) => b.kind === 'season').reduce((n, b) => n + permitsIn(b), 0).toLocaleString()} season</td>
                          <td className="py-2 pr-3"><Badge tone={st.tone}>{st.text}</Badge></td>
                          <td className="py-2 pr-3 text-stone-700">{sh.ls_order_id ? `PO ${sh.ls_order_id}` : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><BookOpen className="size-4" aria-hidden="true" />Books</h2>
            {books.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">No books entered yet. They are entered when a box is received, one row per book with its number and the permit numbers inside.</p>
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
                      <SortHeader label="Returned to State" sortKey="returned" sort={sort} onSort={toggle} />
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
                          <td className="py-2 pr-3 text-stone-700">{b.returned_on ? shortDate(b.returned_on) : ''}</td>
                          <td className="py-2 text-right whitespace-nowrap">{canEdit && b.status === 'on_hand' ? <><button type="button" onClick={() => setEditing(b)} className="mr-3 text-xs text-stone-500 hover:text-brand" aria-label={`Change book ${b.book_number}`}><Pencil className="inline size-3.5" /> Change</button><button type="button" onClick={() => remove(b)} className="text-xs text-stone-500 hover:text-red-700">Remove</button></> : null}</td>
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
      {receiving && view ? <ReceiveBooks view={view} onClose={() => setReceiving(false)} onDone={(id) => { setReceiving(false); navigate(`${ROUTES.snoparkReceive}/${id}`) }} /> : null}
      {editing ? <EditBook book={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void q.refetch() }} /> : null}
      {opening ? <OpenSeason onClose={() => setOpening(false)} onDone={() => { setOpening(false); void q.refetch() }} /> : null}
    </div>
  )
}

function ReceiveBooks({ view, onClose, onDone }: { view: SeasonView; onClose: () => void; onDone: (id: string) => void }) {
  const [received, setReceived] = useState(() => new Date().toISOString().slice(0, 10))
  const [orderId, setOrderId] = useState('')
  const orders = useSupabaseQuery(async () => (view.vendor ? seasonOrders(view.vendor.id, view.season.label) : []), [view.vendor?.id, view.season.label])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true); setError(null)
    try { onDone(await startShipment(view.season.id, received, orderId || null)) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Receive books" submitLabel={busy ? 'Opening…' : 'Start'} busy={busy} onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-stone-600">A box from the State. Next: scan the sheet that came in it, enter every book, and VMS checks the box against the sheet before the books go into Lightspeed.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Received on" htmlFor="sp-received"><Input id="sp-received" type="date" value={received} onChange={(e) => setReceived(e.target.value)} required /></FormField>
        <FormField label="For the order" htmlFor="sp-order" hint="The order to the State this box answers">
          <Select id="sp-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">{orders.isLoading ? 'Loading…' : orders.data?.length ? 'Pick the order' : 'No order on file this season'}</option>
            {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.order_date ? shortDate(o.order_date) : ''} {o.po_number ?? ''}{o.description ? ` · ${o.description.slice(0, 60)}` : ''}{o.status === 'received' ? ' (received)' : ''}</option>)}
          </Select>
        </FormField>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
    </Modal>
  )
}

/** A book's number or permit numbers corrected while it is still on hand (Dana, Nov 10). */
function EditBook({ book, onClose, onDone }: { book: SnoparkBook; onClose: () => void; onDone: () => void }) {
  const [number, setNumber] = useState(book.book_number)
  const [first, setFirst] = useState(String(book.first_permit))
  const [last, setLast] = useState(String(book.last_permit))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true); setError(null)
    try { await updateBookNumbers(book.id, number.trim(), Number(first), Number(last)); toast.success('Book changed'); onDone() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Change book ${book.book_number}`} submitLabel={busy ? 'Saving…' : 'Save'} busy={busy} onSubmit={submit} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Book number" htmlFor="eb-number"><Input id="eb-number" value={number} onChange={(e) => setNumber(e.target.value)} required /></FormField>
        <FormField label="Starting permit #" htmlFor="eb-first"><Input id="eb-first" type="number" min={1} value={first} onChange={(e) => setFirst(e.target.value)} required /></FormField>
        <FormField label="Ending permit #" htmlFor="eb-last"><Input id="eb-last" type="number" min={1} value={last} onChange={(e) => setLast(e.target.value)} required /></FormField>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
    </Modal>
  )
}

/** Season end (Dana, Nov 10): LS's sales against everything reported; when off, VMS emails Dana the summary itself. */
function SeasonEndCheck({ view, canEdit, onDone }: { view: SeasonView; canEdit: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const check = view.season.ls_check as unknown as SeasonCheck | null
  if (view.season.status !== 'closed') return null
  async function run() {
    setBusy(true)
    try { const r = await seasonCheck(view.season.id); toast.success(r.check.off ? 'Off; the summary was emailed to Dana' : 'Lightspeed and the reports match'); onDone() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2 text-xs text-stone-600">
      {check ? (
        <p className={check.off ? 'text-red-800' : 'text-emerald-800'}>Season-end check: Lightspeed sold {check.day.ls} day / {check.season.ls} season; reported {check.day.reported} day / {check.season.reported} season. {check.off ? `Off${check.emailed_at ? '; emailed to Dana' : check.email_error ? `; the email failed (${check.email_error})` : ''}.` : 'They match.'}</p>
      ) : <p>Season-end check not run yet (it runs by itself the day after the final report is mailed).</p>}
      {canEdit ? <button type="button" onClick={run} disabled={busy} className="mt-1 text-brand hover:underline">{busy ? 'Checking…' : 'Run the check now'}</button> : null}
    </div>
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

/** The season whose Report of Operations form is built into the snopark function (Dana's 26-27 file). */
const BUILT_IN_FORM_SEASON = '2026-2027'

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
      {view.form ? <p>The State's form: <span className="font-medium text-stone-800">{view.form.file_name}</span></p>
        : view.season.label === BUILT_IN_FORM_SEASON ? <p>The State's {BUILT_IN_FORM_SEASON} Report of Operations form is built into VMS; nothing to upload this season. When the State sends next season's form, it goes here.</p>
        : <p>The State's form for this season is not on file. Upload the Report of Operations Excel they sent for {view.season.label}; until then VMS fills the {BUILT_IN_FORM_SEASON} form it was built with.</p>}
      {canEdit ? <label className="mt-1 inline-block cursor-pointer text-brand hover:underline">{busy ? 'Uploading…' : view.form ? 'Replace it' : view.season.label === BUILT_IN_FORM_SEASON ? "Upload a different form for this season (.xlsx)" : "Upload the State's form for this season (.xlsx)"}<input ref={ref} type="file" accept=".xlsx" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files)} /></label> : null}
    </div>
  )
}
