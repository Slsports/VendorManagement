import { useEffect, useRef, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { Camera, ChevronRight, FileText, FolderUp, Loader2, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMyUploads, submitUpload, uploadFileUrl, type UploadDoc, type UploadRow } from '@/services/invoiceUploads'
import { isImage, isPdf, pagesHash, pagesToPdf, uploadDayLabel, type UploadPage } from '@/lib/uploadPdf'
import { localDay } from '@/lib/tasks'
import { cn, errorMessage, shortDate } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { Alert, Badge, Button, Spinner } from '@/components/ui'

const FOLDER_WORD: Record<string, string> = { invoices: 'Invoices', credits: 'Credits', shipping: 'Shipping' }

/**
 * Invoice Uploads (Dana, Oct 20): take photos of an invoice, or pick a PDF or photo from the phone, iPad or computer,
 * check the pages, Submit. Claude reads each invoice (its vendor and the store it is for) and files it. Each person sees
 * only what they uploaded, in folders by upload date.
 */
export default function UploadInvoicePage() {
  const { organization, profile } = useAuth()
  const [pages, setPages] = useState<UploadPage[]>([])
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [today] = useState(() => localDay(new Date()))
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const q = useSupabaseQuery(async () => (profile ? listMyUploads(profile.id) : []), [profile?.id])
  const rows = q.data ?? []
  const reading = rows.some((u) => u.status === 'queued' || u.status === 'reading')

  // while Claude reads, the list checks every few seconds
  const { refetch } = q
  useEffect(() => {
    if (!reading) return
    const t = window.setInterval(() => void refetch(), 6000)
    return () => window.clearInterval(t)
  }, [reading, refetch])
  // previews are freed when their page goes, and when the page closes
  const shown = useRef<UploadPage[]>([])
  useEffect(() => { shown.current = pages }, [pages])
  useEffect(() => () => shown.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), [])

  function add(files: FileList | File[] | null) {
    const list = [...(files ?? [])]
    const ok = list.filter((f) => isPdf(f) || isImage(f))
    if (ok.length < list.length) toast.error('Only photos and PDFs can be uploaded')
    setPages((ps) => [...ps, ...ok.map((file) => ({ id: crypto.randomUUID(), file, preview: isImage(file) && !/heic|heif/i.test(file.type + file.name) ? URL.createObjectURL(file) : null }))])
  }
  function remove(id: string) {
    const p = pages.find((x) => x.id === id)
    if (p?.preview) URL.revokeObjectURL(p.preview)
    setPages((ps) => ps.filter((x) => x.id !== id))
  }
  function clear() {
    pages.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
    setPages([])
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    add(e.dataTransfer.files)
  }

  async function submit() {
    if (!organization || !profile || !pages.length) return
    setSending(true)
    try {
      const files = pages.map((p) => p.file)
      const stamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      const name = files.length === 1 && isPdf(files[0]!) ? files[0]!.name : `Scan ${stamp}.pdf`
      const [{ file, pageCount }, hash] = await Promise.all([pagesToPdf(files, name), pagesHash(files)])
      const res = await submitUpload(organization.id, profile.id, file, hash, pageCount)
      if (res.duplicate) toast(res.duplicate, { icon: '⚠️', duration: 8000 })
      else toast.success('Sent. VMS is reading it now.')
      clear()
      await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const days = [...new Set(rows.map((u) => u.uploaded_on))]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Invoice Uploads" description="Take photos of an invoice, or pick a PDF or photo. Several invoices can go in one upload: VMS reads each one, sees which store it is for, and files it." />

      <section aria-label="New upload" onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cn('rounded-2xl border-2 border-dashed p-4 sm:p-6', dragging ? 'border-brand bg-brand/5' : 'border-stone-300 bg-white')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => camera.current?.click()} leftIcon={<Camera className="size-5" aria-hidden="true" />} disabled={sending}>{pages.length ? 'Take another page' : 'Take photos'}</Button>
          <Button size="lg" variant="secondary" onClick={() => picker.current?.click()} leftIcon={<FolderUp className="size-5" aria-hidden="true" />} disabled={sending}>Choose files</Button>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <input ref={picker} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <p className="mt-2 text-center text-xs text-stone-500">Choose files picks from the phone's or iPad's files and photos, or from the computer. On a computer you can also drop files here.</p>

        {pages.length ? (
          <>
            <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {pages.map((p, i) => (
                <li key={p.id} className="relative overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                  {p.preview
                    ? <img src={p.preview} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                    : <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1 p-2 text-center"><FileText className="size-8 text-stone-400" aria-hidden="true" /><span className="line-clamp-2 break-all text-xs text-stone-600">{p.file.name}</span></div>}
                  <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 text-xs font-medium text-stone-700">{i + 1}</span>
                  <button type="button" onClick={() => remove(p.id)} disabled={sending} aria-label={`Remove page ${i + 1}`}
                    className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow hover:bg-white"><X className="size-4" aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={clear} disabled={sending}>Start over</Button>
              <Button size="lg" loading={sending} onClick={() => void submit()}>Submit ({pages.length} page{pages.length === 1 ? '' : 's'})</Button>
            </div>
          </>
        ) : null}
      </section>

      <section aria-label="My uploads" className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">My uploads</h2>
        {q.isLoading ? <div className="flex justify-center py-8"><Spinner label="Loading…" className="text-brand" /></div>
          : q.error ? <Alert variant="error" className="mt-2">{q.error}</Alert>
          : !rows.length ? <p className="mt-2 text-sm text-stone-500">Nothing uploaded yet.</p>
          : (
            <div className="mt-2 space-y-2">
              {days.map((day) => {
                const list = rows.filter((u) => u.uploaded_on === day)
                return (
                  <details key={day} open={day === days[0]} className="group rounded-2xl border border-stone-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-stone-900">
                      <ChevronRight className="size-4 text-stone-400 transition group-open:rotate-90" aria-hidden="true" />
                      {uploadDayLabel(day, today)}
                      <span className="font-normal text-stone-500">· {list.length} upload{list.length === 1 ? '' : 's'}</span>
                    </summary>
                    <ul className="divide-y divide-stone-100 border-t border-stone-100">
                      {list.map((u) => <UploadLine key={u.id} u={u} />)}
                    </ul>
                  </details>
                )
              })}
            </div>
          )}
      </section>
    </div>
  )
}

async function openFile(path: string) {
  try {
    window.open(await uploadFileUrl(path), '_blank', 'noopener')
  } catch (err) {
    toast.error(errorMessage(err))
  }
}

function UploadLine({ u }: { u: UploadRow }) {
  const time = new Date(u.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void openFile(u.storage_path)} className="font-medium text-brand hover:underline">{time} · {u.page_count ?? '?'} page{u.page_count === 1 ? '' : 's'}</button>
        {u.status === 'queued' || u.status === 'reading' ? <span className="inline-flex items-center gap-1 text-stone-600"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Reading…</span>
          : u.status === 'duplicate' ? <Badge tone="warning">{u.note ?? 'Already submitted'}</Badge>
          : u.status === 'failed' ? <Badge tone="danger">Couldn't be read. The office will look at it.</Badge>
          : !u.docs.length ? <Badge tone="warning">{u.note ?? 'Nothing to read on it'}</Badge> : null}
      </div>
      {u.docs.length ? <ul className="mt-2 space-y-1.5">{u.docs.map((d) => <DocLine key={d.id} d={d} />)}</ul> : null}
    </li>
  )
}

function DocLine({ d }: { d: UploadDoc }) {
  const what = [d.vendor_name ?? d.vendor_name_read ?? 'Vendor not read', d.doc_number ? `#${d.doc_number}` : null, d.store_code ?? d.store_read, d.doc_date ? shortDate(d.doc_date) : null, d.doc_total != null ? `$${Number(d.doc_total).toFixed(2)}` : null].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-stone-50 px-3 py-2">
      <button type="button" onClick={() => void openFile(d.storage_path)} className="min-w-0 text-left text-stone-800 hover:text-brand hover:underline">{what}</button>
      {d.status === 'filed' ? <Badge tone="success">Filed{d.folder && FOLDER_WORD[d.folder] ? ` to ${FOLDER_WORD[d.folder]}` : ''}</Badge> : null}
      {d.billcom_sent_at ? <Badge tone="info">Sent to Bill.com</Badge> : null}
      {d.status === 'needs_look' ? <Badge tone="warning">Needs a look: the office will file it</Badge> : null}
      {d.status === 'duplicate' ? <Badge tone="warning">{d.duplicate_note ?? 'Already submitted'}</Badge> : null}
      {d.status === 'set_aside' ? <Badge tone="neutral">Set aside</Badge> : null}
    </li>
  )
}
