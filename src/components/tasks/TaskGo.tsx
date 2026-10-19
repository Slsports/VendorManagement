import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, CircleCheck, ExternalLink } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getPayBill, markTaskPaid, savePayLinks, type TaskRow } from '@/services/tasks'
import { taskTarget } from '@/lib/tasks'
import { money as formatCurrency } from '@/lib/freight'
import { errorMessage } from '@/lib/utils'
import { Button, Input } from '@/components/ui'

/** The top of the task box (Dana, Oct 14: "something there that I can click on that takes me to what I need to do"). */
export function TaskGo({ task, onGo }: { task: TaskRow; onGo: () => void }) {
  const navigate = useNavigate()
  const target = taskTarget(task)
  if (!target) return null
  if (target.kind === 'pay') return <PayPanel task={task} bill={target.bill} id={target.id} onDone={onGo} />
  return (
    <Button className="w-full sm:w-auto" onClick={() => { onGo(); navigate(target.to) }}>
      Go to it: {target.label}<ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
    </Button>
  )
}

/** A pay-by task: the bill, the pay page (Edenred for WWD, else Bill.com), and "I paid it". VMS never pays anything itself. */
function PayPanel({ task, bill, id, onDone }: { task: TaskRow; bill: 'wwd' | 'order' | 'billcom'; id: string; onDone: () => void }) {
  const { organization, role, refreshProfile } = useAuth()
  const q = useSupabaseQuery(() => getPayBill(bill, id), [bill, id])
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const admin = role === 'admin'
  const b = q.data
  const payUrl = b?.via === 'billcom' ? organization?.billcom_url || 'https://app.bill.com' : organization?.edenred_url ?? null
  const payName = b?.via === 'billcom' ? 'Bill.com' : 'Edenred'

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
                  <Input aria-label="Edenred pay page address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste your Edenred pay page address once" className="h-9 w-72" />
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
