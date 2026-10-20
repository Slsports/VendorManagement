import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check, FileText, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getUploadDoc, resolveUploadDoc, uploadFileUrl } from '@/services/invoiceUploads'
import { errorMessage, shortDate } from '@/lib/utils'
import type { ReviewItem } from '@/types'
import { Button, Select } from '@/components/ui'
import { VendorPicker } from '@/components/vendors/VendorPicker'

const FOLDERS = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'credits', label: 'Credits' },
  { id: 'shipping', label: 'Shipping (packing slip)' },
  { id: 'confirmations', label: 'Confirmations' },
]

/**
 * A scanned invoice Claude could not file by itself (Dana, Oct 20): open the scan, pick what is missing (vendor, store,
 * folder), File it. A store picked for the name Claude read is saved as that vendor's Invoice alias.
 */
export function InvoiceUploadReview({ item, canEdit, onDone }: { item: ReviewItem; canEdit: boolean; onDone: () => void | Promise<void> }) {
  const { stores } = useAuth()
  const q = useSupabaseQuery(() => (item.entity_id ? getUploadDoc(item.entity_id) : Promise.resolve(null)), [item.entity_id])
  const d = q.data
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null)
  const [store, setStore] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!d) return q.error ? <p className="mt-2 text-red-700">{q.error}</p> : null
  const vendorNow = vendor ?? (d.vendor_id ? { id: d.vendor_id, name: d.vendor_name ?? 'Vendor' } : null)
  const storeNow = store ?? d.store_code ?? ''
  const folderNow = folder ?? (FOLDERS.some((f) => f.id === d.folder) ? d.folder! : '')

  async function act(action: 'file' | 'set_aside') {
    if (!d) return
    setBusy(true)
    try {
      const res = await resolveUploadDoc(d.id, { vendorId: vendorNow?.id ?? null, store: storeNow || null, folder: folderNow || null, action })
      toast.success(res === 'filed' ? `Filed to ${vendorNow?.name}` : res === 'duplicate' ? 'Already on file; not saved again' : 'Set aside')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function open() {
    try { window.open(await uploadFileUrl(d!.storage_path), '_blank', 'noopener') } catch (err) { toast.error(errorMessage(err)) }
  }

  const read = [d.vendor_name_read, d.doc_number ? `#${d.doc_number}` : null, d.store_read ? `store "${d.store_read}"` : null, d.doc_date ? shortDate(d.doc_date) : null, d.doc_total != null ? `$${Number(d.doc_total).toFixed(2)}` : null].filter(Boolean).join(' · ')
  return (
    <div className="mt-2 space-y-3">
      <p className="text-stone-700">{d.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void open()} leftIcon={<FileText className="size-4" aria-hidden="true" />}>Open the scan</Button>
        {read ? <span className="text-xs text-stone-600">Claude read: {read}</span> : null}
      </div>
      {canEdit ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {vendorNow && !changing
              ? <button type="button" onClick={() => setChanging(true)} className="h-9 truncate rounded-lg border border-stone-300 bg-white px-3 text-left text-sm text-stone-800 hover:bg-stone-50" title="Change the vendor">{vendorNow.name}</button>
              : <VendorPicker onPick={(v) => { setVendor({ id: v.id, name: v.name }); setChanging(false) }} placeholder="Which vendor?" className="w-full" />}
            <Select value={storeNow} onChange={(e) => setStore(e.target.value)} aria-label="Store" className="h-9">
              <option value="">Which store?</option>
              {stores.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
            </Select>
            <Select value={folderNow} onChange={(e) => setFolder(e.target.value)} aria-label="Folder" className="h-9">
              <option value="">Which folder?</option>
              {FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </div>
          {d.store_read && storeNow && storeNow !== d.store_code ? <p className="text-xs text-stone-500">"{d.store_read}" will be saved as {storeNow} for this vendor, so the next one files itself.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} disabled={!vendorNow?.id || !storeNow || !folderNow} onClick={() => void act('file')} leftIcon={<Check className="size-4" aria-hidden="true" />}>File it</Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void act('set_aside')} leftIcon={<X className="size-4" aria-hidden="true" />}>Not an invoice: set aside</Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
