import { Fragment, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { CheckCircle2, FolderOpen, RefreshCw } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { useAuth } from '@/hooks/useAuth'
import {
  applyDropboxNow, approveDropbox, decideDropboxFile, disconnectDropbox, dropboxFolderSummary, dropboxSignInUrl, dropboxStatus, listDropboxFiles, listDropboxFolders,
  readDropboxNow, rescanDropbox, saveDropboxAppKey, scanDropbox, setDropboxFolder, setDropboxReading, skipDropboxFolder, type DropboxFile, type DropboxFileStatus, type DropboxFolderSummary, type DropboxStatus,
} from '@/services/dropbox'
import { ROUTES } from '@/lib/constants'
import { DOC_FOLDERS, folderLabel, folderOf } from '@/lib/documents'
import { errorMessage } from '@/lib/utils'
import type { VendorLinkKind } from '@/types'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'
import { VendorPicker } from '@/components/vendors/VendorPicker'

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const section = 'rounded-2xl border border-stone-200 bg-white p-5'

/**
 * Settings → Dropbox (Dana, Oct 26): connect once, pick the folder, list it (the dry run), let Claude say where each
 * file would go by VMS's rules, approve by folder or one by one, then file. Later: watch a scan inbox folder.
 */
export default function DropboxSettings() {
  const q = useSupabaseQuery(() => dropboxStatus(), [])
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Could not load'}</Alert>
  return <Dropbox s={q.data} refetch={q.refetch} />
}

function Dropbox({ s, refetch }: { s: DropboxStatus; refetch: () => Promise<unknown> }) {
  const [appKey, setAppKey] = useState('')
  const [editing, setEditing] = useState(!s.set_up)
  const [busy, setBusy] = useState<string | null>(null)
  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key)
    try {
      await fn()
      if (done) toast.success(done)
      await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
      await refetch()
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="space-y-4">
      <section className={section}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-stone-900">Dropbox</h2>
          {s.connected ? <Badge tone="success">Connected</Badge> : s.set_up ? <Badge tone="warning">Not connected yet</Badge> : <Badge tone="neutral">Not set up</Badge>}
        </div>
        <p className="mt-1 text-sm text-stone-600">VMS reads one folder of your Dropbox. Claude says what each file is and where it goes by VMS's own rules (a vendor's Documents, or Accounting Documents), never by the Dropbox folder name. Nothing is filed until you approve. Your Dropbox is not changed.</p>
        {s.connected ? <p className="mt-3 flex items-center gap-1.5 text-sm text-stone-800"><CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />{s.account_name ?? 'Dropbox'}{s.account_email ? ` (${s.account_email})` : ''}{s.connected_at ? `, connected ${when(s.connected_at)}` : ''}</p> : null}
        {s.last_error ? <Alert variant="error" className="mt-3">{s.last_error}</Alert> : null}
        {s.set_up && !editing ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!s.connected ? <Button loading={busy === 'connect'} disabled={!!busy} onClick={() => void run('connect', async () => { window.location.assign(await dropboxSignInUrl()) })}>Connect to Dropbox</Button> : null}
            {s.connected ? <Button variant="ghost" size="sm" loading={busy === 'disconnect'} disabled={!!busy} onClick={() => { if (window.confirm('Disconnect VMS from Dropbox? Files already filed stay in VMS.')) void run('disconnect', disconnectDropbox, 'Disconnected') }}>Disconnect</Button> : null}
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Replace the App key</Button>
          </div>
        ) : (
          <form className="mt-3 space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run('save', async () => { await saveDropboxAppKey(appKey); setAppKey(''); setEditing(false) }, 'Saved') }}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600">
              <li>Go to <strong>dropbox.com/developers/apps</strong> (signed in as yourself) and click <strong>Create app</strong>: choose <strong>Scoped access</strong>, then <strong>Full Dropbox</strong>, and name it VMS.</li>
              <li>On the app's <strong>Permissions</strong> tab tick <strong>account_info.read</strong>, <strong>files.metadata.read</strong>, <strong>files.content.read</strong> and <strong>files.content.write</strong>, then <strong>Submit</strong>.</li>
              <li>On the <strong>Settings</strong> tab, under <strong>OAuth 2 › Redirect URIs</strong>, add <code className="rounded bg-stone-100 px-1">{s.redirect_uri}</code> and click <strong>Add</strong>.</li>
              <li>Copy the <strong>App key</strong> (not the secret) and paste it here.</li>
            </ol>
            <FormField label="App key" htmlFor="dbx-key"><Input id="dbx-key" value={appKey} onChange={(e) => setAppKey(e.target.value)} autoComplete="off" spellCheck={false} /></FormField>
            <div className="flex gap-2">
              <Button type="submit" loading={busy === 'save'} disabled={!appKey.trim()}>Save</Button>
              {s.set_up ? <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button> : null}
            </div>
          </form>
        )}
      </section>
      {s.connected ? <FolderSection s={s} busy={busy} run={run} /> : null}
      {s.connected && s.folder_path ? <DryRun s={s} busy={busy} run={run} /> : null}
    </div>
  )
}

/** Which folder VMS reads, and how: the history pass, or the scan inbox. */
function FolderSection({ s, busy, run }: { s: DropboxStatus; busy: string | null; run: (k: string, fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [picking, setPicking] = useState(!s.folder_path)
  const [path, setPath] = useState(s.folder_path ?? '')
  const [mode, setMode] = useState<'history' | 'inbox'>(s.mode)
  const [move, setMove] = useState(s.move_filed)
  const [browsePath, setBrowsePath] = useState('')
  const browseQ = useSupabaseQuery(async () => (picking ? listDropboxFolders(browsePath) : null), [picking, browsePath])
  const browse = browseQ.data
  const open = (p: string) => setBrowsePath(p)
  const up = browse && browse.path ? browse.path.slice(0, browse.path.lastIndexOf('/')) : null
  return (
    <section className={section}>
      <h3 className="font-semibold text-stone-900">The folder VMS reads</h3>
      {!picking ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone-700">
          <span className="inline-flex items-center gap-1.5"><FolderOpen className="size-4 text-stone-500" aria-hidden="true" /><strong>{s.folder_path}</strong></span>
          <span>{s.mode === 'inbox' ? `Scan inbox: new files are filed on their own${s.move_filed ? ' and moved to Filed' : ''}.` : 'History: list it, read it, you approve, then it files.'}</span>
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>Change</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="rounded-lg border border-stone-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-stone-600">
              <span>Browsing <strong>{browse?.path || 'the top of your Dropbox'}</strong></span>
              {up !== null ? <Button size="sm" variant="ghost" onClick={() => open(up)}>Up</Button> : null}
              {browse?.path ? <Button size="sm" variant="secondary" onClick={() => setPath(browse.path)}>Use this folder</Button> : null}
            </div>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {(browse?.folders ?? []).map((f) => (
                <li key={f.path} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-stone-50">
                  <button type="button" className="inline-flex min-w-0 items-center gap-1.5 text-left text-stone-800 hover:text-brand" onClick={() => open(f.path)}><FolderOpen className="size-4 shrink-0 text-stone-400" aria-hidden="true" /><span className="truncate">{f.name}</span></button>
                  <Button size="sm" variant="ghost" onClick={() => setPath(f.path)}>Pick</Button>
                </li>
              ))}
              {browseQ.error ? <li className="text-red-700">{browseQ.error}</li> : null}
              {browse && browse.folders.length === 0 ? <li className="text-stone-500">No folders inside.</li> : null}
            </ul>
          </div>
          <FormField label="Folder" htmlFor="dbx-folder" hint="Pick it above, or type the path as Dropbox shows it."><Input id="dbx-folder" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} /></FormField>
          <FormField label="How VMS uses it" htmlFor="dbx-mode">
            <Select id="dbx-mode" value={mode} onChange={(e) => setMode(e.target.value as 'history' | 'inbox')}>
              <option value="history">History: list everything, I approve, then file</option>
              <option value="inbox">Scan inbox: file new files on their own</option>
            </Select>
          </FormField>
          {mode === 'inbox' ? <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4" checked={move} onChange={(e) => setMove(e.target.checked)} />Move filed files into a <strong>Filed</strong> subfolder</label> : null}
          <div className="flex gap-2">
            <Button loading={busy === 'folder'} disabled={!path.trim() || !!busy} onClick={() => void run('folder', async () => { await setDropboxFolder(path.trim(), mode, move); setPicking(false) }, 'Folder saved')}>Save folder</Button>
            {s.folder_path ? <Button variant="ghost" onClick={() => setPicking(false)}>Cancel</Button> : null}
          </div>
        </div>
      )}
    </section>
  )
}

/** The dry run: list, read, the per-folder table, and approving. */
function DryRun({ s, busy, run }: { s: DropboxStatus; busy: string | null; run: (k: string, fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const { organization } = useAuth()
  const orgId = organization?.id ?? ''
  const summary = useSupabaseQuery(async () => (orgId ? dropboxFolderSummary(orgId) : []), [orgId])
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  useLiveTable('dropbox_files', orgId ? `organization_id=eq.${orgId}` : null, () => { void summary.refetch() }, !!orgId)
  const c = s.files
  const rows = summary.data ?? []
  return (
    <section className={section}>
      <h3 className="font-semibold text-stone-900">What is in the folder, and where it would go</h3>
      <p className="mt-1 text-sm text-stone-600">
        {c.total === 0 ? 'Not listed yet. ' : `${c.total} files listed${s.scan_done ? '' : ' so far'}: `}
        {c.total ? <>{c.new} to read, {c.proposed} proposed ({c.sure_proposed} sure), {c.leftover} for you to place, {c.approved} approved, {c.filed} filed, {c.linked} already in VMS, {c.skipped} not documents{c.errors ? `, ${c.errors} errors` : ''}.</> : null}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!s.scan_done ? <Button size="sm" loading={busy === 'scan'} disabled={!!busy} onClick={() => void run('scan', scanDropbox)} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>{c.total ? 'List more' : 'List the folder'}</Button> : <Button size="sm" variant="secondary" loading={busy === 'scan'} disabled={!!busy} onClick={() => void run('scan', rescanDropbox)}>List again</Button>}
        {c.new > 0 ? (s.reading
          ? <Button size="sm" variant="secondary" loading={busy === 'reading'} disabled={!!busy} onClick={() => void run('reading', () => setDropboxReading(false), 'Reading paused')}>Pause reading</Button>
          : <Button size="sm" loading={busy === 'reading'} disabled={!!busy} onClick={() => void run('reading', async () => { await setDropboxReading(true); await readDropboxNow() }, 'Reading started')}>Read the files (Claude)</Button>) : null}
        {c.approved > 0 ? <Button size="sm" loading={busy === 'apply'} disabled={!!busy} onClick={() => void run('apply', applyDropboxNow, 'Filing')}>File the approved now</Button> : null}
        {c.sure_proposed > 0 ? <Button size="sm" variant="secondary" loading={busy === 'approve-all'} disabled={!!busy} onClick={() => { if (window.confirm(`Approve the ${c.sure_proposed} files Claude is sure about, in every folder?`)) void run('approve-all', async () => { const n = await approveDropbox(orgId, { sureOnly: true }); toast.success(`${n} approved`) }) }}>Approve all sure ones</Button> : null}
      </div>
      {s.reading && c.new > 0 ? <p className="mt-2 text-xs text-stone-500">Claude is reading in the background, a few files every couple of minutes{s.last_read_at ? ` (last ${when(s.last_read_at)})` : ''}. This page updates by itself.</p> : null}
      {!s.scan_done && c.total > 0 ? <p className="mt-2 text-xs text-stone-500">The listing carries on in the background every couple of minutes.</p> : null}
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-stone-500"><th className="py-1 pr-3">Folder</th><th className="py-1 pr-3 text-right">Files</th><th className="py-1 pr-3 text-right">To read</th><th className="py-1 pr-3 text-right">Proposed</th><th className="py-1 pr-3 text-right">For you</th><th className="py-1 pr-3 text-right">Filed</th><th className="py-1 pr-3 text-right">In VMS already</th><th className="py-1 pr-3 text-right">Skipped</th><th className="py-1"></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const folderOff = r.folder_skipped > 0 && r.new_count === 0 && r.proposed === 0 && r.leftover === 0
                return (
                <Fragment key={r.folder}>
                <tr className={`border-t border-stone-100 ${folderOff ? 'text-stone-400' : ''}`}>
                  <td className="py-1.5 pr-3"><button type="button" className="text-left text-brand hover:underline" onClick={() => setOpenFolder(openFolder === r.folder ? null : r.folder)}>{r.folder || '(top of the folder)'}</button>{folderOff ? <span className="ml-2 text-xs">skipped</span> : null}</td>
                  <td className="py-1.5 pr-3 text-right">{r.total}</td><td className="py-1.5 pr-3 text-right">{r.new_count}</td>
                  <td className="py-1.5 pr-3 text-right">{r.proposed}{r.sure_proposed ? <span className="text-stone-500"> ({r.sure_proposed} sure)</span> : null}</td>
                  <td className="py-1.5 pr-3 text-right">{r.leftover}</td><td className="py-1.5 pr-3 text-right">{r.filed + r.approved}</td><td className="py-1.5 pr-3 text-right">{r.linked}</td><td className="py-1.5 pr-3 text-right">{r.skipped}{r.errors ? <span className="text-red-700"> +{r.errors} err</span> : null}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {r.sure_proposed > 0 ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run(`approve:${r.folder}`, async () => { const n = await approveDropbox(orgId, { folder: r.folder, sureOnly: true }); toast.success(`${n} approved`) })}>Approve sure</Button> : null}
                    {folderOff
                      ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run(`unskip:${r.folder}`, async () => { const n = await skipDropboxFolder(orgId, r.folder, false); toast.success(`${n} files back to read`) })}>Read this folder</Button>
                      : r.new_count + r.proposed + r.leftover > 0 ? <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { if (window.confirm(`Skip the whole folder "${r.folder || '(top)'}"? Nothing in it is read or filed. You can put it back later.`)) void run(`skip:${r.folder}`, async () => { const n = await skipDropboxFolder(orgId, r.folder, true); toast.success(`${n} files skipped`) }) }}>Skip folder</Button> : null}
                  </td>
                </tr>
                {openFolder === r.folder ? <tr><td colSpan={9} className="p-0"><FolderFiles orgId={orgId} folder={r.folder} summary={r} onClose={() => setOpenFolder(null)} /></td></tr> : null}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

const STATUS_LABEL: Record<string, { text: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' }> = {
  new: { text: 'To read', tone: 'neutral' }, proposed: { text: 'Proposed', tone: 'info' }, leftover: { text: 'For you', tone: 'warning' }, approved: { text: 'Approved', tone: 'success' },
  filed: { text: 'Filed', tone: 'success' }, linked: { text: 'Already in VMS', tone: 'success' }, skipped: { text: 'Skipped', tone: 'neutral' }, error: { text: 'Error', tone: 'danger' },
}
const VENDOR_KINDS: VendorLinkKind[] = ['invoice', 'confirmation', 'credit', 'order', 'packing_slip', 'price_list', 'catalog', 'order_form', 'specials', 'proof', 'other']

/** One top folder's files (subfolders shown on each) with where each would go; approve, skip, or change the vendor and folder yourself. */
function FolderFiles({ orgId, folder, summary, onClose }: { orgId: string; folder: string; summary?: DropboxFolderSummary; onClose: () => void }) {
  const { profile } = useAuth()
  const [show, setShow] = useState<'open' | 'all'>('open')
  const statuses: DropboxFileStatus[] = show === 'open' ? ['proposed', 'leftover', 'error', 'new'] : ['new', 'proposed', 'leftover', 'approved', 'filed', 'linked', 'skipped', 'error']
  const q = useSupabaseQuery(async () => listDropboxFiles(orgId, folder, statuses), [orgId, folder, show])
  useLiveTable('dropbox_files', `organization_id=eq.${orgId}`, () => { void q.refetch() })
  const [changing, setChanging] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  async function decide(f: DropboxFile, change: Parameters<typeof decideDropboxFile>[2], done: string) {
    if (!profile) return
    setBusy(f.id)
    try { await decideDropboxFile(f.id, profile.id, change); toast.success(done); setChanging(null); await q.refetch() } catch (err) { toast.error(errorMessage(err)) } finally { setBusy(null) }
  }
  const where = (f: DropboxFile) => {
    const tail = <>{folderLabel(folderOf((f.kind ?? 'other') as VendorLinkKind))}{f.doc_year ? ` › ${f.doc_year}` : ''}{f.doc_number ? ` · ${f.doc_number}` : ''}{f.doc_total != null ? ` · $${Number(f.doc_total).toFixed(2)}` : ''}</>
    if (f.target === 'vendor') return <>{f.vendor?.name ?? <span className="text-amber-700">vendor not found{f.vendor_said ? ` ("${f.vendor_said}")` : ''}</span>} › {tail}</>
    if (f.target === 'line') return <>Line {f.line?.name ?? '?'} › {tail}</>
    if (f.target === 'freight') return <>Freight{f.freight_bill_id ? ' › the bill waiting for this PDF' : <span className="text-amber-700"> › no bill waiting for it</span>}{f.doc_number ? ` · ${f.doc_number}` : ''}{f.doc_total != null ? ` · $${Number(f.doc_total).toFixed(2)}` : ''}</>
    if (f.target === 'accounting') { const a = (f.accounting ?? {}) as { category?: string; party?: string; doc_year?: number; what?: string }; return <>Accounting › {a.category ?? '?'} › {a.party || 'Unsorted'} › {a.doc_year ?? ''}{a.what ? ` · ${a.what}` : ''}</> }
    if (f.target === 'skip' || f.status === 'skipped') return <span className="text-stone-500">Not filed: {f.skip_reason}</span>
    return <span className="text-stone-500">Not read yet</span>
  }
  return (
    <div className="my-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium text-stone-900">{folder || '(top of the folder)'}</h4>
        <span className="text-xs text-stone-500">{summary ? `${summary.total} files` : ''}</span>
        <Select className="!h-8 w-auto" value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')}><option value="open">Needs a look</option><option value="all">Everything</option></Select>
        {summary && summary.proposed > summary.sure_proposed ? <Button size="sm" variant="secondary" onClick={() => { if (window.confirm(`Approve all ${summary.proposed} proposed files in this folder, including the unsure ones?`)) void approveDropbox(orgId, { folder, sureOnly: false }).then((n) => { toast.success(`${n} approved`); void q.refetch() }).catch((err) => toast.error(errorMessage(err))) }}>Approve all here</Button> : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      {q.isLoading ? <Spinner label="Loading…" className="mt-3 text-brand" /> : (
        <ul className="mt-2 divide-y divide-stone-200">
          {(q.data ?? []).map((f) => (
            <li key={f.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <span className="min-w-0 flex-1">
                  {f.folder !== folder ? <span className="block text-xs text-stone-500">{f.folder}</span> : null}
                  <span className="font-medium text-stone-900">{f.name}</span>
                  <Badge tone={STATUS_LABEL[f.status]?.tone ?? 'neutral'} className="ml-2">{STATUS_LABEL[f.status]?.text ?? f.status}</Badge>
                  {f.status === 'proposed' && f.sure === false ? <Badge tone="warning" className="ml-1">unsure</Badge> : null}
                  <span className="block text-stone-700">{where(f)}</span>
                  {f.note ? <span className="block text-xs text-stone-500">{f.note}</span> : null}
                  {f.error ? <span className="block text-xs text-red-700">{f.error}</span> : null}
                </span>
                {['proposed', 'leftover', 'error'].includes(f.status) ? (
                  <span className="flex flex-wrap gap-1">
                    {f.status === 'proposed' || (f.status === 'leftover' && f.target === 'accounting') ? <Button size="sm" loading={busy === f.id} onClick={() => void decide(f, { status: 'approved' }, 'Approved')}>Approve</Button> : null}
                    <Button size="sm" variant="secondary" disabled={busy === f.id} onClick={() => setChanging(changing === f.id ? null : f.id)}>Vendor…</Button>
                    <Button size="sm" variant="ghost" disabled={busy === f.id} onClick={() => void decide(f, { status: 'skipped', target: 'skip', skip_reason: 'skipped by Dana' }, 'Skipped')}>Skip</Button>
                  </span>
                ) : f.status === 'skipped' && f.skip_reason === 'skipped by Dana' ? <Button size="sm" variant="ghost" onClick={() => void decide(f, { status: 'proposed', target: f.vendor_id ? 'vendor' : 'accounting' }, 'Back on the list')}>Undo</Button> : null}
              </div>
              {changing === f.id ? <ChangeVendor f={f} busy={busy === f.id} onPick={(vendorId, kind) => void decide(f, { status: 'approved', target: 'vendor', vendor_id: vendorId, line_id: null, kind }, 'Approved under the vendor')} onCancel={() => setChanging(null)} /> : null}
            </li>
          ))}
          {(q.data ?? []).length === 0 ? <li className="py-2 text-sm text-stone-500">Nothing here needs a look.</li> : null}
        </ul>
      )}
    </div>
  )
}

/** Dana's own answer: this file is this vendor's, in this folder. */
function ChangeVendor({ f, busy, onPick, onCancel }: { f: DropboxFile; busy: boolean; onPick: (vendorId: string, kind: VendorLinkKind) => void; onCancel: () => void }) {
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(f.vendor_id && f.vendor ? { id: f.vendor_id, name: f.vendor.name } : null)
  const [kind, setKind] = useState<VendorLinkKind>((f.kind as VendorLinkKind) || 'invoice')
  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <FormField label="Vendor" htmlFor={`dbx-v-${f.id}`}>{vendor ? <div className="flex items-center gap-2 text-sm"><span className="font-medium">{vendor.name}</span><Button size="sm" variant="ghost" onClick={() => setVendor(null)}>Change</Button></div> : <VendorPicker onPick={(v) => setVendor({ id: v.id, name: v.name })} />}</FormField>
      <FormField label="Folder" htmlFor={`dbx-k-${f.id}`}><Select id={`dbx-k-${f.id}`} value={kind} onChange={(e) => setKind(e.target.value as VendorLinkKind)}>{VENDOR_KINDS.map((k) => <option key={k} value={k}>{DOC_FOLDERS.find((d) => d.kinds.includes(k))?.label ?? k}</option>)}</Select></FormField>
      <Button loading={busy} disabled={!vendor} onClick={() => vendor && onPick(vendor.id, kind)}>Approve</Button>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

export function DropboxSettingsLink() {
  return <Link to={ROUTES.dropboxSettings} className="text-brand hover:underline">Settings › Dropbox</Link>
}
