import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Download, Eye, Send } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { downloadCountFile, getInventoryCount, saveCountLine, sendCountToLs, type InventoryCountLine } from '@/services/inventoryCounts'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { Modal } from '@/components/shared/Modal'
import { Alert, Badge, Button, FormField, Input, Spinner } from '@/components/ui'

/**
 * A checklist's counts (Dana, Oct 16): the employee types the numbers from the paper sheet (Floor, Back stock, Bins;
 * Total adds itself, or type Total alone). Someone with the Send counts to LS tick sends them: VMS makes an Inventory
 * Count in Lightspeed with those totals; Dana reconciles in LS.
 */
export default function InventoryCountPage() {
  const { id = '' } = useParams()
  const { profile, role } = useAuth()
  const { view, viewer } = useDocumentViewer()
  const [tick, setTick] = useState(0)
  const q = useSupabaseQuery(() => getInventoryCount(id), [id, tick])
  const canEnter = !!profile && (profile.enters_counts || role === 'admin')
  const canSend = !!profile && (profile.sends_counts || role === 'admin')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const count = q.data?.count
  const lines = useMemo(() => q.data?.lines ?? [], [q.data])
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? lines.filter((l) => `${l.description} ${l.vendor_item_id} ${l.system_sku} ${l.upc} ${l.category_path}`.toLowerCase().includes(s)) : lines
  }, [lines, search])
  const counted = lines.filter((l) => l.total != null).length
  const open = count?.status === 'open'

  async function send() {
    if (!count) return
    setSending(true)
    try {
      const r = await sendCountToLs(count.id, name ?? count.ls_count_name)
      toast.success(`Sent to Lightspeed as “${r.name}”: ${r.sent} items${r.failed.length ? `, ${r.failed.length} could not be added` : ''}`)
      if (r.failed.length) toast.error(r.failed.slice(0, 3).join(' · '))
      setName(null)
      setTick((t) => t + 1)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  if (q.isLoading) return <Spinner label="Loading…" className="text-brand" />
  if (!count) return <Alert variant="error">Checklist not found.</Alert>
  return (
    <div className="space-y-4">
      <BackLink fallback={ROUTES.salesReports} fallbackLabel="Sales Reports" />
      <PageHeader title={count.title} description={`${count.store_code} · ${lines.length} items · ${counted} counted${count.status === 'sent' ? ` · sent to Lightspeed ${new Date(count.sent_at!).toLocaleString()} as “${count.ls_count_name}” (${count.sent_items} items)` : ''}`}
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => view({ name: count.file_name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', load: () => downloadCountFile(count) })}><Eye className="size-4" aria-hidden="true" />Open the sheet</Button>
            <Button variant="ghost" size="sm" onClick={() => void downloadCountFile(count).then((b) => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = count.file_name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10_000) }).catch((e) => toast.error(errorMessage(e)))}><Download className="size-4" aria-hidden="true" />Download</Button>
            {open && canSend ? <Button size="sm" onClick={() => setName(count.ls_count_name)} disabled={!counted}><Send className="size-4" aria-hidden="true" />Send to LS</Button> : null}
          </span>
        } />
      {count.status === 'sent' ? <Alert variant="success">Sent to Lightspeed. Open Inventory Counts in LS to see what is missing and reconcile there. The numbers here are now read-only.</Alert>
        : !canEnter ? <Alert variant="info">You can look at the checklist. Entering counts needs the "Enter inventory counts" tick (Settings → Users).</Alert>
        : <p className="text-sm text-stone-600">Type the numbers from the paper sheet. Total adds Floor, Back stock and Bins on its own; typing Total alone is fine. Each number saves when you leave the box.</p>}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an item: description, Vendor ID, UPC" className="max-w-md" aria-label="Find an item" />
      <section className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Description</th>
              <th className="hidden px-3 py-2 md:table-cell">Vendor ID</th>
              <th className="hidden px-3 py-2 lg:table-cell">Category</th>
              <th className="px-3 py-2 text-center">In stock</th>
              <th className="px-2 py-2 text-center" style={{ background: '#FBE3D6' }}>Floor</th>
              <th className="px-2 py-2 text-center" style={{ background: '#BDD7EE' }}>Back stock</th>
              <th className="px-2 py-2 text-center" style={{ background: '#DCEDD5' }}>Bins</th>
              <th className="px-2 py-2 text-center" style={{ background: '#FFFF00' }}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((l) => <CountRow key={l.id} line={l} editable={!!open && canEnter} userId={profile?.id ?? ''} />)}
          </tbody>
        </table>
        {!shown.length ? <p className="px-4 py-3 text-sm text-stone-500">No item matches.</p> : null}
      </section>
      {viewer}
      {name !== null ? (
        <Modal title="Send the counts to Lightspeed" submitLabel={sending ? 'Sending…' : 'Send to LS'} busy={sending} onSubmit={send} onClose={() => setName(null)}>
          <p className="text-sm text-stone-600">VMS creates a new Inventory Count in Lightspeed for {count.store_code} with the {counted} totals entered. Items with no total are left out. Reconcile in Lightspeed when you are ready; nothing changes in LS until then.</p>
          <FormField label="Name of the count in Lightspeed" htmlFor="c-name" hint="The checklist's name by default; change it for an unusual case."><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        </Modal>
      ) : null}
    </div>
  )
}

function CountRow({ line, editable, userId }: { line: InventoryCountLine; editable: boolean; userId: string }) {
  const [v, setV] = useState({ floor: line.floor, back_stock: line.back_stock, bins: line.bins, total: line.total })
  const [saving, setSaving] = useState(false)
  const num = (s: string) => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Math.max(0, Math.round(Number(s))) : null)
  const sumParts = (x: typeof v) => (x.floor == null && x.back_stock == null && x.bins == null ? null : (x.floor ?? 0) + (x.back_stock ?? 0) + (x.bins ?? 0))
  async function save(next: typeof v) {
    setSaving(true)
    try { await saveCountLine(line.id, next, userId) } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }
  const change = (k: 'floor' | 'back_stock' | 'bins' | 'total', s: string) => {
    const next = { ...v, [k]: num(s) }
    if (k !== 'total') next.total = sumParts(next) ?? next.total
    setV(next)
  }
  const box = (k: 'floor' | 'back_stock' | 'bins' | 'total', bg: string) => (
    <td className="px-1 py-1 text-center" style={{ background: bg }}>
      {editable ? <input inputMode="numeric" value={v[k] ?? ''} onChange={(e) => change(k, e.target.value)} onBlur={() => void save(v)} className={cn('w-16 rounded-md border border-stone-300 bg-white px-1 py-1 text-center text-sm', k === 'total' && 'font-semibold')} aria-label={`${k} for ${line.description}`} />
        : <span className={cn(k === 'total' && 'font-semibold')}>{v[k] ?? ''}</span>}
    </td>
  )
  return (
    <tr className={saving ? 'opacity-70' : ''}>
      <td className="px-3 py-1.5 text-stone-900">{line.description}{v.total != null && v.total !== line.in_stock ? <Badge tone={v.total < line.in_stock ? 'warning' : 'info'} className="ml-2">{v.total - line.in_stock > 0 ? '+' : ''}{v.total - line.in_stock}</Badge> : null}</td>
      <td className="hidden px-3 py-1.5 text-stone-600 md:table-cell">{line.vendor_item_id}</td>
      <td className="hidden px-3 py-1.5 text-xs text-stone-500 lg:table-cell">{line.category_path}</td>
      <td className="px-3 py-1.5 text-center text-stone-700">{line.in_stock}</td>
      {box('floor', '#FBE3D633')}
      {box('back_stock', '#BDD7EE33')}
      {box('bins', '#DCEDD533')}
      {box('total', '#FFFF0033')}
    </tr>
  )
}
