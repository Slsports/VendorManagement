import { useState } from 'react'
import toast from 'react-hot-toast'
import { fileAttachmentToVendor } from '@/services/mail'
import { kickOrderChecks } from '@/services/orderChecks'
import { DOC_FOLDERS, folderLabel, guessFolder, kindFor, yearChoices, type DocFolder } from '@/lib/documents'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { FormField, Select } from '@/components/ui'

/** "Save to documents" on an email attachment: pick the vendor's folder and year (guessed from the file). */
export function SaveToDocumentsDialog({ attachment, vendor, subject, receivedAt, onClose, onSaved }: {
  attachment: { id: string; file_name: string }
  vendor: { id: string; name: string }
  subject: string | null
  receivedAt: string
  onClose: () => void
  onSaved: (where: string) => void
}) {
  const [folder, setFolder] = useState<DocFolder>(() => guessFolder(attachment.file_name, subject))
  const [year, setYear] = useState(() => new Date(receivedAt).getFullYear())
  const [busy, setBusy] = useState(false)
  const years = [...new Set([...yearChoices(), year])].sort((a, b) => b - a)
  return (
    <Modal title={`Save ${attachment.file_name}`} submitLabel="Save" busy={busy} onClose={onClose} onSubmit={async () => {
      setBusy(true)
      try {
        await fileAttachmentToVendor(attachment.id, vendor.id, kindFor(folder), undefined, year)
        // confirmations and invoices: Claude finds the order and checks them (Dana, Oct 10)
        const checked = folder === 'confirmations' || folder === 'invoices'
        if (checked) kickOrderChecks()
        toast.success(`Saved to ${vendor.name} › ${folderLabel(folder)} › ${year}${checked ? '. Claude is checking it against the order.' : ''}`)
        onSaved(`${folderLabel(folder)} › ${year}`)
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <p className="text-sm text-stone-600">Into {vendor.name}'s documents.</p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Folder" htmlFor="sd-folder">
          <Select id="sd-folder" value={folder} onChange={(e) => setFolder(e.target.value as DocFolder)}>
            {DOC_FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Year" htmlFor="sd-year">
          <Select id="sd-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </FormField>
      </div>
    </Modal>
  )
}
