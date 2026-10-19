import { useRef, useState, type DragEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, FolderOpen, RefreshCw, Search, UploadCloud } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { countUnfiledEmails, dropDocument, listDocumentFolders, listDocuments, runFiling, type DocumentFolder, type DropResult } from '@/services/accountingDocuments'
import { listMailboxes } from '@/services/mail'
import { ACCOUNTING_CATEGORIES, categoryLabel } from '@/lib/accounting'
import { folderLabel } from '@/lib/accountingDocuments'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { DocumentRows } from '@/components/accounting/DocumentRows'
import { Alert, Badge, Button, Input, Spinner } from '@/components/ui'

/**
 * Accounting → Documents (Dana, Oct 16): the folders (Category / Party / Year the paper is about), the drop box for
 * files from her computer, and "Needs a look" for papers Claude was unsure of. Everything that comes to billing@ is
 * filed here on its own, every minute, newest first, back through the whole mailbox.
 */
export default function AccountingDocumentsPage() {
  const { organization, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? ''
  const party = params.get('party') ?? ''
  const year = Number(params.get('year') ?? '') || 0
  const tab = params.get('tab') ?? 'folders'
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)
  useLiveTable('accounting_documents', null, refresh)

  const folders = useSupabaseQuery(async () => (organization ? listDocumentFolders(organization.id) : []), [organization?.id, tick])
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting') ?? null
  const unfiled = useSupabaseQuery(async () => (box ? countUnfiledEmails(box.id) : 0), [box?.id, tick])
  const inFolder = !!(category && party && year)
  const docs = useSupabaseQuery(async () => {
    if (!organization) return []
    if (tab === 'review') return listDocuments(organization.id, { status: 'review' })
    if (q) return listDocuments(organization.id, { q })
    if (inFolder) return listDocuments(organization.id, { category, party, year })
    return []
  }, [organization?.id, tab, q, category, party, year, tick])
  const parties = [...new Set((folders.data ?? []).map((f) => f.party))].sort()
  const reviewCount = (folders.data ?? []).reduce((n, f) => n + Number(f.review_n), 0)
  const total = (folders.data ?? []).reduce((n, f) => n + Number(f.n), 0)

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    setParams(p)
  }

  const [running, setRunning] = useState(false)
  async function fileNow() {
    setRunning(true)
    try {
      const runs = await runFiling()
      const r = runs[0]
      toast.success(r ? `${r.filed} filed, ${r.skipped} left in their emails, ${r.linked} already on file${r.errors ? `, ${r.errors} could not be read` : ''}. ${r.left} emails still to look at.` : 'Nothing to file')
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Accounting" title="Documents" description="Every paper from billing@ filed by category, party and the year it is about, named the same way every time."
        actions={<Button variant="secondary" size="sm" onClick={fileNow} loading={running} title="Look at the next emails now (it runs every minute on its own)"><RefreshCw className="size-4" aria-hidden="true" />File now</Button>} />

      {unfiled.data ? <Alert variant="info">{unfiled.data.toLocaleString()} emails with files still to look at. Filing runs every minute, newest first; <button type="button" onClick={fileNow} className="font-medium underline">file the next ones now</button>.</Alert> : null}

      <DropBox organizationId={organization?.id ?? null} userId={profile?.id ?? null} onFiled={refresh} />

      <div className="flex flex-wrap items-center gap-2">
        <nav className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-sm">
          <button type="button" onClick={() => go({})} className={cn('rounded-md px-3 py-1.5', tab === 'folders' && !q ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100')}>Folders <span className="opacity-70">{total.toLocaleString()}</span></button>
          <button type="button" onClick={() => go({ tab: 'review' })} className={cn('rounded-md px-3 py-1.5', tab === 'review' ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100')}>Needs a look {reviewCount ? <Badge tone={tab === 'review' ? 'neutral' : 'warning'} className="ml-1">{reviewCount}</Badge> : null}</button>
        </nav>
        <form className="relative ml-auto w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim() }) }}>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-stone-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names, numbers, parties" className="pl-8" aria-label="Search documents" />
        </form>
      </div>

      {tab === 'review' ? (
        <section className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-100 px-4 py-3 text-sm text-stone-600">Papers Claude filed but was not sure about. Open each, then <strong>Looks right</strong> or move it with the pencil.</div>
          {docs.isLoading ? <Spinner label="Loading…" className="m-4 text-brand" /> : <DocumentRows docs={docs.data ?? []} parties={parties} onChanged={refresh} empty="Nothing waiting. Everything filed looked sure." />}
        </section>
      ) : q ? (
        <section className="rounded-2xl border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 text-sm text-stone-600"><span>Results for “{q}”</span><button type="button" onClick={() => { setSearch(''); go({}) }} className="text-brand hover:underline">Clear</button></div>
          {docs.isLoading ? <Spinner label="Searching…" className="m-4 text-brand" /> : <DocumentRows docs={docs.data ?? []} parties={parties} onChanged={refresh} empty="No file matches." />}
        </section>
      ) : (
        <section className="rounded-2xl border border-stone-200 bg-white">
          <Crumbs category={category} party={party} year={year} go={go} />
          {folders.isLoading ? <Spinner label="Loading…" className="m-4 text-brand" />
            : folders.error ? <Alert variant="error" className="m-4">{folders.error}</Alert>
            : !category ? <CategoryList folders={folders.data ?? []} go={go} />
            : !party ? <PartyList folders={(folders.data ?? []).filter((f) => f.category === category)} category={category} go={go} />
            : !year ? <YearList folders={(folders.data ?? []).filter((f) => f.category === category && f.party === party)} category={category} party={party} go={go} />
            : docs.isLoading ? <Spinner label="Loading…" className="m-4 text-brand" />
            : <DocumentRows docs={docs.data ?? []} parties={parties} showFolder={false} onChanged={refresh} empty="This folder is empty." />}
        </section>
      )}
    </div>
  )
}

function Crumbs({ category, party, year, go }: { category: string; party: string; year: number; go: (n: Record<string, string>) => void }) {
  const crumb = 'hover:text-brand hover:underline'
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-stone-100 px-4 py-3 text-sm text-stone-700">
      <FolderOpen className="size-4 text-stone-400" aria-hidden="true" />
      <button type="button" onClick={() => go({})} className={cn(crumb, !category && 'font-semibold text-stone-900')}>All folders</button>
      {category ? <><ChevronRight className="size-4 text-stone-300" aria-hidden="true" /><button type="button" onClick={() => go({ category })} className={cn(crumb, !party && 'font-semibold text-stone-900')}>{categoryLabel(category)}</button></> : null}
      {party ? <><ChevronRight className="size-4 text-stone-300" aria-hidden="true" /><button type="button" onClick={() => go({ category, party })} className={cn(crumb, !year && 'font-semibold text-stone-900')}>{party}</button></> : null}
      {year ? <><ChevronRight className="size-4 text-stone-300" aria-hidden="true" /><span className="font-semibold text-stone-900">{year}</span></> : null}
    </div>
  )
}

const sum = (fs: DocumentFolder[]) => fs.reduce((n, f) => n + Number(f.n), 0)
const sumReview = (fs: DocumentFolder[]) => fs.reduce((n, f) => n + Number(f.review_n), 0)

function FolderButton({ label, n, review, onClick }: { label: string; n: number; review: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-4 py-3 text-left hover:border-brand hover:bg-stone-50">
      <span className="inline-flex items-center gap-2 font-medium text-stone-900"><FolderOpen className="size-4 text-amber-500" aria-hidden="true" />{label}</span>
      <span className="inline-flex items-center gap-2 text-sm text-stone-500">{n.toLocaleString()}{review ? <Badge tone="warning">{review} to look at</Badge> : null}</span>
    </button>
  )
}

function CategoryList({ folders, go }: { folders: DocumentFolder[]; go: (n: Record<string, string>) => void }) {
  const cats = ACCOUNTING_CATEGORIES.filter((c) => folders.some((f) => f.category === c))
  if (!cats.length) return <p className="px-4 py-6 text-sm text-stone-500">No papers filed yet. They appear here as the filing step works through billing@, and when you drop files above.</p>
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {cats.map((c) => { const fs = folders.filter((f) => f.category === c); return <FolderButton key={c} label={categoryLabel(c)} n={sum(fs)} review={sumReview(fs)} onClick={() => go({ category: c })} /> })}
    </div>
  )
}

function PartyList({ folders, category, go }: { folders: DocumentFolder[]; category: string; go: (n: Record<string, string>) => void }) {
  const parties = [...new Set(folders.map((f) => f.party))].sort((a, b) => a.localeCompare(b))
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {parties.map((p) => { const fs = folders.filter((f) => f.party === p); return <FolderButton key={p} label={p || 'Unsorted'} n={sum(fs)} review={sumReview(fs)} onClick={() => go({ category, party: p })} /> })}
    </div>
  )
}

function YearList({ folders, category, party, go }: { folders: DocumentFolder[]; category: string; party: string; go: (n: Record<string, string>) => void }) {
  const years = [...new Set(folders.map((f) => f.doc_year))].sort((a, b) => b - a)
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4">
      {years.map((y) => { const fs = folders.filter((f) => f.doc_year === y); return <FolderButton key={y} label={String(y)} n={sum(fs)} review={sumReview(fs)} onClick={() => go({ category, party, year: String(y) })} /> })}
    </div>
  )
}

type DropRow = { key: string; name: string; step: 'uploading' | 'reading' | 'done' | 'already' | 'error'; result?: DropResult; error?: string }

/** Drag files from the computer (or choose them); each is read, named and filed, and the result shows where it went. */
function DropBox({ organizationId, userId, onFiled }: { organizationId: string | null; userId: string | null; onFiled: () => void }) {
  const [rows, setRows] = useState<DropRow[]>([])
  const [over, setOver] = useState(false)
  const [hint, setHint] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const busy = rows.some((r) => r.step === 'uploading' || r.step === 'reading')

  async function take(files: FileList | File[]) {
    if (!organizationId || !userId) return
    const list = [...files].filter((f) => f.size > 0)
    if (!list.length) return
    const keys = list.map((f) => `${f.name}-${f.size}-${Date.now()}-${Math.random()}`)
    setRows((rs) => [...list.map((f, i) => ({ key: keys[i]!, name: f.name, step: 'uploading' as const })), ...rs])
    const update = (key: string, patch: Partial<DropRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    let filed = 0
    // one at a time, so Claude reads each with full attention and the list shows progress
    for (let i = 0; i < list.length; i++) {
      const key = keys[i]!
      try {
        const result = await dropDocument(organizationId, userId, list[i]!, hint.trim() || null, (step) => update(key, { step }))
        update(key, { step: result.status === 'already' ? 'already' : 'done', result })
        if (result.status === 'filed') filed++
      } catch (e) {
        update(key, { step: 'error', error: errorMessage(e) })
      }
    }
    if (filed) onFiled()
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setOver(false)
    void take(e.dataTransfer.files)
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition', over ? 'border-brand bg-brand/5' : 'border-stone-300')}>
        <UploadCloud className="size-7 text-stone-400" aria-hidden="true" />
        <p className="text-sm text-stone-700"><strong>Drop box.</strong> Drag papers from your computer here, or <button type="button" onClick={() => input.current?.click()} className="font-medium text-brand underline">choose files</button>. Each is read, named by the rule and filed in its folder.</p>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) void take(e.target.files); e.target.value = '' }} accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.xls,.csv,.doc,.docx" />
        <label className="mt-1 flex w-full max-w-md items-center gap-2 text-xs text-stone-500">
          <span className="shrink-0">A word about these files (optional):</span>
          <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="2024 Cal Fair policies for the SLS building" className="h-8 text-xs" />
        </label>
      </div>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1 truncate text-stone-700">{r.name}</span>
              {r.step === 'uploading' ? <span className="text-stone-500">Uploading…</span>
                : r.step === 'reading' ? <span className="inline-flex items-center gap-1 text-stone-500"><Spinner className="size-3.5 text-brand" />Reading…</span>
                : r.step === 'error' ? <span className="text-red-700">{r.error}</span>
                : r.result ? (
                  <span className={cn('inline-flex flex-wrap items-center gap-1', r.step === 'already' ? 'text-stone-500' : 'text-emerald-700')}>
                    {r.step === 'already' ? 'Already on file as' : r.result.document.status === 'review' ? 'Filed, needs a look:' : 'Filed:'}
                    <Link to={`${ROUTES.accountingDocuments}?category=${encodeURIComponent(r.result.document.category)}&party=${encodeURIComponent(r.result.document.party)}&year=${r.result.document.doc_year}`} className="font-medium hover:underline">{folderLabel(r.result.document)}</Link>
                    <span className="text-stone-600">› {r.result.document.file_name}</span>
                  </span>
                ) : null}
            </li>
          ))}
          {!busy ? <li className="py-2 text-right"><button type="button" onClick={() => setRows([])} className="text-xs text-stone-500 hover:text-stone-900">Clear the list</button></li> : null}
        </ul>
      ) : null}
    </section>
  )
}

