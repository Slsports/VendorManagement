import { useMemo, useState } from 'react'
import { ArrowLeft, Folder, Paperclip, X } from 'lucide-react'
import type { VendorLinkRow } from '@/services/lines'
import { DOC_FOLDERS, folderLabel, folderOf, type DocFolder } from '@/lib/documents'
import { shortDate } from '@/lib/utils'

/**
 * Attach from the vendor's files (Dana, Oct 28: "it needs to come up with folders"): the files for this order or
 * conversation on top, then the vendor's folders; a folder shows its files newest first with their dates. The files
 * picked show above as chips, so the email always says what goes with it.
 */
export function VendorFilePicker({ links, selected, onChange, orderId, threadId }: {
  links: VendorLinkRow[]
  selected: string[]
  onChange: (ids: string[]) => void
  orderId?: string | null
  threadId?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [folder, setFolder] = useState<DocFolder | null>(null)
  const [find, setFind] = useState('')
  const byId = useMemo(() => new Map(links.map((l) => [l.id, l])), [links])
  const picked = selected.map((id) => byId.get(id)).filter((l): l is VendorLinkRow => !!l)
  const here = links.filter((l) => (orderId && l.order_id === orderId) || (threadId && l.email?.thread_id === threadId))
  const counts = new Map<DocFolder, number>()
  for (const l of links) counts.set(folderOf(l.kind), (counts.get(folderOf(l.kind)) ?? 0) + 1)
  const q = find.trim().toLowerCase()
  const hits = q ? links.filter((l) => [l.label, l.file_name, l.orig_label, l.doc_number, l.season_label].some((v) => (v ?? '').toLowerCase().includes(q))) : []
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id))

  const row = (l: VendorLinkRow, showFolder = false) => (
    <li key={l.id}>
      <label className="flex items-start gap-2 rounded-md px-1 py-1 text-sm text-stone-800 hover:bg-stone-50">
        <input type="checkbox" checked={selected.includes(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded border-stone-300" />
        <span className="min-w-0">
          <span className="block break-words font-medium">{l.label}</span>
          <span className="block text-xs text-stone-500">
            {[showFolder ? folderLabel(folderOf(l.kind)) : null, l.file_name, shortDate(l.received_at ?? l.created_at)].filter(Boolean).join(' · ')}
          </span>
        </span>
      </label>
    </li>
  )

  if (!links.length) return null
  return (
    <div className="mt-2">
      {picked.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Vendor files going with this email">
          {picked.map((l) => (
            <li key={l.id} className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-stone-800 ring-1 ring-amber-200">
              <Paperclip className="size-3.5 text-amber-600" aria-hidden="true" />{l.label}
              <button type="button" onClick={() => toggle(l.id, false)} aria-label={`Remove ${l.label}`} className="text-stone-400 hover:text-red-600"><X className="size-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="text-xs font-medium text-brand hover:underline">
        {open ? 'Close the vendor\'s files' : `Attach from the vendor's files (${links.length})`}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-stone-200 p-2">
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a file: number, name…" aria-label="Find a vendor file"
            className="h-9 w-full rounded-lg border border-stone-300 px-2 text-base sm:text-sm" />
          {q ? (
            hits.length ? <ul className="mt-2 max-h-72 overflow-y-auto">{hits.slice(0, 100).map((l) => row(l, true))}</ul>
              : <p className="mt-2 text-sm text-stone-500">No file matches.</p>
          ) : folder ? (
            <div className="mt-2">
              <button type="button" onClick={() => setFolder(null)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><ArrowLeft className="size-3.5" aria-hidden="true" />All folders</button>
              <p className="mt-1 text-sm font-semibold text-stone-900">{folderLabel(folder)}</p>
              <ul className="mt-1 max-h-72 overflow-y-auto">{links.filter((l) => folderOf(l.kind) === folder).map((l) => row(l))}</ul>
            </div>
          ) : (
            <>
              {here.length ? (
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{orderId ? 'For this order' : 'From this conversation'}</p>
                  <ul className="mt-1">{here.map((l) => row(l, true))}</ul>
                </div>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DOC_FOLDERS.filter((f) => counts.get(f.id)).map((f) => (
                  <button key={f.id} type="button" onClick={() => setFolder(f.id)} className="flex items-center gap-2 rounded-lg border border-stone-200 px-2 py-1.5 text-left text-sm hover:bg-stone-50">
                    <Folder className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                    <span className="min-w-0"><span className="block truncate font-medium text-stone-900">{f.label}</span><span className="block text-xs text-stone-500">{counts.get(f.id)} {counts.get(f.id) === 1 ? 'file' : 'files'}</span></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
