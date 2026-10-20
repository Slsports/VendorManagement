import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { SquareCheck, Square, Pencil, Download, ExternalLink, FileText, Folder, FolderInput, FolderOpen, Link2, Mail, Star, Trash2, Upload } from 'lucide-react'
import { addVendorLink, deleteVendorLink, downloadVendorFile, listVendorLinks, renameVendorLink, setProofApproved, tickSalesReport, uploadVendorFile, zipVendorDocuments, type VendorLinkRow } from '@/services/lines'
import { kickOrderChecks } from '@/services/orderChecks'
import { onOrderingChanged } from '@/services/ordering'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { saveBlob } from '@/lib/viewer'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { DOC_FOLDERS, byYear, folderLabel, folderOf, isPictureFile, kindFor, thisYear, todayIso, yearChoices, type DocFolder } from '@/lib/documents'
import { LINK_KIND_LABELS } from '@/lib/vendors'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { MAX_UPLOAD_MB } from '@/lib/upload'
import { Badge, Button, FormField, Input, Select } from '@/components/ui'
import { Modal } from '@/components/shared/Modal'
import { FoldSection } from '@/components/shared/FoldSection'
import { MoveDocumentDialog } from '@/components/vendors/MoveDocumentDialog'
import { FileThumb } from '@/components/shared/FileThumb'

const MAX_MB = MAX_UPLOAD_MB

/**
 * The vendor's documents, filed the way Dana files them: a folder per kind (Price lists, Catalogs,
 * Invoices…) with a year folder inside. Drop files on a folder or use Upload; files from email land in the
 * right folder on their own. Move puts a file in another folder or year.
 */
export function VendorDocumentsSection({ vendorId, vendorName, organizationId, userId, canEdit }: { vendorId: string; vendorName: string; organizationId: string; userId: string | null; canEdit: boolean }) {
  const q = useSupabaseQuery(() => listVendorLinks(vendorId), [vendorId])
  // a sales report filed from the Ordering box (Run report, Upload) shows up here without a reload (Dana, Oct 18)
  const { refetch } = q
  useEffect(() => onOrderingChanged(() => { void refetch() }), [refetch])
  // and anything filed by anyone, from anywhere (Claude from the mailbox, another screen) lands here live (Dana, Oct 19)
  useLiveTable('vendor_links', `vendor_id=eq.${vendorId}`, () => { void refetch() })
  // ?folder=proofs opens that folder (a task's Go to it)
  const [params] = useSearchParams()
  const asked = DOC_FOLDERS.find((f) => f.id === params.get('folder'))?.id ?? null
  const [picked, setPicked] = useState<{ asked: DocFolder | null; folder: DocFolder | null }>({ asked, folder: asked })
  if (picked.asked !== asked) setPicked({ asked, folder: asked ?? picked.folder })
  const openFolder = picked.folder
  const setOpenFolder = (f: DocFolder | null | ((x: DocFolder | null) => DocFolder | null)) => setPicked((p) => ({ ...p, folder: typeof f === 'function' ? f(p.folder) : f }))
  const [adding, setAdding] = useState<{ mode: 'file' | 'link'; folder: DocFolder; files: File[] } | null>(null)
  const [moving, setMoving] = useState<VendorLinkRow | null>(null)
  const [renaming, setRenaming] = useState<VendorLinkRow | null>(null)
  const [dropOn, setDropOn] = useState<DocFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [shown, setShown] = useState(false)
  const { view, viewer } = useDocumentViewer()
  // a task's Go to it (Dana, Oct 20: "When I click on one it does nothing"): open this box and the folder, bring it into
  // view and open the file itself (?doc=), every time it is clicked, also from this same page
  const location = useLocation()
  const askedDoc = params.get('doc')
  const boxRef = useRef<HTMLDivElement>(null)
  const handled = useRef<string | null>(null)
  const [goKey, setGoKey] = useState<string | null>(null)

  const links = q.data ?? []
  const inFolder = (f: DocFolder) => links.filter((l) => folderOf(l.kind) === f)

  async function upload(files: File[], folder: DocFolder, year: number, season: string, notes: string) {
    const big = files.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (big) throw new Error(`${big.name} is over ${MAX_MB} MB`)
    // already on file (same name and size): not saved again (Dana, Oct 14: "no duplicates")
    const have = (f: File) => links.find((l) => l.storage_path && l.file_name?.toLowerCase() === f.name.toLowerCase() && l.file_size === f.size)
    const already = files.filter(have)
    if (already.length) toast(`${already.map((f) => `${f.name} is already in ${folderLabel(folderOf(have(f)!.kind))}`).join('; ')}`, { duration: 8000 })
    for (const file of files.filter((f) => !have(f))) {
      const path = await uploadVendorFile(organizationId, vendorId, file)
      await addVendorLink({
        organization_id: organizationId, vendor_id: vendorId, kind: kindFor(folder), label: file.name.replace(/\.[a-z0-9]{2,5}$/i, ''),
        storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || null, season_label: season.trim() || null,
        notes: notes.trim() || null, received_at: todayIso(), doc_year: year, created_by: userId,
      })
    }
    // confirmations and invoices: Claude finds the order and checks them (Dana, Oct 10)
    if (folder === 'confirmations' || folder === 'invoices') kickOrderChecks()
  }

  async function drop(e: DragEvent, folder: DocFolder) {
    e.preventDefault()
    setDropOn(null)
    const files = [...e.dataTransfer.files]
    if (!canEdit || !files.length) return
    setBusy(true)
    try {
      await upload(files, folder, thisYear(), '', '')
      toast.success(`${files.length === 1 ? files[0]!.name : `${files.length} files`} saved to ${folderLabel(folder)} ${thisYear()}`)
      setOpenFolder(folder)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const dragProps = (f: DocFolder) => canEdit ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDropOn(f) },
    onDragLeave: () => setDropOn((x) => (x === f ? null : x)),
    onDrop: (e: DragEvent) => void drop(e, f),
  } : {}

  if ((asked || askedDoc) && goKey !== location.key) {
    setGoKey(location.key)
    setShown(true)
    if (asked) setPicked({ asked, folder: asked })
  }
  useEffect(() => {
    if (!goKey || handled.current === goKey || (askedDoc && q.isLoading)) return
    handled.current = goKey
    boxRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    const doc = askedDoc ? (q.data ?? []).find((l) => l.id === askedDoc) : null
    if (doc) open(doc)
    else if (askedDoc) toast('That file is no longer in this vendor\'s documents')
  }, [goKey, askedDoc, q.isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  function open(link: VendorLinkRow) {
    if (link.storage_path) view({ name: link.file_name ?? link.label, mime: link.mime_type, load: () => downloadVendorFile(link.storage_path!) })
    else if (link.url) window.open(link.url, '_blank', 'noopener')
  }

  async function download(link: VendorLinkRow) {
    try {
      saveBlob(await downloadVendorFile(link.storage_path!), link.file_name ?? link.label)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  /** "Download all" for a folder or one year in it: one zip, foldered like the screen. */
  async function downloadAll(key: string, rows: VendorLinkRow[], zipName: string) {
    if (!rows.some((r) => r.storage_path)) { toast('Only links here, nothing to download.'); return }
    setZipping(key)
    try {
      saveBlob(await zipVendorDocuments(rows, vendorName, (l) => folderLabel(folderOf(l.kind))), `${zipName}.zip`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setZipping(null)
    }
  }

  async function remove(link: VendorLinkRow) {
    if (!window.confirm(`Remove "${link.label}"?`)) return
    try {
      await deleteVendorLink(link)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function approve(l: VendorLinkRow) {
    try {
      await setProofApproved(l.id, l.kind !== 'approved_proof')
      toast.success(l.kind === 'approved_proof' ? 'Marked not approved' : 'Marked approved')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function tick(l: VendorLinkRow) {
    try {
      await tickSalesReport(l.id, !l.report_used_at)
      toast.success(l.report_used_at ? 'Unticked' : 'Ticked: confirmations are checked against this report')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const folder = openFolder ? DOC_FOLDERS.find((f) => f.id === openFolder)! : null
  // pictures show a preview (Dana, Oct 10); the Images and Proofs folders show them as large tiles
  const row = (l: VendorLinkRow, tile = false) => (
    <li key={l.id} className={tile ? 'flex min-w-0 flex-col gap-2 rounded-xl border border-stone-200 p-2' : 'flex items-center gap-3 py-2'}>
      {l.storage_path && isPictureFile(l) ? <FileThumb path={l.storage_path} name={l.label} onOpen={() => open(l)} className={tile ? 'h-40 w-full' : 'h-16 w-20'} />
        : l.storage_path ? <FileText className="size-5 shrink-0 text-stone-400" aria-hidden="true" /> : <ExternalLink className="size-5 shrink-0 text-stone-400" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => open(l)} className="max-w-full truncate text-left text-sm font-medium text-stone-900 hover:text-brand">{l.label}</button>
        <p className="truncate text-xs text-stone-500">
          {l.is_current ? <Badge tone="success" className="mr-1">Current</Badge> : null}
          {l.kind === 'sales_report' && l.report_used_at ? <Badge tone="success" className="mr-1">Used to place the order</Badge> : null}
          {l.kind === 'approved_proof' ? <Badge tone="warning" className="mr-1"><Star className="mr-0.5 inline size-3 fill-amber-400 text-amber-500" aria-hidden="true" />Approved{l.approved_at ? ` ${new Date(l.approved_at).toLocaleDateString()}` : ''}</Badge> : null}
          {l.kind === 'proof' ? <Badge tone="neutral" className="mr-1">Not approved yet</Badge> : null}
          {folder && folder.kinds.length > 1 && folder.id !== 'proofs' ? <Badge tone="neutral" className="mr-1">{LINK_KIND_LABELS[l.kind]}</Badge> : null}
          {l.doc_number || l.doc_total != null ? <span className="mr-1 font-medium text-stone-700">{[l.doc_number ? `#${l.doc_number}` : null, l.doc_date ? new Date(`${l.doc_date}T12:00:00`).toLocaleDateString() : null, l.doc_total != null ? `$${Number(l.doc_total).toFixed(2)}` : null].filter(Boolean).join(' · ')} ·</span> : null}
          {l.season_label ? `${l.season_label} · ` : ''}{l.file_name ?? l.url?.replace(/^https?:\/\//, '')}{l.received_at ? ` · ${new Date(`${l.received_at}T12:00:00`).toLocaleDateString()}` : ''}
          {l.email ? <> · <Link to={`${ROUTES.mail}/${l.email.thread_id}`} className="inline-flex items-center gap-0.5 text-brand hover:underline"><Mail className="inline size-3" aria-hidden="true" />from an email</Link></> : null}
        </p>
        {l.notes && !l.email ? <p className="mt-0.5 text-xs text-stone-600">{l.notes}</p> : null}
        {/* the actions right under the name, in words, at any width (Dana, Oct 10) */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs">
          <button type="button" onClick={() => open(l)} aria-label={`Open ${l.label}`} className="rounded px-1.5 py-0.5 font-medium text-brand hover:bg-stone-100">Open</button>
          {l.storage_path ? <button type="button" onClick={() => void download(l)} aria-label={`Download ${l.label}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"><Download className="size-3.5" aria-hidden="true" />Download</button> : null}
          {canEdit ? (<>
            {l.kind === 'proof' || l.kind === 'approved_proof' ? (
              <button type="button" onClick={() => void approve(l)} aria-pressed={l.kind === 'approved_proof'} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                <Star className={cn('size-3.5', l.kind === 'approved_proof' && 'fill-amber-400 text-amber-500')} aria-hidden="true" />{l.kind === 'approved_proof' ? 'Not approved' : 'Mark approved'}
              </button>
            ) : null}
            {l.kind === 'sales_report' && l.storage_path ? (
              <button type="button" onClick={() => void tick(l)} aria-pressed={!!l.report_used_at} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900" title="The report we ordered from: confirmations are checked against it">
                {l.report_used_at ? <SquareCheck className="size-3.5 text-brand" aria-hidden="true" /> : <Square className="size-3.5" aria-hidden="true" />}Used to place the order
              </button>
            ) : null}
            <button type="button" onClick={() => setRenaming(l)} aria-label={`Rename ${l.label}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"><Pencil className="size-3.5" aria-hidden="true" />Rename</button>
            <button type="button" onClick={() => setMoving(l)} aria-label={`Move ${l.label}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900" title="Move to another folder or year"><FolderInput className="size-3.5" aria-hidden="true" />Move</button>
            <button type="button" onClick={() => void remove(l)} aria-label={`Remove ${l.label}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-600 hover:bg-red-50 hover:text-red-700"><Trash2 className="size-3.5" aria-hidden="true" />Remove</button>
          </>) : null}
        </div>
      </div>
    </li>
  )

  const summary = q.isLoading ? null : links.length === 0 ? 'None' : links.length === 1 ? '1 file' : `${links.length} files`
  return (
    <>
      <div ref={boxRef} className="scroll-mt-4 lg:col-span-3">
      <FoldSection title="Documents" summary={summary} open={shown} onOpenChange={setShown}
        actions={canEdit ? (<>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => setAdding({ mode: 'file', folder: openFolder ?? 'invoices', files: [] })} leftIcon={<Upload className="size-4" aria-hidden="true" />}>Upload</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding({ mode: 'link', folder: openFolder ?? 'catalogs', files: [] })} leftIcon={<Link2 className="size-4" aria-hidden="true" />}>Add a link</Button>
        </>) : null}>
        <p className="text-xs text-stone-500">{canEdit ? 'Open a folder, or drop files on one to save them under this year.' : 'Open a folder to see its files.'}</p>

        {links.length > 5 ? (
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a document: invoice number, amount, name…" aria-label="Find a document"
            className="mt-3 h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring-brand sm:max-w-md" />
        ) : null}
        {find.trim() ? (() => {
          const q = find.trim().toLowerCase().replace(/^[#$]/, '')
          const hits = links.filter((l) => [l.label, l.file_name, l.doc_number, l.doc_total != null ? Number(l.doc_total).toFixed(2) : null, l.season_label, l.notes].some((v) => (v ?? '').toString().toLowerCase().includes(q)))
          return (
            <div className="mt-3 rounded-xl border border-stone-200 p-3">
              <p className="text-sm font-semibold text-stone-900">{hits.length} found</p>
              <ul className="divide-y divide-stone-100">{hits.slice(0, 100).map((l) => <li key={l.id} className="text-xs text-stone-500"><span className="font-medium text-stone-700">{folderLabel(folderOf(l.kind))} · {l.doc_year ?? ''}</span><ul>{row(l)}</ul></li>)}</ul>
            </div>
          )
        })() : null}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {DOC_FOLDERS.map((f) => {
            const n = inFolder(f.id).length
            const Icon = openFolder === f.id ? FolderOpen : Folder
            return (
              <button key={f.id} type="button" {...dragProps(f.id)} onClick={() => setOpenFolder((x) => (x === f.id ? null : f.id))} aria-pressed={openFolder === f.id}
                className={cn('flex flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left text-sm',
                  openFolder === f.id ? 'border-brand bg-brand/5' : 'border-stone-200 hover:bg-stone-50',
                  dropOn === f.id && 'border-brand bg-brand/10 ring-2 ring-brand/30')}>
                <Icon className={cn('size-5', n ? 'text-amber-500' : 'text-stone-300')} aria-hidden="true" />
                <span className="font-medium text-stone-900">{f.label}</span>
                <span className="text-xs text-stone-500">{q.isLoading ? '…' : n === 1 ? '1 file' : `${n} files`}</span>
              </button>
            )
          })}
        </div>

        {folder ? (
          <div className="mt-4 rounded-xl border border-stone-200 p-3" {...dragProps(folder.id)}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900">{folder.label}</p>
              {inFolder(folder.id).length ? (
                <Button size="sm" variant="ghost" loading={zipping === folder.id} disabled={!!zipping} onClick={() => void downloadAll(folder.id, inFolder(folder.id), `${vendorName} ${folder.label}`)} leftIcon={<Download className="size-4" aria-hidden="true" />}>Download all</Button>
              ) : null}
            </div>
            {inFolder(folder.id).length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Nothing in {folder.label} yet.{canEdit ? ' Drop files here or use Upload.' : ''}</p>
            ) : byYear(inFolder(folder.id)).map(([year, rows], i) => (
              <details key={year ?? 'none'} open={i === 0} className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-stone-700">
                  <Folder className="mr-1 inline size-4 text-amber-500" aria-hidden="true" />{year ?? 'No year'} <span className="font-normal text-stone-500">({rows.length})</span>
                  <button type="button" disabled={!!zipping} onClick={(e) => { e.preventDefault(); void downloadAll(`${folder.id}-${year}`, rows, `${vendorName} ${folder.label} ${year ?? ''}`.trim()) }}
                    className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal text-stone-500 hover:bg-stone-100 hover:text-stone-800">
                    <Download className="size-3.5" aria-hidden="true" />{zipping === `${folder.id}-${year}` ? 'Zipping…' : 'Download year'}
                  </button>
                </summary>
                {folder.id === 'images' || folder.id === 'damaged' || folder.id === 'proofs'
                  ? <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{rows.map((l) => row(l, true))}</ul>
                  : <ul className="ml-1 divide-y divide-stone-100 border-l border-stone-100 pl-3">{rows.map((l) => row(l))}</ul>}
              </details>
            ))}
          </div>
        ) : null}
      </FoldSection>
      </div>

      {/* dialogs sit outside the box so Upload works while it is closed */}
      {adding ? (
        <AddDocumentDialog initial={adding} onClose={() => setAdding(null)} onSave={async (a) => {
          if (a.mode === 'file') {
            if (!a.files.length) throw new Error('Choose a file first')
            await upload(a.files, a.folder, a.year, a.season, a.notes)
          } else {
            const url = a.url.trim()
            if (!url) throw new Error('Paste a link first')
            await addVendorLink({
              organization_id: organizationId, vendor_id: vendorId, kind: kindFor(a.folder), label: a.label.trim() || a.season.trim() || folderLabel(a.folder),
              url: /^https?:\/\//i.test(url) ? url : `https://${url}`, season_label: a.season.trim() || null, notes: a.notes.trim() || null,
              received_at: todayIso(), doc_year: a.year, created_by: userId,
            })
          }
          toast.success(`Saved to ${folderLabel(a.folder)} ${a.year}`)
          setAdding(null)
          setOpenFolder(a.folder)
          setShown(true)
          await q.refetch()
        }} />
      ) : null}
      {viewer}
      {renaming ? <RenameDialog link={renaming} onClose={() => setRenaming(null)} onDone={async () => { setRenaming(null); await q.refetch() }} /> : null}
      {moving ? (
        <MoveDocumentDialog link={moving} onClose={() => setMoving(null)} onMoved={async (f) => { setMoving(null); setOpenFolder(f); await q.refetch() }} />
      ) : null}
    </>
  )
}

interface AddState { mode: 'file' | 'link'; folder: DocFolder; year: number; files: File[]; url: string; label: string; season: string; notes: string }

function AddDocumentDialog({ initial, onClose, onSave }: { initial: { mode: 'file' | 'link'; folder: DocFolder; files: File[] }; onClose: () => void; onSave: (a: AddState) => Promise<void> }) {
  const [a, setA] = useState<AddState>(() => ({ ...initial, year: thisYear(), url: '', label: '', season: '', notes: '' }))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof AddState>(k: K, v: AddState[K]) => setA((x) => ({ ...x, [k]: v }))
  return (
    <Modal title={a.mode === 'file' ? 'Upload documents' : 'Add a link'} submitLabel="Save" busy={busy} onClose={onClose} onSubmit={async () => {
      setBusy(true)
      try {
        await onSave(a)
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      {a.mode === 'file' ? (
        <FormField label={`Files (up to ${MAX_MB} MB each)`} htmlFor="doc-files">
          <input id="doc-files" type="file" multiple onChange={(e) => set('files', [...(e.target.files ?? [])])}
            className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-200 file:px-3 file:py-2 file:text-sm file:font-medium" />
        </FormField>
      ) : (
        <>
          <FormField label="Link" htmlFor="doc-url"><Input id="doc-url" value={a.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" autoFocus /></FormField>
          <FormField label="Label (optional)" htmlFor="doc-label"><Input id="doc-label" value={a.label} onChange={(e) => set('label', e.target.value)} placeholder="Fall 2026 catalog" /></FormField>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Folder" htmlFor="doc-folder">
          <Select id="doc-folder" value={a.folder} onChange={(e) => set('folder', e.target.value as DocFolder)}>
            {DOC_FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Year" htmlFor="doc-year">
          <Select id="doc-year" value={a.year} onChange={(e) => set('year', Number(e.target.value))}>
            {yearChoices().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField label="Season (optional)" htmlFor="doc-season" hint="e.g. Fall 2026"><Input id="doc-season" value={a.season} onChange={(e) => set('season', e.target.value)} /></FormField>
      <FormField label="Notes (optional)" htmlFor="doc-notes"><Input id="doc-notes" value={a.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
    </Modal>
  )
}


function RenameDialog({ link, onClose, onDone }: { link: VendorLinkRow; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [name, setName] = useState(link.label)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Rename" submitLabel="Save" busy={busy} onClose={onClose} onSubmit={async () => {
      setBusy(true)
      try {
        await renameVendorLink(link.id, name)
        toast.success('Renamed')
        await onDone()
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <FormField label="Name" htmlFor="rn-name">
        <Input id="rn-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </FormField>
      {link.file_name ? <p className="text-xs text-stone-500">File: {link.file_name}</p> : null}
    </Modal>
  )
}
