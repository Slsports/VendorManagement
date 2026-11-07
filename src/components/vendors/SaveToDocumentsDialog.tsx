import { useState } from 'react'
import toast from 'react-hot-toast'
import { fileAttachmentToVendor } from '@/services/mail'
import { kickOrderChecks } from '@/services/orderChecks'
import { DOC_FOLDERS, folderLabel, guessFolder, kindFor, yearChoices, type DocFolder } from '@/lib/documents'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { FormField, Select } from '@/components/ui'
import { VendorPicker } from '@/components/vendors/VendorPicker'

/** "Save to documents" on an email attachment: pick the vendor's folder and year (guessed from the file). On mail with no
 * vendor (Edenred, Dana Nov 7: "Why can't I just make this a vendor from this screen?") the vendor is picked here too,
 * or added new with + Add new vendor. */
export function SaveToDocumentsDialog({ attachment, vendor, subject, receivedAt, onClose, onSaved }: {
  attachment: { id: string; file_name: string }
  vendor: { id: string; name: string } | null
  subject: string | null
  receivedAt: string
  onClose: () => void
  onSaved: (where: string) => void
}) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(vendor)
  const [folder, setFolder] = useState<DocFolder>(() => guessFolder(attachment.file_name, subject))
  const [year, setYear] = useState(() => new Date(receivedAt).getFullYear())
  const [busy, setBusy] = useState(false)
  const years = [...new Set([...yearChoices(), year])].sort((a, b) => b - a)
  return (
    <Modal title={`Save ${attachment.file_name}`} submitLabel="Save" busy={busy} onClose={onClose} onSubmit={async () => {
      if (!picked) { toast.error('Pick the vendor first'); return }
      setBusy(true)
      try {
        await fileAttachmentToVendor(attachment.id, picked.id, kindFor(folder), undefined, year)
        // confirmations and invoices: Claude finds the order and checks them (Dana, Oct 10)
        const checked = folder === 'confirmations' || folder === 'invoices'
        if (checked) kickOrderChecks()
        toast.success(`Saved to ${picked.name} › ${folderLabel(folder)} › ${year}${checked ? '. Claude is checking it against the order.' : ''}`)
        onSaved(`${vendor ? '' : `${picked.name} › `}${folderLabel(folder)} › ${year}`)
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      {vendor ? <p className="text-sm text-stone-600">Into {vendor.name}'s documents.</p> : (
        <FormField label="Vendor" htmlFor="sd-vendor">
          {picked ? (
            <p className="flex items-center gap-2 text-sm text-stone-800">{picked.name}
              <button type="button" onClick={() => setPicked(null)} className="text-xs font-medium text-brand hover:underline">Change</button></p>
          ) : <VendorPicker placeholder="Type the vendor, or + Add new vendor" onPick={(v) => setPicked({ id: v.id, name: v.name })} autoFocus />}
        </FormField>
      )}
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
