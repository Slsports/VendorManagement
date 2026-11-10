import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Camera, FileCheck, FileText, Map, Plus, Printer, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { acceptShipment, checkShipment, confirmSheet, enteredByHand, flagShipment, getShipment, mapPrinted, receiveInLs, saveShipmentBooks, uploadSheet, type ShipmentView } from '@/services/snopark'
import { signedFileUrl } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { EMPTY_SHEET, KIND_LABELS, SHIPMENT_STATUS, newRow, rowProblem, rowsFromSheet, type BookRowInput, type Difference, type Sheet } from '@/lib/snopark'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'
import type { SnoparkBook } from '@/types'

/**
 * Receiving a box of Sno-Park books (Dana, Nov 10, 2026): the State's sheet that came in the box is scanned and read, the
 * person confirms what it says, enters every book (number, first and last permit), and VMS checks the two against each
 * other and the standard book size. Balanced: the books go into Lightspeed as a checked-in PO with the dated note on each
 * item. Off: the person gets the differences, a task, and an email draft to the State (cc Dana) to send.
 */
export default function SnoParkReceivePage() {
  const { id } = useParams<{ id: string }>()
  const { profile, isAdmin } = useAuth()
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
  return (
    <div>
      <BackLink fallback={ROUTES.snopark} fallbackLabel="Sno-Park" />
      <PageHeader title={`Books received ${shortDate(shipment.received_on)}`}
        description={view.order ? <>For the order {view.order.po_number ? <Link to={`${ROUTES.orders}/${view.order.id}`} className="text-brand hover:underline">{view.order.po_number}</Link> : <Link to={`${ROUTES.orders}/${view.order.id}`} className="text-brand hover:underline">placed {view.order.order_date ? shortDate(view.order.order_date) : ''}</Link>}{view.order.description ? ` (${view.order.description})` : ''}. Scan the State's sheet, enter every book, and VMS checks the box against the sheet before anything goes into Lightspeed.</> : "Scan the State's sheet, enter every book, and VMS checks the box against the sheet before anything goes into Lightspeed."}
        actions={<Badge tone={st.tone}>{st.text}</Badge>} />
      {view.flowchart ? <p className="mb-4 text-sm"><FileLink link={view.flowchart} icon={<FileText className="size-4" aria-hidden="true" />} label="The State's instructions (flowchart)" /></p> : null}
      <div className="space-y-6">
        <SheetStep view={view} locked={locked} userId={profile?.id ?? null} onDone={() => { void q.refetch() }} />
        <BooksStep view={view} locked={locked} onDone={() => { void q.refetch() }} />
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
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Printer className="size-4" aria-hidden="true" />4. The Sno-Park map</h2>
      {done ? <p className="mt-2 text-sm text-stone-700">Printed {shortDate(view.season.map_printed_at!)} and copies made for the register. <FileLink link={view.map} icon={<Map className="size-4" aria-hidden="true" />} label={`${view.season.label} map`} /></p> : (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-amber-900">
          <p className="grow">Print this season's map, make copies and put them by the register: <FileLink link={view.map} icon={<Map className="size-4" aria-hidden="true" />} label={`${view.season.label} Sno-Park map`} /></p>
          {canEdit ? <Button size="sm" onClick={printed} disabled={busy}>{busy ? 'Saving…' : 'Printed and copied'}</Button> : null}
        </div>
      )}
    </section>
  )
}

/** 1. The State's sheet: a photo or scan, read by VMS, confirmed by the person. */
function SheetStep({ view, locked, userId, onDone }: { view: ShipmentView; locked: boolean; userId: string | null; onDone: () => void }) {
  const { shipment } = view
  const saved = (shipment.sheet as unknown as Sheet | null) ?? null
  const [edit, setEdit] = useState<Sheet | null>(null)
  const sheet = edit ?? saved ?? EMPTY_SHEET
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const confirmed = !!shipment.sheet_confirmed_at
  const num = (v: number | null) => (v == null ? '' : String(v))
  const setKind = (k: 'day' | 'season', f: 'from' | 'to' | 'books' | 'permits', v: string) => setEdit({ ...sheet, [k]: { ...sheet[k], [f]: v === '' ? null : Number(v) } })

  async function pick(files: FileList | null) {
    if (!files?.[0] || !view.vendor || !userId) return
    setBusy('read')
    try {
      const r = await uploadSheet(shipment, view.vendor.id, files[0], userId)
      setEdit(r.sheet)
      toast.success(r.sheet.unclear?.length ? 'Sheet read; check the numbers marked unclear' : 'Sheet read; check the numbers')
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null); if (ref.current) ref.current.value = '' }
  }
  async function confirm() {
    setBusy('confirm')
    try { await confirmSheet(shipment.id, { ...sheet, unclear: [] }); setEdit(null); toast.success('Sheet confirmed'); onDone() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  async function open() {
    if (!view.sheetFile?.storage_path) return
    try { window.open(await signedFileUrl(view.sheetFile.storage_path), '_blank', 'noopener') } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><FileCheck className="size-4" aria-hidden="true" />1. The State's sheet</h2>
      <p className="mt-1 text-sm text-stone-600">The Vendor Permit Request Form (confirmation sheet) that came in the box. Upload the scan or PDF from your computer, or take a picture on your phone; VMS reads the State's verification box (the permit ranges, books and permits issued) and you check it against the paper.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {view.sheetFile ? <button type="button" onClick={open} className="text-sm text-brand hover:underline">{view.sheetFile.file_name}</button> : null}
        {!locked ? <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"><Camera className="size-4" aria-hidden="true" />{busy === 'read' ? 'Reading the sheet…' : view.sheetFile ? 'Upload or scan it again' : 'Upload or scan the sheet'}<input ref={ref} type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy !== null} onChange={(e) => pick(e.target.files)} /></label> : null}
      </div>
      {(saved || edit) ? (
        <div className="mt-4">
          {sheet.unclear?.length ? <Alert variant="warning">VMS was not sure about: {sheet.unclear.join('; ')}. Look at the paper and correct the numbers before you confirm.</Alert> : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-2 pr-3">Issued</th><th className="py-2 pr-3">From</th><th className="py-2 pr-3">Including</th><th className="py-2 pr-3">Books</th><th className="py-2 pr-3">Permits</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {(['day', 'season'] as const).map((k) => (
                  <tr key={k}>
                    <td className="py-2 pr-3 font-medium text-stone-900">{KIND_LABELS[k]} permits</td>
                    {(['from', 'to', 'books', 'permits'] as const).map((f) => (
                      <td key={f} className="py-2 pr-3"><Input type="number" inputMode="numeric" value={num(sheet[k][f])} onChange={(e) => setKind(k, f, e.target.value)} disabled={locked || confirmed && !edit} className="w-28" aria-label={`${KIND_LABELS[k]} ${f}`} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <FormField label="Season on the sheet" htmlFor="sh-season"><Input id="sh-season" value={sheet.season_label ?? ''} onChange={(e) => setEdit({ ...sheet, season_label: e.target.value || null })} disabled={locked || confirmed && !edit} /></FormField>
            <FormField label="Date shipped" htmlFor="sh-shipped"><Input id="sh-shipped" type="date" value={sheet.shipped_on ?? ''} onChange={(e) => setEdit({ ...sheet, shipped_on: e.target.value || null })} disabled={locked || confirmed && !edit} /></FormField>
          </div>
          {!locked ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {confirmed && !edit ? <><p className="text-sm text-emerald-800">Confirmed {shortDate(shipment.sheet_confirmed_at!)}.</p><Button variant="secondary" onClick={() => setEdit(sheet)}>Change it</Button></> : <Button onClick={confirm} disabled={busy !== null}>{busy === 'confirm' ? 'Saving…' : 'The sheet says this'}</Button>}
              {edit && confirmed ? <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button> : null}
            </div>
          ) : null}
        </div>
      ) : !locked ? <p className="mt-3 text-xs text-stone-500">No sheet in the box? Type the numbers from it instead: <button type="button" className="text-brand hover:underline" onClick={() => setEdit(EMPTY_SHEET)}>enter the sheet by hand</button>. Without a sheet, VMS can only check the book sizes.</p> : null}
    </section>
  )
}

/** 2. Every book in the box: its number from the cover, its first and last permit. */
function BooksStep({ view, locked, onDone }: { view: ShipmentView; locked: boolean; onDone: () => void }) {
  const { shipment, season } = view
  const per = { day: season.day_per_book, season: season.season_per_book }
  const fromSaved = (books: SnoparkBook[]): BookRowInput[] => books.map((b) => ({ key: b.id, kind: b.kind, book_number: b.book_number, first_permit: String(b.first_permit), last_permit: String(b.last_permit) }))
  const [rows, setRows] = useState<BookRowInput[] | null>(null)
  const sheet = (shipment.sheet as unknown as Sheet | null) ?? null
  const shown = rows ?? fromSaved(view.books)
  const [busy, setBusy] = useState(false)
  const onReport = view.books.filter((b) => b.status !== 'on_hand')
  const dirty = rows !== null

  function suggest() {
    if (!sheet) return
    const s = rowsFromSheet(sheet, per)
    if (!s.length) { toast.error("The sheet's ranges are not a whole number of books, so VMS cannot cut them into books. Enter each book from its cover."); return }
    setRows(s)
  }
  function update(key: string, patch: Partial<BookRowInput>) { setRows(shown.map((r) => (r.key === key ? { ...r, ...patch } : r))) }
  function add(kind: 'day' | 'season') {
    const mine = shown.filter((r) => r.kind === kind)
    const last = mine[mine.length - 1]
    const nextFirst = last && Number(last.last_permit) ? Number(last.last_permit) + 1 : null
    const m = last?.book_number.match(/^(.*?)(\d+)$/)
    const nextBook = m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2]!.length, '0')}` : ''
    setRows([...shown, newRow(kind, nextFirst ? String(nextFirst) : '', nextFirst ? String(nextFirst + per[kind] - 1) : '', nextBook)])
  }
  async function save() {
    const bad = shown.map((r) => rowProblem(r, per)).filter((p) => p && /^(Book number|Permit numbers|Last before first)$/.test(p))
    if (bad.length) { toast.error('Every row needs a book number and its first and last permit'); return }
    setBusy(true)
    try {
      const n = await saveShipmentBooks(shipment.id, shown.map((r) => ({ kind: r.kind, book_number: r.book_number.trim(), first_permit: Number(r.first_permit), last_permit: Number(r.last_permit) })))
      setRows(null)
      toast.success(`${n} book${n === 1 ? '' : 's'} saved`)
      onDone()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">2. The books in the box</h2>
      <p className="mt-1 text-sm text-stone-600">One row per book, from its cover: the book number and the first and last permit number inside. A day book holds {per.day} permits, a season book {per.season}; a row of another size is marked.</p>
      {onReport.length ? <p className="mt-2 text-xs text-stone-500">{onReport.length} book{onReport.length === 1 ? ' from this box is' : 's from this box are'} already on a report and cannot be changed here.</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">Book #</th><th className="py-2 pr-3">Starting permit #</th><th className="py-2 pr-3">Ending permit #</th><th className="py-2 pr-3">Permits</th><th className="py-2" /></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {shown.length === 0 ? <tr><td colSpan={6} className="py-3 text-sm text-stone-500">No books entered yet.</td></tr> : null}
            {shown.map((r) => {
              const problem = rowProblem(r, per)
              const n = Number(r.last_permit) - Number(r.first_permit) + 1
              return (
                <tr key={r.key} className={problem && r.first_permit && r.last_permit && r.book_number ? 'bg-red-50/60' : ''}>
                  <td className="py-1.5 pr-3"><Select value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as 'day' | 'season' })} disabled={locked} aria-label="Kind"><option value="day">Day</option><option value="season">Season</option></Select></td>
                  <td className="py-1.5 pr-3"><Input value={r.book_number} onChange={(e) => update(r.key, { book_number: e.target.value })} disabled={locked} placeholder="DB 543" className="w-28" aria-label="Book number" /></td>
                  <td className="py-1.5 pr-3"><Input type="number" inputMode="numeric" value={r.first_permit} onChange={(e) => update(r.key, { first_permit: e.target.value, last_permit: r.last_permit || (e.target.value ? String(Number(e.target.value) + per[r.kind] - 1) : '') })} disabled={locked} className="w-28" aria-label="Starting permit" /></td>
                  <td className="py-1.5 pr-3"><Input type="number" inputMode="numeric" value={r.last_permit} onChange={(e) => update(r.key, { last_permit: e.target.value })} disabled={locked} className="w-28" aria-label="Ending permit" /></td>
                  <td className="py-1.5 pr-3 text-stone-700">{Number.isFinite(n) && n > 0 ? n : ''}{problem && r.first_permit && r.last_permit ? <span className="ml-2 text-xs text-red-700">{problem}</span> : null}</td>
                  <td className="py-1.5 text-right">{!locked ? <button type="button" onClick={() => setRows(shown.filter((x) => x.key !== r.key))} className="text-stone-400 hover:text-red-700" aria-label="Remove row"><Trash2 className="size-4" /></button> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!locked ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => add('day')}><Plus className="size-4" aria-hidden="true" />Day book</Button>
          <Button variant="secondary" onClick={() => add('season')}><Plus className="size-4" aria-hidden="true" />Season book</Button>
          {sheet && shipment.sheet_confirmed_at && !shown.length ? <Button variant="ghost" onClick={suggest}>Fill the rows from the sheet</Button> : null}
          <span className="grow" />
          {dirty ? <Button variant="ghost" onClick={() => setRows(null)}>Cancel</Button> : null}
          <Button onClick={save} disabled={busy || (!dirty && view.books.length > 0)}>{busy ? 'Saving…' : 'Save the books'}</Button>
        </div>
      ) : null}
    </section>
  )
}

/** 3. The check, and what happens next: Lightspeed, or the email to the State. */
function CheckStep({ view, locked, isAdmin, onDone }: { view: ShipmentView; locked: boolean; isAdmin: boolean; onDone: () => void }) {
  const { shipment } = view
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

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">3. The check</h2>
      {shipment.status === 'done' ? (
        <div className="mt-2 space-y-2 text-sm text-stone-700">
          <p>The box balanced{shipment.accepted_note ? ` (accepted by Dana: ${shipment.accepted_note})` : ''} and the books are in Lightspeed{shipment.ls_order_id ? ` as PO ${shipment.ls_order_id}` : ''}, with the dated note on each permit item.</p>
          {shipment.ls_note ? <p className="text-xs text-stone-500">{shipment.ls_note}</p> : null}
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-600">When every book is entered, click <strong>All books received</strong>. VMS compares the books with the sheet and the standard book sizes. If it all matches, the books go into Lightspeed by themselves: a purchase order under the State's vendor, checked in, and a dated note on each permit item saying who received which books and permit numbers. For a box someone already entered in Lightspeed by hand, click <strong>Already in Lightspeed</strong> instead: the check still runs, and no second purchase order is made.</p>
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
              <Button onClick={run} disabled={busy !== null || !ready}>{busy === 'check' ? 'Checking…' : 'All books received'}</Button>
              {shipment.status === 'off' ? <Button variant="secondary" onClick={flag} disabled={busy !== null}>{busy === 'flag' ? 'Drafting…' : shipment.draft_id ? 'Draft the email again' : 'Email the State'}</Button> : null}
              {shipment.status === 'off' && shipment.draft_id ? <Link to={`/mail?view=drafts&draft=${shipment.draft_id}`} className="text-sm text-brand hover:underline">Open the email to send</Link> : null}
              {shipment.status === 'balanced' ? <Button variant="secondary" onClick={toLs} disabled={busy !== null}>{busy === 'ls' ? 'Entering…' : 'Enter it in Lightspeed'}</Button> : null}
              {ready && shipment.status !== 'off' ? <Button variant="ghost" onClick={byHand} disabled={busy !== null}>{busy === 'byhand' ? 'Checking…' : 'Already in Lightspeed'}</Button> : null}
              {!ready ? <p className="text-xs text-stone-500">Confirm the sheet and save the books first.</p> : null}
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
