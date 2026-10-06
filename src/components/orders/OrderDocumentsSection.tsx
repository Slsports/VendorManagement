import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { ExternalLink, FileText, Plus, Trash2 } from 'lucide-react'
import { addVendorLink, deleteVendorLink, signedFileUrl, uploadVendorFile } from '@/services/lines'
import { LINK_KIND_LABELS } from '@/lib/vendors'
import { errorMessage } from '@/lib/utils'
import type { VendorLink, VendorLinkKind } from '@/types'
import { Badge, Button, FormField, Input, Select } from '@/components/ui'

const KINDS: VendorLinkKind[] = ['confirmation', 'invoice', 'order', 'packing_slip', 'payment', 'other']

/** The paper behind an order: confirmation, invoice, packing slip, payment proof. Upload or paste a link. */
export function OrderDocumentsSection({ orderId, vendorId, organizationId, userId, documents, canEdit, onChange }: { orderId: string; vendorId: string; organizationId: string; userId: string | null; documents: VendorLink[]; canEdit: boolean; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<VendorLinkKind>('confirmation')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const name = label.trim() || (file ? file.name : LINK_KIND_LABELS[kind])
      if (file) {
        const path = await uploadVendorFile(organizationId, vendorId, file)
        await addVendorLink({ organization_id: organizationId, vendor_id: vendorId, order_id: orderId, kind, label: name, storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || null, received_at: new Date().toISOString().slice(0, 10), created_by: userId })
      } else if (url.trim()) {
        await addVendorLink({ organization_id: organizationId, vendor_id: vendorId, order_id: orderId, kind, label: name, url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, received_at: new Date().toISOString().slice(0, 10), created_by: userId })
      } else throw new Error('Choose a file or paste a link')
      setAdding(false); setFile(null); setUrl(''); setLabel('')
      toast.success('Attached')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  async function open(d: VendorLink) {
    try { window.open(d.storage_path ? await signedFileUrl(d.storage_path) : d.url ?? '', '_blank', 'noopener') } catch (err) { toast.error(errorMessage(err)) }
  }
  async function remove(d: VendorLink) {
    if (!window.confirm(`Remove "${d.label}"?`)) return
    try { await deleteVendorLink(d); await onChange() } catch (err) { toast.error(errorMessage(err)) }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Documents</h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Attach</Button> : null}
      </div>
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <FormField label="Type" htmlFor="od-kind"><Select id="od-kind" value={kind} onChange={(e) => setKind(e.target.value as VendorLinkKind)}>{KINDS.map((k) => <option key={k} value={k}>{LINK_KIND_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Label (optional)" htmlFor="od-label"><Input id="od-label" value={label} onChange={(e) => setLabel(e.target.value)} /></FormField>
          <FormField label="File" htmlFor="od-file"><input id="od-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx,.eml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-200 file:px-3 file:py-2 file:text-sm file:font-medium" /></FormField>
          <FormField label="or a link" htmlFor="od-url"><Input id="od-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></FormField>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={saving}>Save</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </form>
      ) : null}
      {documents.length === 0 ? <p className="mt-3 text-sm text-stone-500">Nothing attached yet.</p> : (
        <ul className="mt-3 divide-y divide-stone-100">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              {d.storage_path ? <FileText className="size-5 shrink-0 text-stone-400" aria-hidden="true" /> : <ExternalLink className="size-5 shrink-0 text-stone-400" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => void open(d)} className="truncate text-left text-sm font-medium text-stone-900 hover:text-brand">{d.label}</button>
                <p className="text-xs text-stone-500"><Badge tone="neutral" className="mr-1">{LINK_KIND_LABELS[d.kind]}</Badge>{d.received_at ? new Date(d.received_at).toLocaleDateString() : ''}</p>
              </div>
              {canEdit ? <button type="button" onClick={() => void remove(d)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-600" aria-label={`Remove ${d.label}`}><Trash2 className="size-4" aria-hidden="true" /></button> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
