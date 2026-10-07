import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ExternalLink, FileText, Link2, Mail, Plus, Trash2, Upload } from 'lucide-react'
import { addVendorLink, deleteVendorLink, listVendorLinks, signedFileUrl, uploadVendorFile, type VendorLinkRow } from '@/services/lines'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { LINK_KIND_LABELS } from '@/lib/vendors'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { VendorLink, VendorLinkKind } from '@/types'
import { Badge, Button, FormField, Input, Select, Textarea } from '@/components/ui'

const KINDS = Object.keys(LINK_KIND_LABELS) as VendorLinkKind[]
const MAX_MB = 25

/** Catalogs, price lists and order forms: paste a link or upload the PDF the rep emailed. Older ones stay as history. */
export function VendorLinksSection({ vendorId, organizationId, userId, canEdit }: { vendorId: string; organizationId: string; userId: string | null; canEdit: boolean }) {
  const q = useSupabaseQuery(() => listVendorLinks(vendorId), [vendorId])
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'link' | 'file'>('link')
  const [form, setForm] = useState({ kind: 'catalog' as VendorLinkKind, label: '', url: '', season_label: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const label = form.label.trim() || [form.season_label.trim(), LINK_KIND_LABELS[form.kind].toLowerCase()].filter(Boolean).join(' ') || LINK_KIND_LABELS[form.kind]
      if (mode === 'file') {
        if (!file) throw new Error('Choose a file first')
        if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Files up to ${MAX_MB} MB`)
        const path = await uploadVendorFile(organizationId, vendorId, file)
        await addVendorLink({ organization_id: organizationId, vendor_id: vendorId, kind: form.kind, label, storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || null, season_label: form.season_label.trim() || null, notes: form.notes.trim() || null, received_at: new Date().toISOString().slice(0, 10), created_by: userId })
      } else {
        const url = form.url.trim()
        if (!url) throw new Error('Paste a link first')
        await addVendorLink({ organization_id: organizationId, vendor_id: vendorId, kind: form.kind, label, url: /^https?:\/\//i.test(url) ? url : `https://${url}`, season_label: form.season_label.trim() || null, notes: form.notes.trim() || null, received_at: new Date().toISOString().slice(0, 10), created_by: userId })
      }
      setForm({ kind: 'catalog', label: '', url: '', season_label: '', notes: '' })
      setFile(null)
      setAdding(false)
      toast.success(mode === 'file' ? 'File uploaded' : 'Link added')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function open(link: VendorLink) {
    try {
      if (link.storage_path) window.open(await signedFileUrl(link.storage_path), '_blank', 'noopener')
      else if (link.url) window.open(link.url, '_blank', 'noopener')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function remove(link: VendorLink) {
    if (!window.confirm(`Remove "${link.label}"?`)) return
    try {
      await deleteVendorLink(link)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const links = q.data ?? []
  const current = links.filter((l) => l.is_current)
  const older = links.filter((l) => !l.is_current)
  const row = (l: VendorLinkRow) => (
    <li key={l.id} className={`flex items-center gap-3 py-2 ${l.is_current ? '' : 'opacity-70'}`}>
      {l.storage_path ? <FileText className="size-5 shrink-0 text-stone-400" aria-hidden="true" /> : <ExternalLink className="size-5 shrink-0 text-stone-400" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => void open(l)} className="truncate text-left text-sm font-medium text-stone-900 hover:text-brand">{l.label}</button>
        <p className="truncate text-xs text-stone-500">
          <Badge tone="neutral" className="mr-1">{LINK_KIND_LABELS[l.kind]}</Badge>
          {l.season_label ? `${l.season_label} · ` : ''}{l.file_name ?? l.url?.replace(/^https?:\/\//, '')}{l.received_at ? ` · ${new Date(`${l.received_at}T12:00:00`).toLocaleDateString()}` : ''}
          {l.email ? <> · <Link to={`${ROUTES.mail}/${l.email.thread_id}`} className="inline-flex items-center gap-0.5 text-brand hover:underline"><Mail className="inline size-3" aria-hidden="true" />from an email</Link></> : null}
        </p>
        {l.notes && !l.email ? <p className="mt-0.5 text-xs text-stone-600">{l.notes}</p> : null}
      </div>
      {canEdit ? <button type="button" onClick={() => void remove(l)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-600" aria-label={`Remove ${l.label}`}><Trash2 className="size-4" aria-hidden="true" /></button> : null}
    </li>
  )
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Catalogs, price lists &amp; files</h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add</Button> : null}
      </div>
      {adding ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-2">
          <div className="flex gap-1 rounded-lg bg-white p-1 sm:col-span-2" role="group" aria-label="Link or file">
            <button type="button" onClick={() => setMode('link')} className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === 'link' ? 'bg-stone-900 text-white' : 'text-stone-600'}`}><Link2 className="mr-1 inline size-4" aria-hidden="true" />Paste a link</button>
            <button type="button" onClick={() => setMode('file')} className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === 'file' ? 'bg-stone-900 text-white' : 'text-stone-600'}`}><Upload className="mr-1 inline size-4" aria-hidden="true" />Upload a file</button>
          </div>
          <FormField label="Type" htmlFor="lk-kind">
            <Select id="lk-kind" value={form.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{LINK_KIND_LABELS[k]}</option>)}</Select>
          </FormField>
          <FormField label="Season or year" htmlFor="lk-season" hint="e.g. Fall 2026"><Input id="lk-season" value={form.season_label} onChange={(e) => set('season_label', e.target.value)} placeholder="Fall 2026" /></FormField>
          {mode === 'link' ? (
            <FormField label="Link" htmlFor="lk-url" className="sm:col-span-2"><Input id="lk-url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" required /></FormField>
          ) : (
            <FormField label={`File (PDF, image or spreadsheet, up to ${MAX_MB} MB)`} htmlFor="lk-file" className="sm:col-span-2">
              <input id="lk-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-200 file:px-3 file:py-2 file:text-sm file:font-medium" required />
            </FormField>
          )}
          <FormField label="Label (optional)" htmlFor="lk-label"><Input id="lk-label" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Fall 2026 price list" /></FormField>
          <FormField label="Notes (optional)" htmlFor="lk-notes"><Textarea id="lk-notes" rows={1} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={saving}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {links.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">Nothing yet. Paste the catalog link from the rep's email or upload the PDF. Price lists, catalogs and order forms that arrive by email file here on their own once the sender is known.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-stone-100">{current.map(row)}</ul>
          {older.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-stone-500">Older ({older.length}): kept as history</summary>
              <ul className="divide-y divide-stone-100">{older.map(row)}</ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}
