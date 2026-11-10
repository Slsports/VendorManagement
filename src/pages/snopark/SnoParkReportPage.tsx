import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Camera, FileSpreadsheet, FileText, Mail, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { buildReport, getReport, lsSold, makeExcel, makePacket, makePrint, markMailed, seasonCheck, uploadScan } from '@/services/snopark'
import { signedFileUrl } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { shortDate } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { KIND_LABELS, MAIL_TO, REPORT_STATUS, daysUntil, money, permitsIn, range, reportTitle, splitRows } from '@/lib/snopark'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, FormField, Input, Spinner } from '@/components/ui'
import type { SnoparkBook } from '@/types'

/**
 * One Sno-Park report (Dana, Nov 5-10, 2026). Cat ticks the books that are empty (on the final, the last permit sold in a
 * partly sold book too), VMS works out the State's numbers, fills their Excel and makes the printable form, she photographs
 * the cover of each book going back, and marks it Mailed once the form, the check and the books are in the envelope. VMS
 * then files the packet (form first, then the covers) in "Submitted permit payments" or "Season final reports".
 */
export default function SnoParkReportPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const q = useSupabaseQuery(async () => (id ? getReport(id) : null), [id])
  useLiveTable('snopark_reports', id ? `id=eq.${id}` : null, () => { void q.refetch() })
  const canEdit = ['admin', 'manager', 'buyer'].includes(profile?.role ?? '')
  const view = q.data
  const ls = useSupabaseQuery(async () => (view ? lsSold(view.season.id, view.report.kind === 'final' ? view.season.season_end : lastDayOf(view.report.month)) : null), [view?.season.id, view?.report.month])
  const [picked, setPicked] = useState<Record<string, { on: boolean; to: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [mailedOn, setMailedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [tracking, setTracking] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // the ticks: what the person changed on this visit, else what the report already has
  const pickOf = (b: SnoparkBook) => {
    if (picked[b.id]) return picked[b.id]!
    const row = view?.rows.find((r) => r.book_id === b.id && r.section === 'sold')
    return { on: !!row, to: row ? String(row.to_permit) : String(b.last_permit) }
  }

  if (q.isLoading) return <Spinner />
  if (q.error) return <Alert variant="error">{errorMessage(q.error)}</Alert>
  if (!view) return <Alert variant="error">Report not found.</Alert>
  const { report, season, books, rows, file, print, packet, scans } = view
  const isFinal = report.kind === 'final'
  const locked = report.status === 'mailed' || !canEdit
  const title = reportTitle(report, season)
  const candidates = books.filter((b) => b.status === 'on_hand' || b.report_id === report.id)
  const split = splitRows(rows)
  const late = report.status !== 'mailed' && daysUntil(report.due_on) < 0

  async function build() {
    const sold = candidates.filter((b) => pickOf(b).on).map((b) => {
      const to = Number(pickOf(b).to || b.last_permit)
      return isFinal && to !== b.last_permit ? { book_id: b.id, to_permit: to } : { book_id: b.id }
    })
    if (!sold.length && !isFinal) { toast.error('Tick at least one empty book'); return }
    setBusy('build')
    try { await buildReport(report.id, sold); setPicked({}); toast.success('Report worked out'); await q.refetch() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  async function excel() {
    setBusy('excel')
    try { const r = await makeExcel(report.id); toast.success(`Made ${r.file_name}`); await q.refetch() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  async function printForm() {
    setBusy('print')
    try {
      const r = await makePrint(report.id)
      window.open(await signedFileUrl(r.storage_path), '_blank', 'noopener')
      toast.success(`Made ${r.file_name}`)
      await q.refetch()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  async function packetNow() {
    setBusy('packet')
    try { const r = await makePacket(report.id); toast.success(`Packet filed: the form and ${r.pictures} picture${r.pictures === 1 ? '' : 's'}${r.skipped.length ? ` (left out: ${r.skipped.join(', ')})` : ''}`); await q.refetch() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  async function open(path: string) {
    try { window.open(await signedFileUrl(path), '_blank', 'noopener') } catch (e) { toast.error(errorMessage(e)) }
  }
  async function addScan(files: FileList | null) {
    if (!files?.length || !view?.vendor || !profile) return
    setBusy('scan')
    try {
      for (const f of Array.from(files)) await uploadScan(report, view.vendor.id, f, profile.id)
      toast.success(files.length === 1 ? 'Scan filed' : `${files.length} scans filed`)
      await q.refetch()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null); if (fileRef.current) fileRef.current.value = '' }
  }
  async function mailed() {
    if (!window.confirm(`Mark the ${title} mailed on ${shortDate(mailedOn)}? The books on it are marked returned and the tasks close.`)) return
    setBusy('mailed')
    try {
      await markMailed(report.id, mailedOn, tracking.trim() || null)
      toast.success('Mailed')
      // the packet as mailed: the form first, then the covers; the final also runs the season-end check
      try { await makePacket(report.id) } catch (e) { toast.error(`Mailed, but the packet was not filed: ${errorMessage(e)}. Click "File the packet" to try again.`) }
      if (isFinal) { try { await seasonCheck(season.id) } catch (e) { toast.error(`The season-end check did not run: ${errorMessage(e)}`) } }
      await q.refetch()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <BackLink fallback={ROUTES.snopark} fallbackLabel="Sno-Park" />
      <PageHeader title={title} description={isFinal
        ? `Season end: every book goes back. Tick the empty books, give the last permit sold in any partly sold book, and the rest are listed unsold. Due ${shortDate(report.due_on)}.`
        : `Tick the books that are empty (every permit sold). Partly sold books stay with us until they are empty. Due ${shortDate(report.due_on)}.`}
        actions={<Badge tone={late ? 'danger' : REPORT_STATUS[report.status].tone}>{late ? 'Past due' : REPORT_STATUS[report.status].text}</Badge>} />

      <div className="space-y-6">
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">1. The books</h2>
          {candidates.length === 0 ? <p className="mt-2 text-sm text-stone-600">No books on hand. Enter them on the <Link to={ROUTES.snopark} className="text-brand hover:underline">Sno-Park page</Link> first.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-2 pr-3">{isFinal ? 'Sold out' : 'Empty'}</th><th className="py-2 pr-3">Book</th><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">Permits</th><th className="py-2 pr-3">Count</th>{isFinal ? <th className="py-2 pr-3">Last permit sold</th> : null}</tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {candidates.map((b) => <BookRow key={b.id} book={b} isFinal={isFinal} locked={locked} pick={pickOf(b)} onChange={(v) => setPicked((p) => ({ ...p, [b.id]: v }))} />)}
                </tbody>
              </table>
            </div>
          )}
          {ls.data ? <p className="mt-3 text-xs text-stone-500">Lightspeed shows {ls.data.day.toLocaleString()} day and {ls.data.season.toLocaleString()} season permits sold this season through {isFinal ? shortDate(season.season_end) : shortDate(lastDayOf(report.month))}. A check, not the source: permits sold from books that are not empty yet are the difference.</p> : null}
          {!locked ? <div className="mt-4"><Button onClick={build} disabled={busy !== null}>{busy === 'build' ? 'Working it out…' : report.built_at ? 'Work it out again' : 'Work out the report'}</Button></div> : null}
        </section>

        {report.built_at ? (
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">2. The State's numbers</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Section title="Day permits sold" rows={split.day} qty={report.day_qty} amount={report.day_amount} commission={report.day_commission} due={report.day_due} />
              <Section title="Season permits sold" rows={split.season} qty={report.season_qty} amount={report.season_amount} commission={report.season_commission} due={report.season_due} />
            </div>
            {split.unsold.length ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Unsold permits going back</p>
                <ul className="mt-1 text-sm text-stone-700">{split.unsold.map((r) => <li key={r.id}>{KIND_LABELS[r.kind]} book {r.book_number}: {range(r.from_permit, r.to_permit)} ({r.qty})</li>)}</ul>
              </div>
            ) : null}
            <p className="mt-4 text-lg font-semibold text-stone-900">Grand total due to the State: {money(report.total_due)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {file ? <button type="button" onClick={() => open(file.storage_path!)} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"><FileSpreadsheet className="size-4" aria-hidden="true" />{file.file_name}</button> : null}
              {!locked ? <Button variant={file ? 'secondary' : 'primary'} onClick={excel} disabled={busy !== null}>{busy === 'excel' ? 'Making the Excel…' : file ? 'Make the Excel again' : "Make the State's Excel"}</Button> : null}
              {file || print ? <Button variant="secondary" onClick={printForm} disabled={busy !== null}><Printer className="size-4" aria-hidden="true" />{busy === 'print' ? 'Making the form…' : 'Print the form'}</Button> : null}
              {print ? <button type="button" onClick={() => open(print.storage_path!)} className="text-sm text-brand hover:underline">{print.file_name}</button> : null}
            </div>
            {file ? <p className="mt-2 text-xs text-stone-500">Both are filed under {view.vendor?.name ?? 'the vendor'} in the Sno-Park folder. <strong>Print the form</strong> opens VMS's printable copy of the State's form for the envelope{isFinal ? ', with the Unsold box and the declaration to sign' : ''}; the Excel is the State's own file with the same numbers.</p> : null}
          </section>
        ) : null}

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Camera className="size-4" aria-hidden="true" />3. The book covers</h2>
          <p className="mt-1 text-sm text-stone-600">Our proof of what went back: take a picture of the cover of every book going in the envelope (several at once is fine), on your phone or from a scan. VMS files them with the report and, once it is mailed, builds one PDF: the form first, then the covers in this order.</p>
          {scans.length ? <ul className="mt-2 space-y-1 text-sm">{scans.map((s, i) => <li key={s.id}><span className="mr-2 text-xs text-stone-400">{i + 1}.</span><button type="button" onClick={() => open(s.storage_path!)} className="text-brand hover:underline">{s.file_name}</button> <span className="text-xs text-stone-500">{shortDate(s.created_at)}</span></li>)}</ul> : null}
          {canEdit ? <div className="mt-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"><Camera className="size-4" aria-hidden="true" />{busy === 'scan' ? 'Uploading…' : scans.length ? 'Add more covers' : 'Photograph the covers'}<input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={(e) => addScan(e.target.files)} disabled={busy !== null} className="sr-only" aria-label="Upload the book covers" /></label></div> : null}
          {report.status === 'mailed' ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              {packet ? <button type="button" onClick={() => open(packet.storage_path!)} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"><FileText className="size-4" aria-hidden="true" />{packet.file_name}</button> : null}
              {canEdit ? <Button variant="secondary" onClick={packetNow} disabled={busy !== null}>{busy === 'packet' ? 'Filing…' : packet ? 'File the packet again' : 'File the packet'}</Button> : null}
              <span className="text-xs text-stone-500">Filed under {view.vendor?.name ?? 'the vendor'} in {isFinal ? 'Season final reports' : 'Submitted permit payments'}.{packet && scans.some((s) => new Date(s.created_at) > new Date(packet.created_at)) ? ' Covers were added after the packet was filed: file it again.' : ''}</span>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Mail className="size-4" aria-hidden="true" />4. Mail it</h2>
          <p className="mt-1 text-sm text-stone-700">In the envelope: the printed form, the check for <strong>{report.built_at ? money(report.total_due) : '…'}</strong>{isFinal ? ', and every book, sold or not' : `, and the ${books.filter((b) => b.report_id === report.id).length || ''} empty book${books.filter((b) => b.report_id === report.id).length === 1 ? '' : 's'} on it`}. Mail to <strong>{MAIL_TO}</strong>.</p>
          {report.status === 'mailed' ? (
            <p className="mt-2 text-sm text-stone-700">Mailed {shortDate(report.mailed_on!)}{report.tracking ? ` · tracking ${report.tracking}` : ''}. The books are marked returned.</p>
          ) : canEdit ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <FormField label="Mailed on" htmlFor="sp-mailed"><Input id="sp-mailed" type="date" value={mailedOn} onChange={(e) => setMailedOn(e.target.value)} /></FormField>
              <FormField label="Tracking (optional)" htmlFor="sp-tracking"><Input id="sp-tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="USPS or FedEx number" /></FormField>
              <Button onClick={mailed} disabled={busy !== null || !report.built_at || report.status !== 'ready'}>{busy === 'mailed' ? 'Saving…' : 'Mailed'}</Button>
              {report.built_at && report.status !== 'ready' ? <p className="text-xs text-stone-500">Make the Excel first.</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function BookRow({ book, isFinal, locked, pick, onChange }: { book: SnoparkBook; isFinal: boolean; locked: boolean; pick: { on: boolean; to: string }; onChange: (v: { on: boolean; to: string }) => void }) {
  const id = `bk-${book.id}`
  return (
    <tr className={pick.on ? 'bg-amber-50/50' : ''}>
      <td className="py-2 pr-3"><input id={id} type="checkbox" checked={pick.on} disabled={locked} onChange={(e) => onChange({ ...pick, on: e.target.checked })} aria-label={`Book ${book.book_number}`} /></td>
      <td className="py-2 pr-3 font-medium text-stone-900"><label htmlFor={id}>{book.book_number}</label></td>
      <td className="py-2 pr-3 text-stone-700">{KIND_LABELS[book.kind]}</td>
      <td className="py-2 pr-3 text-stone-700">{range(book.first_permit, book.last_permit)}</td>
      <td className="py-2 pr-3 text-stone-700">{permitsIn(book)}</td>
      {isFinal ? <td className="py-2 pr-3"><Input type="number" min={book.first_permit} max={book.last_permit} value={pick.to} disabled={locked || !pick.on} onChange={(e) => onChange({ ...pick, to: e.target.value })} className="w-32" aria-label={`Last permit sold in book ${book.book_number}`} /></td> : null}
    </tr>
  )
}

function Section({ title, rows, qty, amount, commission, due }: { title: string; rows: { id: string; book_number: string | null; from_permit: number; to_permit: number; qty: number; amount: number; commission: number; due: number }[]; qty: number; amount: number; commission: number; due: number }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</p>
      {rows.length === 0 ? <p className="mt-1 text-sm text-stone-500">None</p> : (
        <table className="mt-1 w-full text-sm">
          <thead><tr className="text-left text-xs text-stone-500"><th className="py-1 pr-2">From</th><th className="py-1 pr-2">Including</th><th className="py-1 pr-2 text-right">Sold</th><th className="py-1 pr-2 text-right">Collected</th><th className="py-1 pr-2 text-right">Commission</th><th className="py-1 text-right">Due</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id}><td className="py-1 pr-2">{r.from_permit}</td><td className="py-1 pr-2">{r.to_permit}</td><td className="py-1 pr-2 text-right">{r.qty}</td><td className="py-1 pr-2 text-right">{money(r.amount)}</td><td className="py-1 pr-2 text-right">{money(r.commission)}</td><td className="py-1 text-right">{money(r.due)}</td></tr>)}
            <tr className="font-semibold"><td className="py-1 pr-2" colSpan={2}>Subtotal</td><td className="py-1 pr-2 text-right">{qty}</td><td className="py-1 pr-2 text-right">{money(amount)}</td><td className="py-1 pr-2 text-right">{money(commission)}</td><td className="py-1 text-right">{money(due)}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

/** The last day of a report's month, for the Lightspeed check. */
function lastDayOf(month: string): string {
  const [y, m] = month.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}
