import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { FileUp, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { uploadFreightBill, type UploadedBillResult } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { Badge, Button } from '@/components/ui'

const LABEL: Record<UploadedBillResult['result'], { text: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'danger' }> = {
  new: { text: 'New bill', tone: 'success' },
  filled: { text: 'Filled the waiting bill', tone: 'info' },
  duplicate: { text: 'Already on file, skipped', tone: 'neutral' },
  no_carrier: { text: 'Pick the billing company', tone: 'warning' },
  failed: { text: 'Could not read', tone: 'danger' },
}

/**
 * Upload a batch of freight bill PDFs (Dana, Oct 9: catching up on 2026). Claude reads each; our UPS number on
 * it decides the billing company; a bill already waiting for its PDF is filled; copies are skipped.
 */
export function BulkBillUpload({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<unknown> }) {
  const { organization } = useAuth()
  const [rows, setRows] = useState<(UploadedBillResult & { pending?: boolean })[]>([])
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function run(files: File[]) {
    if (!organization) return
    const pdfs = files.filter((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name))
    if (!pdfs.length) return
    setBusy(true)
    setRows((r) => [...pdfs.map((f) => ({ file: f.name, result: 'new' as const, billId: null, pending: true })), ...r])
    let i = 0
    // Two at a time: each takes Claude a few seconds.
    await Promise.all([0, 1].map(async () => {
      while (i < pdfs.length) {
        const f = pdfs[i++]!
        let out: UploadedBillResult
        try { out = await uploadFreightBill(organization.id, f) } catch (err) { out = { file: f.name, result: 'failed', billId: null, note: errorMessage(err) } }
        setRows((r) => r.map((x) => (x.pending && x.file === f.name ? out : x)))
      }
    }))
    setBusy(false)
    await onDone()
  }

  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]) }
  const done = rows.filter((r) => !r.pending)
  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">Upload freight bills</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1 text-stone-400 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn('mt-3 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm', over ? 'border-brand bg-brand/5' : 'border-stone-300')}>
        <FileUp className="size-8 text-stone-400" aria-hidden="true" />
        <p className="text-stone-700">Drop bill PDFs here: PartnerShip, UPS DIRECT, WWD, Worldwide Express…</p>
        <p className="text-xs text-stone-500">Claude reads each one. Our UPS number on the bill picks the billing company; bills already in VMS are skipped.</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>Choose PDFs</Button>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void run(f) }} />
      </div>
      {rows.length ? (
        <>
          <p className="mt-3 text-xs text-stone-500">{busy ? `Reading… ${done.length} of ${rows.length}` : `${rows.length} done`}</p>
          <ul className="mt-1 divide-y divide-stone-100 text-sm">
            {rows.map((r, k) => (
              <li key={`${r.file}-${k}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-stone-800">{r.file}</span>
                {r.pending ? <span className="text-xs text-stone-500">Reading…</span> : (
                  <span className="flex items-center gap-2">
                    <Badge tone={LABEL[r.result].tone}>{LABEL[r.result].text}</Badge>
                    {r.billId && r.result !== 'failed' ? <Link to={`${ROUTES.freight}/${r.billId}`} className="text-xs text-brand hover:underline">Open</Link> : null}
                    {r.note && r.result === 'failed' ? <span className="text-xs text-red-700">{r.note}</span> : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
