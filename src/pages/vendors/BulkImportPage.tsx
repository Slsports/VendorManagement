import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, FolderUp, Sparkles, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { askClaudeScan, askClaudeWhere, docKey, fileImportedDocument, listExistingDocKeys, listVendorsForMatching, removeStagedFiles, stageImportFile, type ScanDocument } from '@/services/documentImport'
import { clearPickerCache } from '@/services/mail'
import { guessFromPath, isImportable, vendorMatcher } from '@/lib/bulkImport'
import { splitPdf } from '@/lib/pdfSplit'
import { DOC_FOLDERS, folderLabel, kindFor, type DocFolder } from '@/lib/documents'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { Alert, Badge, Button, Select, Spinner } from '@/components/ui'

const MAX_MB = 25
const CLAUDE_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/

type How = 'path' | 'claude' | 'person'
interface Row {
  key: string
  file: File
  path: string
  vendorId: string | null
  folder: DocFolder | null
  year: number
  how: How
  note: string | null
  include: boolean
  duplicate: boolean
  staged: string | null
  state: 'new' | 'filed' | 'error'
  error: string | null
  /** Read from a scan: invoice / credit / packing slip number, its date and total. */
  details?: { number: string | null; date: string | null; total: number | null } | null
}

/** Walk dropped folders (Chrome, Edge, Safari, Firefox): every file with its path inside the drop. */
async function filesFromDrop(e: DragEvent): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = []
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[]
  if (!entries.length) return [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name }))
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, path: `${prefix}${entry.name}` })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]!) }))
}

const YEARS = (() => { const y = new Date().getFullYear(); return Array.from({ length: y + 2 - 2000 }, (_, i) => y + 1 - i) })()

/**
 * Bulk import of old vendor documents (Dana, Oct 8): drop whole vendor folders from Dropbox. Each file is
 * sorted by vendor, folder and year from the folder names ("Stansport/Invoices/2024"); Claude reads the
 * ones the path cannot settle. Nothing is filed until a person has looked at the list. Files already in
 * VMS (same vendor, name and size) are skipped.
 */
export default function BulkImportPage() {
  const { organization, profile } = useAuth()
  const vendorsQ = useSupabaseQuery(async () => (organization ? listVendorsForMatching(organization.id) : []), [organization?.id])
  const [rows, setRows] = useState<Row[]>([])
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const existing = useRef<Set<string> | null>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const matcher = useMemo(() => vendorMatcher(vendorsQ.data ?? []), [vendorsQ.data])
  const vendorName = useMemo(() => new Map((vendorsQ.data ?? []).map((v) => [v.id, v.name])), [vendorsQ.data])

  const isDup = (vendorId: string | null, f: File) => !!vendorId && !!existing.current?.has(docKey(vendorId, f.name, f.size))
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r
    const next = { ...r, ...patch }
    if ('vendorId' in patch) { next.duplicate = isDup(next.vendorId, next.file); if (next.duplicate) next.include = false }
    return next
  }))

  async function add(list: { file: File; path: string }[]) {
    if (!organization) return
    setReading(true)
    try {
      existing.current ??= await listExistingDocKeys(organization.id)
      const known = new Set(rows.map((r) => r.path))
      const fresh: Row[] = []
      let skipped = 0
      for (const { file, path } of list) {
        if (!isImportable(path) || known.has(path)) continue
        if (file.size > MAX_MB * 1024 * 1024) { skipped++; continue }
        const g = guessFromPath(path, file.lastModified, matcher)
        const duplicate = isDup(g.vendorId, file)
        fresh.push({
          key: crypto.randomUUID(), file, path, vendorId: g.vendorId, folder: g.folder, year: g.year, how: 'path',
          note: g.vendorChoices.length > 1 ? `${g.vendorChoices.length} vendors match the folder name` : null,
          include: !duplicate, duplicate, staged: null, state: 'new', error: null,
        })
      }
      setRows((rs) => [...rs, ...fresh])
      if (scanMode && fresh.length) void readScans(fresh)
      if (skipped) toast(`${skipped} file${skipped === 1 ? '' : 's'} over ${MAX_MB} MB left out`)
      if (!fresh.length) toast('No new files in that drop')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setReading(false)
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    await add(await filesFromDrop(e))
  }

  const pending = rows.filter((r) => r.state !== 'filed')
  // Claude's unsure answers stay here until a person accepts or changes them.
  const needsLook = (r: Row) => !r.vendorId || !r.folder || (r.how === 'claude' && !!r.note)
  const unsure = pending.filter((r) => !r.duplicate && needsLook(r))
  const ready = pending.filter((r) => !r.duplicate && !needsLook(r))
  const dups = pending.filter((r) => r.duplicate)
  const filed = rows.filter((r) => r.state === 'filed')
  const toFile = ready.filter((r) => r.include)

  /**
   * Scanned paper (Dana, Oct 9): Claude reads every page of each PDF, splits a stack into its documents and
   * gives each its vendor, folder, number, date and total. Unclear pages stay under "Need a look".
   */
  async function readScans(list: Row[]) {
    if (!organization) return
    const pdfs = list.filter((r) => /pdf/i.test(r.file.type) || /\.pdf$/i.test(r.file.name))
    setProgress({ label: 'Claude is reading the scans', done: 0, total: pdfs.length })
    let done = 0
    await inPool(pdfs, 2, async (r) => {
      try {
        const staged = r.staged ?? await stageImportFile(organization.id, r.file)
        const docs = await askClaudeScan({ key: r.key, path: r.path, storage_path: staged })
        const fit = (d: ScanDocument, base: Row, file: File, stagedPath: string): Row => {
          const folder = (DOC_FOLDERS.some((f) => f.id === d.folder) ? d.folder : null) as DocFolder | null
          const year = d.doc_date && /^\d{4}/.test(d.doc_date) ? Number(d.doc_date.slice(0, 4)) : base.year
          const vendorId = d.vendor_id ?? base.vendorId
          const duplicate = isDup(vendorId, file)
          return {
            ...base, key: crypto.randomUUID(), file, staged: stagedPath, vendorId, folder: folder ?? base.folder, year, how: 'claude',
            note: !d.sure ? 'Claude is not sure: faded, handwritten or unclear' : d.vendor_name && !vendorId ? `Claude read "${d.vendor_name}", no vendor by that name` : null,
            details: { number: d.invoice_number, date: d.doc_date, total: d.total }, duplicate, include: !duplicate,
          }
        }
        if (docs.length <= 1) {
          const d = docs[0]
          if (d) setRows((rs) => rs.map((x) => (x.key === r.key ? { ...fit(d, x, x.file, staged), key: x.key } : x)))
          else update(r.key, { staged, note: 'Claude found nothing to read' })
        } else {
          // A stack: one file per document, each filed on its own.
          const parts = await splitPdf(r.file, docs.map((d) => ({ first: d.first_page, last: d.last_page })))
          const made: Row[] = []
          for (const [k, part] of parts.entries()) {
            const p = await stageImportFile(organization.id, part)
            made.push(fit(docs[k]!, { ...r, path: `${r.path} (pages ${docs[k]!.first_page}–${docs[k]!.last_page})` }, part, p))
          }
          setRows((rs) => rs.flatMap((x) => (x.key === r.key ? made : [x])))
          await removeStagedFiles([staged])
        }
      } catch (err) {
        update(r.key, { note: `Claude could not read it: ${errorMessage(err)}` })
      }
      done++
      setProgress((p) => (p ? { ...p, done } : p))
    })
    setProgress(null)
    toast.success('Claude has read the scans. Check the list, then file.')
  }

  async function askClaude() {
    if (!organization) return
    const targets = unsure.filter((r) => r.how !== 'claude')
    setProgress({ label: 'Claude is reading', done: 0, total: targets.length })
    const batches: Row[][] = []
    for (let i = 0; i < targets.length; i += 5) batches.push(targets.slice(i, i + 5))
    let done = 0
    let failed = 0
    await inPool(batches, 2, async (batch) => {
      try {
        const files = []
        for (const r of batch) {
          let staged = r.staged
          if (!staged && CLAUDE_TYPES.test(r.file.type)) {
            staged = await stageImportFile(organization.id, r.file)
            update(r.key, { staged })
          }
          files.push({ key: r.key, path: r.path, storage_path: staged, mime: r.file.type || null })
        }
        const results = await askClaudeWhere(files)
        for (const res of results) {
          const r = batch.find((b) => b.key === res.key)
          if (!r) continue
          if (res.error) { failed++; update(r.key, { note: `Claude could not read it: ${res.error}` }); continue }
          const folder = (DOC_FOLDERS.some((f) => f.id === res.folder) ? res.folder : null) as DocFolder | null
          update(r.key, {
            vendorId: r.vendorId ?? res.vendor_id ?? null, folder: r.folder ?? folder, year: res.year && res.year >= 1990 && res.year <= 2100 ? res.year : r.year, how: 'claude',
            note: res.vendor_name && !res.vendor_id && !r.vendorId ? `Claude read "${res.vendor_name}", no vendor by that name` : res.sure ? null : 'Claude is not sure',
          })
        }
      } catch (err) {
        failed += batch.length
        batch.forEach((r) => update(r.key, { note: errorMessage(err) }))
      }
      done += batch.length
      setProgress((p) => (p ? { ...p, done } : p))
    })
    setProgress(null)
    if (failed) toast.error(`${failed} file${failed === 1 ? '' : 's'} Claude could not read`)
    else toast.success('Claude has read them. Check the list, then file.')
  }

  async function fileAll() {
    if (!organization) return
    const list = toFile
    setProgress({ label: 'Filing', done: 0, total: list.length })
    let done = 0
    let failed = 0
    await inPool(list, 3, async (r) => {
      try {
        const storagePath = r.staged ?? await stageImportFile(organization.id, r.file)
        await fileImportedDocument({ organizationId: organization.id, vendorId: r.vendorId!, kind: kindFor(r.folder!), year: r.year, originalPath: r.path, storagePath, file: r.file, userId: profile?.id ?? null, details: r.details ?? undefined })
        existing.current?.add(docKey(r.vendorId!, r.file.name, r.file.size))
        update(r.key, { state: 'filed', staged: storagePath, error: null })
      } catch (err) {
        failed++
        update(r.key, { state: 'error', error: errorMessage(err) })
      }
      done++
      setProgress((p) => (p ? { ...p, done } : p))
    })
    setProgress(null)
    if (failed) toast.error(`${failed} could not be filed; they are still in the list`)
    else toast.success(`${list.length} document${list.length === 1 ? '' : 's'} filed`)
  }

  async function clearUnfiled() {
    const staged = rows.filter((r) => r.state !== 'filed' && r.staged).map((r) => r.staged!)
    await removeStagedFiles(staged).catch(() => undefined)
    setRows((rs) => rs.filter((r) => r.state === 'filed'))
  }

  const groups = new Map<string, Row[]>()
  for (const r of ready) groups.set(r.vendorId!, [...(groups.get(r.vendorId!) ?? []), r])
  const byVendor = [...groups.entries()].sort((a, b) => (vendorName.get(a[0]) ?? '').localeCompare(vendorName.get(b[0]) ?? ''))
  const filedVendors = [...new Set(filed.map((r) => r.vendorId!))]

  const busy = reading || !!progress
  const placeRow = (r: Row, showVendor: boolean) => (
    <li key={r.key} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={r.include} disabled={busy} onChange={(e) => update(r.key, { include: e.target.checked })} className="mt-1 accent-brand" aria-label={`Include ${r.path}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm text-stone-900" title={r.path}>{r.path}</span>
            <span className="block text-xs text-stone-500">
              {r.how === 'claude' ? <Badge tone="info" className="mr-1">Claude</Badge> : null}
              {r.details && (r.details.number || r.details.total != null) ? <span className="mr-1 text-stone-600">{[r.details.number ? `#${r.details.number}` : null, r.details.date, r.details.total != null ? `$${r.details.total.toFixed(2)}` : null].filter(Boolean).join(' · ')}</span> : null}
              {r.note ? <span className="text-amber-700">{r.note}</span> : null}
              {r.error ? <span className="text-red-700">{r.error}</span> : null}
            </span>
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        {showVendor ? (
          r.vendorId ? (
            <button type="button" disabled={busy} onClick={() => update(r.key, { vendorId: null, how: 'person', note: null })} className="max-w-48 truncate rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-800 hover:bg-stone-50" title="Change the vendor">{vendorName.get(r.vendorId) ?? 'Vendor'}</button>
          ) : (
            <VendorPicker onPick={(v) => { clearPickerCache(); update(r.key, { vendorId: v.id, how: 'person', note: null, include: true }) }} placeholder="Which vendor?" className="w-56" />
          )
        ) : null}
        <Select value={r.folder ?? ''} disabled={busy} onChange={(e) => update(r.key, { folder: (e.target.value || null) as DocFolder | null, how: 'person', note: null })} aria-label="Folder" className="h-9 w-36">
          <option value="">Which folder?</option>
          {DOC_FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </Select>
        <Select value={r.year} disabled={busy} onChange={(e) => update(r.key, { year: Number(e.target.value) })} aria-label="Year" className="h-9 w-24">
          {[...new Set([...YEARS, r.year])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        {r.how === 'claude' && r.note && r.vendorId && r.folder ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => update(r.key, { how: 'person', note: null })}>Looks right</Button>
        ) : null}
      </div>
    </li>
  )

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink fallback={ROUTES.vendors} fallbackLabel="Vendors" />
      <PageHeader title="Bulk import documents" description="Drop your vendor folders from Dropbox. VMS sorts each file into the vendor's Documents by folder and year; you check the list before anything is filed." />
      {vendorsQ.error ? <Alert variant="error">{vendorsQ.error}</Alert> : null}

      <div onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => void onDrop(e)}
        className={cn('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center', dragging ? 'border-brand bg-brand/5' : 'border-stone-300 bg-white/60')}>
        <FolderUp className="size-10 text-stone-400" aria-hidden="true" />
        <p className="text-sm text-stone-700">Drop vendor folders here, like <span className="font-medium">Stansport</span> with its Invoices and Catalogs folders inside.</p>
        <label className="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-800">
          <input type="checkbox" checked={scanMode} onChange={(e) => setScanMode(e.target.checked)} className="size-4 accent-brand" />
          Scanned paper: Claude reads every page, splits stacks into separate invoices, and keeps each invoice's number, date and total
        </label>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" disabled={busy || vendorsQ.isLoading} onClick={() => folderInput.current?.click()} leftIcon={<FolderUp className="size-4" aria-hidden="true" />}>Choose a folder</Button>
          <Button variant="ghost" disabled={busy || vendorsQ.isLoading} onClick={() => fileInput.current?.click()} leftIcon={<Upload className="size-4" aria-hidden="true" />}>Choose files</Button>
        </div>
        <input ref={folderInput} type="file" multiple className="hidden" {...{ webkitdirectory: '' }} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(fs.map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))) }} />
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(fs.map((f) => ({ file: f, path: f.name }))) }} />
        {reading || vendorsQ.isLoading ? <Spinner label="Reading the folders…" className="text-brand" /> : null}
      </div>

      {progress ? (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4" role="status">
          <p className="text-sm font-medium text-stone-800">{progress.label}… {progress.done} of {progress.total}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-white p-4 text-sm">
            <span><span className="font-semibold">{pending.length}</span> files</span>
            <span><span className="font-semibold">{ready.length}</span> ready</span>
            <span className={unsure.length ? 'text-amber-700' : ''}><span className="font-semibold">{unsure.length}</span> need a look</span>
            {dups.length ? <span className="text-stone-500">{dups.length} already in VMS</span> : null}
            {filed.length ? <span className="text-emerald-700">{filed.length} filed</span> : null}
            <div className="ml-auto flex flex-wrap gap-2">
              {unsure.some((r) => r.how !== 'claude') ? <Button variant="secondary" disabled={busy} onClick={() => void askClaude()} leftIcon={<Sparkles className="size-4" aria-hidden="true" />}>Ask Claude about {unsure.filter((r) => r.how !== 'claude').length}</Button> : null}
              <Button disabled={busy || !toFile.length} onClick={() => void fileAll()} leftIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}>File {toFile.length} document{toFile.length === 1 ? '' : 's'}</Button>
              {pending.length ? <Button variant="ghost" disabled={busy} onClick={() => void clearUnfiled()}>Clear the list</Button> : null}
            </div>
          </div>

          {unsure.length ? (
            <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <h2 className="text-sm font-semibold text-amber-900">Need a look ({unsure.length})</h2>
              <p className="text-xs text-amber-800">The folder names didn't say the vendor or the folder. Ask Claude, or pick them. These are filed once they have both.</p>
              <ul className="mt-2 divide-y divide-amber-100">{unsure.slice(0, 300).map((r) => placeRow(r, true))}</ul>
              {unsure.length > 300 ? <p className="mt-2 text-xs text-amber-800">Showing 300; the rest appear as these are settled.</p> : null}
            </section>
          ) : null}

          {byVendor.length ? (
            <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-stone-900">Ready to file ({ready.length})</h2>
              {byVendor.map(([vid, rs]) => {
                const counts = DOC_FOLDERS.map((f) => [f.label, rs.filter((r) => r.folder === f.id).length] as const).filter(([, n]) => n)
                return (
                  <details key={vid} className="mt-2 border-t border-stone-100 pt-2">
                    <summary className="cursor-pointer text-sm">
                      <span className="font-medium text-stone-900">{vendorName.get(vid)}</span>
                      <span className="text-stone-500"> · {rs.length} file{rs.length === 1 ? '' : 's'}: {counts.map(([l, n]) => `${l} ${n}`).join(', ')}</span>
                    </summary>
                    <ul className="divide-y divide-stone-100">{rs.map((r) => placeRow(r, true))}</ul>
                  </details>
                )
              })}
            </section>
          ) : null}

          {dups.length ? (
            <details className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 text-sm">
              <summary className="cursor-pointer font-semibold text-stone-700">Already in VMS ({dups.length}), skipped</summary>
              <ul className="mt-2 space-y-1 text-xs text-stone-500">{dups.map((r) => <li key={r.key} className="truncate">{r.path}</li>)}</ul>
            </details>
          ) : null}

          {filedVendors.length ? (
            <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
              <h2 className="font-semibold text-emerald-900">Filed ({filed.length})</h2>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {filedVendors.map((vid) => (
                  <li key={vid}><Link to={`${ROUTES.vendors}/${vid}`} className="text-brand hover:underline">{vendorName.get(vid)}</Link> <span className="text-stone-500">({filed.filter((r) => r.vendorId === vid).length}: {[...new Set(filed.filter((r) => r.vendorId === vid).map((r) => folderLabel(r.folder!)))].join(', ')})</span></li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
