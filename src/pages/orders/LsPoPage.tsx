import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Download, Plus, Printer, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getLsPo, LS_PO_STATUS, lsPoAction, lsPoCsv, type LsPoLine, type LsPoRow } from '@/services/lsPos'
import { ROUTES } from '@/lib/constants'
import { money } from '@/lib/freight'
import { saveBlob } from '@/lib/viewer'
import { cn, errorMessage } from '@/lib/utils'
import { BackLink } from '@/components/shared/BackLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { Alert, Badge, Button, Input, Spinner } from '@/components/ui'

const first = (n: string | null | undefined) => n?.split(' ')[0] ?? ''

/**
 * An LS PO (Dana, Oct 12): Claude's draft from the vendor's confirmation; the person who placed the order approves the
 * quantities and costs; Trevor checks names and categories and sends it to LS; the LS PO number closes it.
 */
export default function LsPoPage() {
  const { id = '' } = useParams()
  const q = useSupabaseQuery(() => getLsPo(id), [id])
  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading the LS PO…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!q.data) return <Alert variant="error">This LS PO was not found.</Alert>
  return <LsPoView key={q.data.updated_at} po={q.data} reload={() => void q.refetch()} />
}

function LsPoView({ po, reload }: { po: LsPoRow; reload: () => void }) {
  const { profile, role } = useAuth()
  const [lines, setLines] = useState<LsPoLine[]>(po.lines)
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(lines) !== JSON.stringify(po.lines)
  const admin = role === 'admin'
  const canApprove = po.status === 'to_approve' && (admin || profile?.id === po.approver_id)
  const canReview = (po.status === 'to_review' || po.status === 'ready') && (admin || profile?.id === po.reviewer_id)
  const editable = po.status === 'to_approve' || po.status === 'to_review' || po.status === 'ready'
  const total = lines.reduce((s, l) => s + l.qty * (l.cost ?? 0), 0)
  const newCount = lines.filter((l) => l.is_new).length

  async function act(action: Parameters<typeof lsPoAction>[1], done: string, num?: string) {
    setBusy(true)
    setError(null)
    try {
      await lsPoAction(po.id, action, dirty ? lines : null, num)
      toast.success(done)
      reload()
    } catch (e) {
      setError(errorMessage(e))
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  function save(e: FormEvent) { e.preventDefault(); void act('save', 'Changes saved') }
  const set = (i: number, patch: Partial<LsPoLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  function download() {
    saveBlob(new Blob([lsPoCsv({ ...po, lines })], { type: 'text/csv' }), `LS PO ${po.vendor?.name ?? ''} ${po.order?.po_number ?? ''}.csv`.replace(/\s+/g, ' ').trim())
  }

  const steps = [
    { label: 'Drafted by Claude', done: po.status !== 'drafting' },
    { label: po.approved_at ? `Approved by ${first(po.approver?.full_name)}` : `Approve: ${po.approver?.full_name ?? 'the person who placed it'}`, done: !!po.approved_at },
    { label: po.reviewed_at ? `Reviewed by ${first(po.reviewer?.full_name)}` : `Review: ${po.reviewer?.full_name ?? 'the LS PO reviewer'}`, done: !!po.reviewed_at },
    { label: po.ls_po_number ? `In LS: PO ${po.ls_po_number}` : 'In LS', done: po.status === 'sent' },
  ]

  return (
    <form onSubmit={save} className="pb-4">
      <BackLink fallback={po.order ? `${ROUTES.orders}/${po.order.id}` : ROUTES.orders} fallbackLabel="Order" />
      <PageHeader eyebrow="LS PO" title={po.vendor?.name ?? 'LS PO'}
        description={<span>{po.order ? <Link to={`${ROUTES.orders}/${po.order.id}`} className="text-brand hover:underline">{[po.order.po_number ? `PO ${po.order.po_number}` : null, po.order.description].filter(Boolean).join(' · ') || 'The order'}</Link> : null}{po.store_code ? ` · ${po.store_code}` : ''}</span>}
        actions={<Badge tone={po.status === 'sent' ? 'success' : 'warning'}>{LS_PO_STATUS[po.status].label}</Badge>} />

      <ol className="mb-4 flex flex-wrap gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={i} className={cn('flex items-center gap-1 rounded-full px-3 py-1', s.done ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600')}>
            {s.done ? <Check className="size-3.5" aria-hidden="true" /> : <span className="font-semibold">{i + 1}</span>} {s.label}
          </li>
        ))}
      </ol>

      {po.status === 'drafting' ? (
        <Alert variant="info">{po.draft_error ? `Claude could not draft it yet (${po.draft_error}). It tries again in about half an hour, or click Redraft.` : 'Claude is drafting this PO from the vendor\'s confirmation. It takes a minute or two.'} <button type="button" onClick={reload} className="font-medium underline">Refresh</button></Alert>
      ) : null}
      {po.draft_note ? <p className="mb-3 text-sm text-stone-600">{po.draft_note}</p> : null}

      {po.status !== 'drafting' ? (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Vendor ID</th>
                <th className="px-3 py-2">LS name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 align-top">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {editable ? <Input aria-label="Vendor ID" value={l.vid ?? ''} onChange={(e) => set(i, { vid: e.target.value || null })} className="h-9 w-28" /> : l.vid ?? '—'}
                    <span className={cn('mt-1 block text-[11px] font-semibold', l.is_new ? 'text-amber-700' : 'text-emerald-700')}>{l.is_new ? 'New to LS' : `In LS${l.system_id ? ` · ${l.system_id}` : ''}`}</span>
                  </td>
                  <td className="min-w-64 px-3 py-2">
                    {editable ? <Input aria-label="LS name" value={l.name} onChange={(e) => set(i, { name: e.target.value })} className="h-9" /> : l.name}
                    {l.desc && l.desc !== l.name ? <span className="mt-1 block text-xs text-stone-500">Vendor: {l.desc}</span> : null}
                    {l.note ? <span className="mt-0.5 block text-xs text-amber-700">{l.note}</span> : null}
                  </td>
                  <td className="min-w-48 px-3 py-2">{editable ? <Input aria-label="Category" value={l.category} onChange={(e) => set(i, { category: e.target.value })} className="h-9" /> : l.category}</td>
                  <td className="px-3 py-2 text-right">{editable ? <Input aria-label="Quantity" type="number" min={0} value={String(l.qty)} onChange={(e) => set(i, { qty: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="h-9 w-20 text-right" /> : l.qty}</td>
                  <td className="px-3 py-2 text-right">{editable ? <Input aria-label="Unit cost" inputMode="decimal" value={l.cost === null ? '' : String(l.cost)} onChange={(e) => set(i, { cost: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) })} className="h-9 w-24 text-right" /> : l.cost !== null ? money(l.cost) : ''}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{l.cost !== null ? money(l.qty * l.cost) : ''}</td>
                  <td className="px-3 py-2">{editable ? <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`} className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-700"><Trash2 className="size-4" aria-hidden="true" /></button> : null}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-stone-50 font-semibold">
                <td className="px-3 py-2" colSpan={3}>{lines.length} items{newCount ? `, ${newCount} new to LS` : ''}</td>
                <td className="px-3 py-2 text-right">{lines.reduce((s, l) => s + l.qty, 0)}</td>
                <td />
                <td className="px-3 py-2 text-right">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {editable ? (
            <div className="border-t border-stone-100 px-3 py-2">
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { vid: null, upc: null, desc: '', qty: 1, cost: null, system_id: null, name: '', category: '', is_new: true, note: null }])} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add an item</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canApprove ? <Button disabled={busy} onClick={() => void act('approve', `Approved: on to ${first(po.reviewer?.full_name) || 'the reviewer'}`)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Approve</Button> : null}
        {po.status === 'to_approve' && !canApprove ? <p className="text-sm text-stone-600">Waiting for {po.approver?.full_name ?? 'the person who placed the order'} to approve.</p> : null}
        {po.status === 'to_review' && canReview ? <Button disabled={busy} onClick={() => void act('send', 'Ready to enter in LS')} leftIcon={<Send className="size-4" aria-hidden="true" />}>Send to LS</Button> : null}
        {po.status === 'to_review' && !canReview ? <p className="text-sm text-stone-600">Waiting for {po.reviewer?.full_name ?? 'the LS PO reviewer'} to review.</p> : null}
        {(po.status === 'to_review' || po.status === 'ready') && canReview ? <Button variant="ghost" disabled={busy} onClick={() => void act('back', 'Sent back for approval')} leftIcon={<Undo2 className="size-4" aria-hidden="true" />}>Send back to {first(po.approver?.full_name) || 'the orderer'}</Button> : null}
        {po.status !== 'sent' && po.status !== 'drafting' ? <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm('Have Claude draft it again from the latest confirmation? Changes made here are replaced.')) void act('redraft', 'Claude is drafting it again') }} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>Redraft</Button> : null}
        {po.status === 'drafting' && po.draft_error ? <Button variant="ghost" disabled={busy} onClick={() => void act('redraft', 'Claude is drafting it again')} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>Redraft</Button> : null}
      </div>

      {po.status === 'ready' || (po.status === 'to_review' && canReview) ? (
        <section className="mt-4 rounded-2xl border border-brand/30 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Enter it in LS</h2>
          <p className="mt-1 text-sm text-stone-600">Until VMS is connected to LS: download or print this PO, create it in LS, then type the LS PO number here.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={download} leftIcon={<Download className="size-4" aria-hidden="true" />}>Download for LS</Button>
            <Button size="sm" variant="secondary" onClick={() => window.print()} leftIcon={<Printer className="size-4" aria-hidden="true" />}>Print</Button>
            {canReview ? (
              <>
                <Input aria-label="LS PO number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="LS PO number" className="h-9 w-40" />
                <Button size="sm" disabled={busy || !number.trim()} onClick={() => void act('done', 'LS PO number saved on the order', number)}>Done</Button>
              </>
            ) : <p className="text-sm text-stone-600">{po.reviewer?.full_name ?? 'The reviewer'} enters it in LS.</p>}
          </div>
        </section>
      ) : null}

      {po.status === 'sent' ? <p className="mt-4 text-sm text-emerald-800">In LS as PO {po.ls_po_number}{po.sent_at ? ` (${new Date(po.sent_at).toLocaleDateString()})` : ''}.</p> : null}
      {dirty ? <div className="mt-4"><StickySaveBar saving={busy} error={error} onCancel={() => setLines(po.lines)} /></div> : null}
    </form>
  )
}
