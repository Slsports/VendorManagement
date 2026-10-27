import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { downloadVendorFile, listRepGroupLinks } from '@/services/lines'
import { folderLabel, folderOf } from '@/lib/documents'
import { FoldSection } from '@/components/shared/FoldSection'

const when = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString() : '')

/**
 * A rep group's own files (Dana, Oct 27: show info, buyer letters, line lists "go with the rep group"), newest first.
 * Each opens in VMS's viewer. Files about one of the rep group's vendors live under that vendor, not here.
 */
export function RepGroupDocumentsSection({ repGroupId }: { repGroupId: string }) {
  const q = useSupabaseQuery(() => listRepGroupLinks(repGroupId), [repGroupId])
  const { view, viewer } = useDocumentViewer()
  const rows = q.data ?? []
  const summary = q.isLoading ? null : rows.length ? `${rows.length} file${rows.length === 1 ? '' : 's'}` : 'None'
  return (
    <FoldSection title="Documents" summary={summary} className="mb-6">
      {rows.length === 0 ? <p className="text-sm text-stone-500">No files for this rep group yet. Show info and letters from the rep land here, from Dropbox or an email.</p> : (
        <ul className="divide-y divide-stone-100 text-sm">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                {l.storage_path ? <button type="button" className="text-left font-medium text-stone-900 hover:text-brand" onClick={() => view({ name: l.file_name ?? l.label, mime: l.mime_type, load: () => downloadVendorFile(l.storage_path!) })}>{l.file_name ?? l.label}</button>
                  : <a href={l.url ?? '#'} target="_blank" rel="noreferrer" className="font-medium text-stone-900 hover:text-brand">{l.label}</a>}
                <span className="block text-xs text-stone-500">{folderLabel(folderOf(l.kind))}{l.doc_year ? ` · ${l.doc_year}` : ''}{l.received_at ? ` · ${when(l.received_at)}` : ''}{l.notes ? ` · ${l.notes}` : ''}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {viewer}
    </FoldSection>
  )
}
