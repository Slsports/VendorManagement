import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Building2, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { importWwd, previewWwd, readWwdFile, type WwdFileRead, type WwdImportResult, type WwdPreview } from '@/services/wwd'
import { mergeBatches } from '@/lib/wwdFiles'
import { errorMessage } from '@/lib/utils'
import { Badge, Button } from '@/components/ui'

const KIND_LABELS = { history: 'Payment History', edenred: 'EdenRed invoices', sheet: 'Payment sheet', scan: 'Scanned sheet (read by Claude)' } as const

/**
 * WWD payments (Dana, Oct 9): drop in any mix of Worldwide's Payment History export, the EdenRed invoice
 * export, Dana's pasted payment sheets (Excel or Word) and scans of printed ones. Nothing is saved until
 * "Import"; importing the same file twice adds nothing.
 */
export function WwdImportSection({ onImported }: { onImported: () => void | Promise<void> }) {
  const { organization } = useAuth()
  const [files, setFiles] = useState<WwdFileRead[]>([])
  const [preview, setPreview] = useState<WwdPreview | null>(null)
  const [result, setResult] = useState<WwdImportResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function read(list: File[]) {
    if (!organization || !list.length) return
    setResult(null)
    const out: WwdFileRead[] = [...files]
    try {
      for (const [i, f] of list.entries()) {
        setBusy(`Reading ${i + 1} of ${list.length}: ${f.name}${/\.(pdf|png|jpe?g)$/i.test(f.name) ? ' (Claude is reading the scan, about a minute)' : ''}`)
        out.push(await readWwdFile(f, organization.id))
        setFiles([...out])
      }
      setBusy('Checking against VMS…')
      setPreview(await previewWwd(mergeBatches(out.map((f) => f.batch))))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function doImport() {
    setBusy('Importing…')
    try {
      const r = await importWwd(mergeBatches(files.map((f) => f.batch)), (done, total) => setBusy(`Importing… ${done} of ${total}`))
      setResult(r)
      setFiles([]); setPreview(null)
      toast.success('WWD import done')
      await onImported()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const unmatched = (preview?.names ?? []).filter((n) => !n.vendor)
  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Building2 className="size-6 text-stone-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-stone-900">Worldwide (WWD) payments</h2>
          <p className="text-sm text-stone-600">Choose any mix of: the Payment History export, the EdenRed invoice export, your payment sheets (Excel or Word) and scans of printed ones.</p>
        </div>
        <Button variant="secondary" loading={!!busy && !preview} disabled={!!busy} onClick={() => input.current?.click()} leftIcon={<Upload className="size-4" aria-hidden="true" />}>{files.length ? 'Add more files' : 'Choose files'}</Button>
        <input ref={input} type="file" multiple accept=".xls,.xlsx,.docx,.pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ''; void read(l) }} />
      </div>
      {busy ? <p className="mt-3 text-sm text-stone-600" role="status">{busy}</p> : null}

      {files.length ? (
        <ul className="mt-3 divide-y divide-stone-100 rounded-xl border border-stone-100 text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0 truncate text-stone-800">{f.name}</span>
              {f.error ? <span className="text-xs text-red-700">{f.error}</span> : (
                <span className="flex items-center gap-2 text-xs text-stone-500">
                  <Badge tone="info">{f.kind ? KIND_LABELS[f.kind] : '?'}</Badge>
                  {f.batch.payments.length ? `${f.batch.payments.length} payments · ${f.batch.lines.length} lines` : `${f.batch.invoices.length} invoices`}
                  {f.kind === 'sheet' || f.kind === 'scan' ? ` · paid ${f.batch.invoices[0]?.sheet_paid_date ?? 'date not found'}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span><span className="font-semibold">{preview.invoices}</span> WWD invoices ({preview.invoices_new} new)</span>
            <span><span className="font-semibold">{preview.payments}</span> payments ({preview.payments_new} new) · {preview.lines} paid lines</span>
            <span className="text-emerald-700">{preview.names.length - unmatched.length} of {preview.names.length} vendor names found in VMS</span>
            <Button className="ml-auto" loading={busy === 'Importing…' || !!busy?.startsWith('Importing')} disabled={!!busy} onClick={() => void doImport()}>Import</Button>
          </div>
          {unmatched.length ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              Not found yet ({unmatched.length}): {unmatched.slice(0, 12).map((n) => n.name).join(', ')}{unmatched.length > 12 ? '…' : ''}. Import anyway; you pick the vendor for each name once, below.
            </p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Added {result.invoices_new} WWD invoices, {result.payments_new} payments and {result.lines_new} paid lines; {result.orders_paid} orders marked paid. {result.linked_orders} orders now have their WWD invoices. {result.no_vendor ? `${result.no_vendor} invoices have no vendor yet.` : ''}
        </p>
      ) : null}
    </section>
  )
}
