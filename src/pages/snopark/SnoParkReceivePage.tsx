import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Camera, FileCheck, FileText, Map, Plus, Printer, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { acceptShipment, checkShipment, confirmSheet, enteredByHand, flagShipment, getShipment, mapPrinted, receiveInLs, removeShipment, saveShipmentBooks, uploadCovers, uploadSheet, type ShipmentView } from '@/services/snopark'
import { signedFileUrl } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { EMPTY_SHEET, KIND_LABELS, SHIPMENT_STATUS, applyCovers, bookNumberAfter, booksFromSheetRows, newSheetRow, sheetFromRows, sheetRowBooks, sheetRowsOf, type Difference, type Sheet, type SheetRow } from '@/lib/snopark'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

/**
 * Receiving a box of Sno-Park books (Dana, Nov 10, 2026): the State's sheet that came in the box is scanned and read, the
 * person confirms what it says, enters every book (number, first and last permit), and VMS checks the two against each
 * other and the standard book size. Balanced: the books go into Lightspeed as a checked-in PO with the dated note on each
 * item. Off: the person gets the differences, a task, and an email draft to the State (cc Dana) to send.
 */
export default function SnoParkReceivePage() {
  const { id } = useParams<{ id: string }>()
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (id ? getShipment(id) : null), [id])
  useLiveTable('snopark_shipments', id ? `id=eq.${id}` : null, () => { void q.refetch() })
  const canEdit = ['admin', 'manager', 'buyer'].includes(profile?.role ?? '')
  const view = q.data
  if (q.isLoading) return <Spinner />
  if (q.error) return <Alert variant="error">{errorMessage(q.error)}</Alert>
  if (!view) return <Alert variant="error">Box not found.</Alert>
  const { shipment } = view
  const locked = shipment.status === 'done' || !canEdit
  const st = SHIPMENT_STATUS[shipment.status]
  const empty = shipment.status === 'open' && !shipment.sheet_link_id && !shipment.sheet && view.books.length === 0
  async function remove() {
    if (!window.confirm('Remove this empty box? Only for one started by mistake.')) return
    try { await removeShipment(shipment.id); toast.success('Box removed'); navigate(ROUTES.snopark) } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <div>
      <BackLink fallback={ROUTES.snopark} fallbackLabel="Sno-Park" />
      <PageHeader title={`Books received ${shortDate(shipment.received_on)}`}
        description={view.order ? <>For the order {view.order.po_number ? <Link to={`${ROUTES.orders}/${view.order.id}`} className="text-brand hover:underline">{view.order.po_number}</Link> : <Link to={`${ROUTES.orders}/${view.order.id}`} className="text-brand hover:underline">placed {view.order.order_date ? shortDate(view.order.order_date) : ''}</Link>}{view.order.description ? ` (${view.order.description})` : ''}. Scan the State's sheet, enter every book, and VMS checks the box against the sheet before anything goes into Lightspeed.</> : "Scan the State's sheet, enter every book, and VMS checks the box against the sheet before anything goes into Lightspeed."}
        actions={<div className="flex items-center gap-3"><Badge tone={st.tone}>{st.text}</Badge>{empty && canEdit ? <button type="button" onClick={remove} className="text-xs text-stone-500 hover:text-red-700">Remove this empty box</button> : null}</div>} />
      {view.flowchart ? <p className="mb-4 text-sm"><FileLink link={view.flowchart} icon={<FileText className="size-4" aria-hidden="true" />} label="The State's instructions (flowchart)" /></p> : null}
      <div className="space-y-6">
        <SheetStep view={view} locked={locked} isAdmin={isAdmin} userId={profile?.id ?? null} onDone={() => { void q.refetch() }} />
        <CheckStep view={view} locked={locked} isAdmin={isAdmin} onDone={() => { void q.refetch() }} />
        <MapStep view={view} canEdit={canEdit} onDone={() => { void q.refetch() }} />
      </div>
    </div>
  )
}

function FileLink({ link, icon, label }: { link: { storage_path: string | null; file_name: string | null }; icon: React.ReactNode; label?: string }) {
  async function open() {
    if (!link.storage_path) return
    try { window.open(await signedFileUrl(link.storage_path), '_blank', 'noopener') } catch (e) { toast.error(errorMessage(e)) }
  }
  return <button type="button" onClick={open} className="inline-flex items-center gap-1.5 text-brand hover:underline">{icon}{label ?? link.file_name}</button>
}

/** 4. The season's map, printed when the first box is in (Dana, Nov 10): copies go by the register. */
function MapStep({ view, canEdit, onDone }: { view: ShipmentView; canEdit: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  if (!view.map || view.shipment.status !== 'done') return null
  const done = !!view.season.map_printed_at
  async function printed() {
    setBusy(true)
    try { await mapPrinted(view.season.id); toast.success('Map printed'); onDone() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <section className={`rounded-2xl border p-5 ${done ? 'border-stone-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Printer className="size-4" aria-hidden="true" />3. The Sno-Park map</h2>
      {done ? <p className="mt-2 text-sm text-stone-700">Printed {shortDate(view.season.map_printed_at!)} and copies made for the register. <FileLink link={view.map} icon={<Map className="size-4" aria-hidden="true" />} label={`${view.season.label} map`} /></p> : (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-amber-900">
          <p className="grow">Print this season's map, make copies and put them by the register: <FileLink link={view.map} icon={<Map className="size-4" aria-hidden="true" />} label={`${view.season.label} Sno-Park map`} /></p>
          {canEdit ? <Button size="sm" onClick={printed} disabled={busy}>{busy ? 'Saving…' : 'Printed and copied'}</Button> : null}
        </div>
      )}
    </section>
  )
}

/**
 * 1. The sheet and the books, in one go (Dana, Nov 10): the sheet's ranges (read by VMS from the scan, or typed), the
 * first and last book number from the covers on each range, and VMS makes every book. Nobody opens a book: a missing
 * book shows up as book numbers that do not add up to the sheet's range.
 */
function SheetStep({ view, locked, userId, onDone }: { view: ShipmentView; locked: boolean; isAdmin: boolean; userId: string | null; onDone: () => void }) {
  const { shipment, season } = view
  const per = { day: season.day_per_book, season: season.season_per_book }
  const saved = (shipment.sheet as unknown as Sheet | null) ?? null
  const [edit, setEdit] = useState<{ sheet: Sheet; rows: SheetRow[] } | null>(null)
  const sheet = edit?.sheet ?? saved ?? EMPTY_SHEET
  const rows = edit?.rows ?? sheetRowsOf(saved)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [coverNote, setCoverNote] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const done = shipment.status === 'done'
  const confirmed = !!shipment.sheet_confirmed_at && view.books.length > 0
  const editing = !!edit || !confirmed
  const startEdit = () => setEdit({ sheet, rows: rows.length ? rows : [newSheetRow('day'), newSheetRow('season')] })
  const setRows = (next: SheetRow[]) => setEdit({ sheet, rows: next })
  const setRow = (key: string, patch: Partial<SheetRow>) => setRows(rows.map((r) => {
    if (r.key !== key) return r
    const n = { ...r, ...patch }
    // the last book number follows the first and the range, unless typed over
    if ((patch.first_book !== undefined || patch.from !== undefined || patch.to !== undefined || patch.kind !== undefined) && n.first_book.trim()) {
      const size = sheetRowBooks(n, per[n.kind])
      if (!size.error && size.n > 0 && (patch.first_book !== undefined || !n.last_book.trim() || n.last_book === bookNumberAfter(r.first_book, sheetRowBooks(r, per[r.kind]).n - 1))) n.last_book = bookNumberAfter(n.first_book, size.n - 1)
    }
    return n
  }))

  async function pick(files: FileList | null) {
    if (!files?.[0] || !view.vendor || !userId) return
    setBusy('read')
    try {
      const r = await uploadSheet(shipment, view.vendor.id, files[0], userId)
      setEdit({ sheet: r.sheet, rows: sheetRowsOf(r.sheet) })
      toast.success(r.sheet.unclear?.length ? 'Sheet read; check the numbers marked unclear' : 'Sheet read; check the numbers against the paper')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null); if (ref.current) ref.current.value = '' }
  }
  /** The covers: VMS reads the book numbers and permit numbers and puts them on the matching rows. */
  async function pickCovers(files: FileList | null) {
    if (!files?.length || !view.vendor || !userId) return
    setBusy('covers')
    try {
      let cur = rows.length ? rows : sheetRowsOf(saved)
      let placed = 0
      const unplaced: string[] = []
      const unclear: string[] = []
      for (const f of Array.from(files)) {
        const r = await uploadCovers(shipment, view.vendor.id, f, userId)
        const a = applyCovers(cur, r.covers)
        cur = a.rows; placed += a.placed; unplaced.push(...a.unplaced); unclear.push(...r.unclear)
      }
      setEdit({ sheet, rows: cur })
      setCoverNote([placed ? `${placed} cover${placed === 1 ? '' : 's'} matched to the sheet.` : 'No cover matched a row on the sheet.', unplaced.length ? `Not on the sheet: ${unplaced.join(', ')}.` : '', unclear.length ? `Unsure about: ${unclear.join('; ')}.` : ''].filter(Boolean).join(' '))
      toast.success(placed ? 'Covers read; check the book numbers' : 'Covers read, but none matched the sheet')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null); if (coverRef.current) coverRef.current.value = '' }
  }
  async function open() {
    if (!view.sheetFile?.storage_path) return
    try { window.open(await signedFileUrl(view.sheetFile.storage_path), '_blank', 'noopener') } catch (e) { toast.error(errorMessage(e)) }
  }
  /** Confirm: the sheet is saved from the rows, the books are made, the check runs; balanced → Lightspeed (or recorded as already there). */
  async function confirm(how: 'ls' | 'byhand') {
    const made = booksFromSheetRows(rows, per)
    if (made.error) { toast.error(made.error); return }
    setBusy(how)
    try {
      await confirmSheet(shipment.id, sheetFromRows(sheet, rows, per))
      await saveShipmentBooks(shipment.id, made.books.map((b) => ({ kind: b.kind, book_number: b.book_number.trim(), first_permit: Number(b.first_permit), last_permit: Number(b.last_permit) })))
      const d = await checkShipment(shipment.id)
      setEdit(null)
      if (d.length) { toast.error(`${d.length} difference${d.length === 1 ? '' : 's'} with the sheet; see below`); onDone(); return }
      if (how === 'byhand') { await enteredByHand(shipment.id, null); toast.success(`${made.books.length} books on hand; recorded without a second PO in Lightspeed`) }
      else { const r = await receiveInLs(shipment.id); setResult(r.note); toast.success(r.stock_ok ? `${made.books.length} books on hand and in Lightspeed as PO ${r.po}` : 'In Lightspeed; Dana has a task to look at the stock') }
      onDone()
    } catch (e) { toast.error(errorMessage(e)); onDone() } finally { setBusy(null) }
  }
  const totals = (kind: 'day' | 'season') => rows.filter((r) => r.kind === kind).reduce((t, r) => { const x = sheetRowBooks(r, per[kind]); return { n: t.n + x.n, permits: t.permits + x.permits } }, { n: 0, permits: 0 })

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><FileCheck className="size-4" aria-hidden="true" />1. The State's sheet and the books</h2>
      <p className="mt-1 text-sm text-stone-600">The confirmation sheet that came in the box. Upload the scan or PDF, or take a picture on your phone; VMS reads the permit ranges. Then photograph the covers of the first and last book of each kind: VMS reads their book numbers and permit numbers and puts them on the matching rows (or type them). Check against the paper and confirm. VMS makes every book with its permit numbers.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {view.sheetFile ? <button type="button" onClick={open} className="text-sm text-brand hover:underline">{view.sheetFile.file_name}</button> : null}
        {!locked && !done ? <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"><Camera className="size-4" aria-hidden="true" />{busy === 'read' ? 'Reading the sheet…' : view.sheetFile ? 'Upload or scan it again' : 'Upload or scan the sheet'}<input ref={ref} type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy !== null} onChange={(e) => pick(e.target.files)} /></label> : null}
        {!locked && !done && (saved || edit) && editing ? <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"><Camera className="size-4" aria-hidden="true" />{busy === 'covers' ? 'Reading the covers…' : 'Photograph the first and last books'}<input ref={coverRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" disabled={busy !== null} onChange={(e) => pickCovers(e.target.files)} /></label> : null}
        {!locked && !done && !saved && !edit ? <button type="button" className="text-sm text-brand hover:underline" onClick={startEdit}>No sheet? Type it in</button> : null}
      </div>
      {coverNote ? <p className="mt-2 text-xs text-stone-600">{coverNote}</p> : null}
      {sheet.unclear?.length && editing ? <Alert variant="warning" className="mt-3">VMS was not sure about: {sheet.unclear.join('; ')}. Look at the paper and correct the numbers before you confirm.</Alert> : null}
      {(saved || edit) ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">From</th><th className="py-2 pr-3">Including</th><th className="py-2 pr-3">Books</th><th className="py-2 pr-3">Permits</th><th className="py-2 pr-3">First book #</th><th className="py-2 pr-3">Last book #</th><th className="py-2" /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const size = sheetRowBooks(r, per[r.kind])
                return (
                  <tr key={r.key} className={size.error && r.from && r.to ? 'bg-red-50/60' : ''}>
                    <td className="py-1.5 pr-3"><Select value={r.kind} onChange={(e) => setRow(r.key, { kind: e.target.value as 'day' | 'season' })} disabled={!editing} aria-label="Kind"><option value="day">Day</option><option value="season">Season</option></Select></td>
                    <td className="py-1.5 pr-3"><Input type="number" inputMode="numeric" value={r.from} onChange={(e) => setRow(r.key, { from: e.target.value })} disabled={!editing} className="w-28" aria-label="From permit" /></td>
                    <td className="py-1.5 pr-3"><Input type="number" inputMode="numeric" value={r.to} onChange={(e) => setRow(r.key, { to: e.target.value })} disabled={!editing} className="w-28" aria-label="Including permit" /></td>
                    <td className="py-1.5 pr-3 text-stone-700">{r.from && r.to ? size.n : ''}{size.error && r.from && r.to ? <span className="ml-2 text-xs text-red-700">{size.error}</span> : null}</td>
                    <td className="py-1.5 pr-3 text-stone-700">{r.from && r.to && !size.error ? size.permits : ''}</td>
                    <td className="py-1.5 pr-3"><Input value={r.first_book} onChange={(e) => setRow(r.key, { first_book: e.target.value })} disabled={!editing} placeholder={r.kind === 'day' ? 'DB 543' : 'SB 1130'} className="w-28" aria-label="First book number" /></td>
                    <td className="py-1.5 pr-3"><Input value={r.last_book} onChange={(e) => setRow(r.key, { last_book: e.target.value })} disabled={!editing} className="w-28" aria-label="Last book number" /></td>
                    <td className="py-1.5 text-right">{editing ? <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} className="text-stone-400 hover:text-red-700" aria-label="Remove row"><Trash2 className="size-4" /></button> : null}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr className="text-xs text-stone-600"><td className="py-2 pr-3" colSpan={3}>Totals</td><td className="py-2 pr-3">{totals('day').n} day · {totals('season').n} season</td><td className="py-2 pr-3">{totals('day').permits} day · {totals('season').permits} season</td><td colSpan={3} /></tr></tfoot>
          </table>
        </div>
      ) : null}
      {(saved || edit) ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <FormField label="Season on the sheet" htmlFor="sh-season"><Input id="sh-season" value={sheet.season_label ?? ''} onChange={(e) => setEdit({ sheet: { ...sheet, season_label: e.target.value || null }, rows })} disabled={!editing} /></FormField>
          <FormField label="Date shipped" htmlFor="sh-shipped"><Input id="sh-shipped" type="date" value={sheet.shipped_on ?? ''} onChange={(e) => setEdit({ sheet: { ...sheet, shipped_on: e.target.value || null }, rows })} disabled={!editing} /></FormField>
        </div>
      ) : null}
      {editing && !locked && (saved || edit) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setRows([...rows, newSheetRow('day')])}><Plus className="size-4" aria-hidden="true" />Add another row</Button>
          <span className="grow" />
          {edit && confirmed ? <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button> : null}
          <Button onClick={() => confirm('ls')} disabled={busy !== null}>{busy === 'ls' ? 'Making the books…' : 'Confirmed, books received'}</Button>
          <Button variant="secondary" onClick={() => confirm('byhand')} disabled={busy !== null}>{busy === 'byhand' ? 'Making the books…' : 'Confirmed, already in Lightspeed'}</Button>
        </div>
      ) : null}
      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <p className="text-emerald-800">Confirmed {shortDate(shipment.sheet_confirmed_at!)}: {view.books.filter((b) => b.kind === 'day').length} day and {view.books.filter((b) => b.kind === 'season').length} season books on hand.</p>
          {!locked && !done ? <Button variant="ghost" onClick={startEdit}>Change it</Button> : null}
        </div>
      ) : null}
      {result ? <Alert variant="success" className="mt-3">{result}</Alert> : null}
      {view.books.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-stone-600">The {view.books.length} books VMS made</summary>
          <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-stone-700 sm:grid-cols-2 lg:grid-cols-3">{view.books.map((b) => <li key={b.id}>{KIND_LABELS[b.kind]} {b.book_number}: {b.first_permit} – {b.last_permit}</li>)}</ul>
        </details>
      ) : null}
    </section>
  )
}

/** 3. The check, and what happens next: Lightspeed, or the email to the State. */
function CheckStep({ view, locked, isAdmin, onDone }: { view: ShipmentView; locked: boolean; isAdmin: boolean; onDone: () => void }) {
  const { shipment } = view
  const show = shipment.status === 'off' || shipment.status === 'done' || shipment.status === 'balanced'
  const diffs = (shipment.differences as unknown as Difference[]) ?? []
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const ready = !!shipment.sheet_confirmed_at && view.books.length > 0

  async function run() {
    setBusy('check')
    try {
      const d = await checkShipment(shipment.id)
      if (d.length) { toast.error(`${d.length} difference${d.length === 1 ? '' : 's'} with the sheet`); onDone(); return }
      toast.success('The box matches the sheet; entering it in Lightspeed…')
      const r = await receiveInLs(shipment.id)
      setResult(r.note)
      toast.success(r.stock_ok ? `In Lightspeed as PO ${r.po}` : 'In Lightspeed; Dana has a task to look at the stock')
      onDone()
    } catch (e) { toast.error(errorMessage(e)); onDone() } finally { setBusy(null) }
  }
  async function flag() {
    setBusy('flag')
    try { await flagShipment(shipment.id); toast.success('Task made and the email to the State drafted; it is in your Drafts'); onDone() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  async function accept() {
    setBusy('accept')
    try {
      await acceptShipment(shipment.id, note)
      const r = await receiveInLs(shipment.id)
      setResult(r.note)
      toast.success(`Accepted and in Lightspeed as PO ${r.po}`)
      onDone()
    } catch (e) { toast.error(errorMessage(e)); onDone() } finally { setBusy(null) }
  }
  async function toLs() {
    setBusy('ls')
    try { const r = await receiveInLs(shipment.id); setResult(r.note); toast.success(`In Lightspeed as PO ${r.po}`); onDone() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  // the box was already entered in Lightspeed by hand (Dana, Nov 10): the check still runs, no second LS PO
  async function byHand() {
    setBusy('byhand')
    try {
      const d = await checkShipment(shipment.id)
      if (d.length) { toast.error(`${d.length} difference${d.length === 1 ? '' : 's'} with the sheet; fix them or email the State first`); onDone(); return }
      const who = window.prompt('Who entered it in Lightspeed, and when? (optional)') ?? ''
      await enteredByHand(shipment.id, who.trim() || null)
      toast.success('Recorded; no second PO was made in Lightspeed')
      onDone()
    } catch (e) { toast.error(errorMessage(e)); onDone() } finally { setBusy(null) }
  }

  if (!show) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">2. The check</h2>
      {shipment.status === 'done' ? (
        <div className="mt-2 space-y-2 text-sm text-stone-700">
          <p>The box balanced{shipment.accepted_note ? ` (accepted by Dana: ${shipment.accepted_note})` : ''} and the books are in Lightspeed{shipment.ls_order_id ? ` as PO ${shipment.ls_order_id}` : ''}, with the dated note on each permit item.</p>
          {shipment.ls_note ? <p className="text-xs text-stone-500">{shipment.ls_note}</p> : null}
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-600">When you confirm the sheet, VMS compares the books it made with the sheet's ranges. If it all matches, the books go into Lightspeed by themselves: a purchase order under the State's vendor, checked in, and a dated note on each permit item saying who received which books and permit numbers (or, for a box already entered by hand, the box is recorded without a second purchase order).</p>
          {diffs.length ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">The box does not match:</p>
              <ul className="mt-1 list-disc pl-5">{diffs.map((d, i) => <li key={i}>{d.text}</li>)}</ul>
              <p className="mt-2 text-xs">Look at the box again and fix any row entered wrong, then click <strong>All books received</strong> again. If the box really is different from the sheet, <strong>Email the State</strong> makes you a task and drafts the email (Dana is copied) for you to read over and send.</p>
            </div>
          ) : null}
          {result ? <Alert variant="success" className="mt-3">{result}</Alert> : null}
          {!locked ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={run} disabled={busy !== null || !ready}>{busy === 'check' ? 'Checking…' : 'Check again'}</Button>
              {shipment.status === 'off' ? <Button variant="secondary" onClick={flag} disabled={busy !== null}>{busy === 'flag' ? 'Drafting…' : shipment.draft_id ? 'Draft the email again' : 'Email the State'}</Button> : null}
              {shipment.status === 'off' && shipment.draft_id ? <Link to={`/mail?view=drafts&draft=${shipment.draft_id}`} className="text-sm text-brand hover:underline">Open the email to send</Link> : null}
              {shipment.status === 'balanced' ? <Button variant="secondary" onClick={toLs} disabled={busy !== null}>{busy === 'ls' ? 'Entering…' : 'Enter it in Lightspeed'}</Button> : null}
              {ready && shipment.status !== 'off' ? <Button variant="ghost" onClick={byHand} disabled={busy !== null}>{busy === 'byhand' ? 'Checking…' : 'Already in Lightspeed'}</Button> : null}
              {!ready ? <p className="text-xs text-stone-500">Confirm the sheet first.</p> : null}
            </div>
          ) : null}
          {!locked && isAdmin && shipment.status === 'off' ? (
            <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
              <p className="text-sm font-medium text-stone-800">Accept the box as it is (Dana only)</p>
              <p className="text-xs text-stone-600">When the State has answered or you know why it differs: the books go into Lightspeed as entered. Say why.</p>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-2" placeholder="Monica confirmed book DB 544 was never shipped; they will send it next week." />
              <Button className="mt-2" variant="secondary" onClick={accept} disabled={busy !== null || !note.trim()}>{busy === 'accept' ? 'Saving…' : 'Accept and enter in Lightspeed'}</Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
