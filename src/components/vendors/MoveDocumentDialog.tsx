import { useState } from 'react'
import toast from 'react-hot-toast'
import { moveVendorDocument } from '@/services/lines'
import { kickOrderChecks } from '@/services/orderChecks'
import { DOC_FOLDERS, folderLabel, folderOf, kindFor, thisYear, yearChoices, type DocFolder } from '@/lib/documents'
import { errorMessage } from '@/lib/utils'
import type { VendorLinkKind } from '@/types'
import { FormField, Select } from '@/components/ui'
import { Modal } from '@/components/shared/Modal'

/** Move a saved file to another folder or year (from the vendor's Documents, or the "Saved to" tag on an email). */
export function MoveDocumentDialog({ link, onClose, onMoved }: { link: { id: string; label: string; kind: VendorLinkKind; doc_year: number | null }; onClose: () => void; onMoved: (f: DocFolder, year: number) => void | Promise<void> }) {
  const [folder, setFolder] = useState<DocFolder>(folderOf(link.kind))
  const [year, setYear] = useState<number>(() => link.doc_year ?? thisYear())
  const [busy, setBusy] = useState(false)
  const years = [...new Set([...yearChoices(), year])].sort((x, y) => y - x)
  return (
    <Modal title={`Move "${link.label}"`} submitLabel="Move" busy={busy} onClose={onClose} onSubmit={async () => {
      setBusy(true)
      try {
        const kind = kindFor(folder, link.kind)
        await moveVendorDocument(link.id, kind, year)
        // into Confirmations or Invoices: Claude checks it against the order (out of them: its check is set aside)
        if (kind !== link.kind && (kind === 'confirmation' || kind === 'invoice')) kickOrderChecks()
        toast.success(`Moved to ${folderLabel(folder)} ${year}`)
        await onMoved(folder, year)
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Folder" htmlFor="mv-folder">
          <Select id="mv-folder" value={folder} onChange={(e) => setFolder(e.target.value as DocFolder)}>
            {DOC_FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Year" htmlFor="mv-year">
          <Select id="mv-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </FormField>
      </div>
    </Modal>
  )
}
