import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, CircleCheck, ExternalLink, FileText } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getPayBill, markTaskPaid, savePayLinks, type TaskRow } from '@/services/tasks'
import { taskTarget } from '@/lib/tasks'
import { fetchAttachment, listEdenredUnplaced, fileAttachmentToVendor, type UnplacedFile } from '@/services/mail'
import { kickOrderChecks } from '@/services/orderChecks'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { money as formatCurrency } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { Button, Input } from '@/components/ui'

/** The top of the task box (Dana, Oct 14: "something there that I can click on that takes me to what I need to do"). */
export function TaskGo({ task, onGo }: { task: TaskRow; onGo: () => void }) {
  const navigate = useNavigate()
  const target = taskTarget(task)
  if (!target) return null
  if (target.kind === 'pay') return <PayPanel task={task} bill={target.bill} id={target.id} onDone={onGo} />
  const go = (
    <Button className="w-full sm:w-auto" onClick={() => { onGo(); navigate(target.to) }}>
      Go to it: {target.label}<ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
    </Button>
  )
  // Edenred files VMS couldn't place (Dana, Nov 7: "Why can't I just make this a vendor from this screen? I know what it is."):
  // the files right here, each with Open and File to a vendor (+ Add new vendor); the task closes when the last one is filed
  const [kind, id] = (task.auto_key ?? '').split(':')
  if (kind === 'edenred' && id && !task.done_at) return <div className="space-y-3">{go}<EdenredFilesPanel emailId={id} onAllFiled={onGo} /></div>
  return go
}

function EdenredFilesPanel({ emailId, onAllFiled }: { emailId: string; onAllFiled: () => void }) {
  const q = useSupabaseQuery(() => listEdenredUnplaced(emailId), [emailId])
  const { view, viewer } = useDocumentViewer()
  const [credit, setCredit] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const files = q.data ?? []

  async function file(f: UnplacedFile, vendor: { id: string; name: string }) {
    setBusy(f.id)
    try {
      await fileAttachmentToVendor(f.id, vendor.id, credit[f.id] ? 'credit' : 'invoice')
      kickOrderChecks()
      const left = await listEdenredUnplaced(emailId)
      await q.refetch()
      if (!left.length) { toast.success(`Filed to ${vendor.name}. Every file is placed, so the task is done.`); onAllFiled() }
      else toast.success(`Filed to ${vendor.name}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (q.isLoading) return <p className="text-sm text-stone-500">Loading the files…</p>
  if (!files.length) return <p className="text-sm text-emerald-700">Every file in this email is placed.</p>
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
      <p className="font-semibold text-stone-900">{files.length === 1 ? 'The file VMS couldn\'t place' : `The ${files.length} files VMS couldn't place`}</p>
      <ul className="mt-2 space-y-3">
        {files.map((f) => (
          <li key={f.id} className="rounded-lg bg-white p-2 ring-1 ring-stone-200">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!f.gmail_attachment_id} onClick={() => view({ name: f.file_name, mime: f.mime_type, load: () => fetchAttachment(f.id) })}
                className="inline-flex items-center gap-1 font-medium text-brand hover:underline disabled:text-stone-500 disabled:no-underline">
                <FileText className="size-4" aria-hidden="true" />Open {f.file_name}
              </button>
              <label className="ml-auto inline-flex items-center gap-1 text-xs text-stone-600">
                <input type="checkbox" checked={!!credit[f.id]} onChange={(e) => setCredit((x) => ({ ...x, [f.id]: e.target.checked }))} className="size-4 rounded border-stone-300" />It's a credit
              </label>
            </div>
            <p className="mt-2 text-xs font-medium text-stone-600">File to a vendor</p>
            {busy === f.id ? <p className="mt-1 text-stone-500">Filing…</p>
              : <VendorPicker className="mt-1" placeholder="Type the vendor, or + Add new vendor" onPick={(v) => file(f, v)} />}
          </li>
        ))}
      </ul>
      {viewer}
    </section>
  )
}

/** A pay-by task: the bill, the pay page (the WWD portal for WWD, else Bill.com), and "I paid it". VMS never pays anything itself.
 * WWD bills are paid in the WWD portal, not Edenred (Dana, Oct 19); its address is kept in organizations.edenred_url. */
function PayPanel({ task, bill, id, onDone }: { task: TaskRow; bill: 'wwd' | 'order' | 'billcom'; id: string; onDone: () => void }) {
  const { organization, role, refreshProfile } = useAuth()
  const q = useSupabaseQuery(() => getPayBill(bill, id), [bill, id])
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const admin = role === 'admin'
  const b = q.data
  const payUrl = b?.via === 'billcom' ? organization?.billcom_url || 'https://app.bill.com' : organization?.edenred_url ?? null
  const payName = b?.via === 'billcom' ? 'Bill.com' : 'the WWD portal'

  async function paid() {
    setBusy(true)
    try {
      await markTaskPaid(task.id)
      toast.success('Marked paid; the task is done')
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function saveUrl() {
    if (!organization) return
    try {
      await savePayLinks(organization.id, url.trim(), null)
      toast.success('Saved')
      setUrl('')
      await refreshProfile()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <section className="rounded-xl border border-brand/30 bg-brand/5 p-3 text-sm">
      {q.isLoading ? <p className="text-stone-500">Loading the bill…</p> : !b ? <p className="text-stone-600">The bill is no longer in VMS.</p> : (
        <>
          <p className="font-semibold text-stone-900">{b.vendor ?? 'Bill'}{b.number ? ` · invoice ${b.number}` : ''}{b.po ? ` · PO ${b.po}` : ''}</p>
          <p className="mt-0.5 text-stone-700">
            {b.amount !== null ? formatCurrency(b.amount) : 'Amount not on file'}
            {b.terms ? ` · ${b.terms}` : ''}{b.due ? ` · due ${new Date(`${b.due}T12:00:00`).toLocaleDateString()}` : ''}
          </p>
          {b.order_id ? <Link to={`/orders/${b.order_id}`} onClick={onDone} className="mt-1 inline-block text-xs font-medium text-brand hover:underline">Open the order</Link> : null}
          {b.paid ? <p className="mt-2 font-medium text-emerald-700">Already paid.</p> : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {payUrl ? (
                <a href={payUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">
                  Pay in {payName}<ExternalLink className="size-4" aria-hidden="true" />
                </a>
              ) : admin ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Input aria-label="WWD portal pay page address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste your WWD portal pay page address once" className="h-9 w-72" />
                  <Button size="sm" variant="secondary" disabled={!/^https:\/\//i.test(url.trim())} onClick={() => void saveUrl()}>Save</Button>
                </span>
              ) : <span className="text-stone-600">Pay in {payName}.</span>}
              {admin ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void paid()} leftIcon={<CircleCheck className="size-4" aria-hidden="true" />}>I paid it</Button> : null}
            </div>
          )}
        </>
      )}
    </section>
  )
}
