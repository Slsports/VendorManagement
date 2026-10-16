import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { CONTRACT_KINDS, CONTRACT_KIND_LABELS, CONTRACT_STATUS_LABELS, deletePayment, followUpDone, getContract, paymentPaid, saveContract, savePayment, type ContractRow } from '@/services/contracts'
import { listAccountingContacts } from '@/services/accounting'
import { listProcedures } from '@/services/procedures'
import { listPolicies } from '@/services/insurance'
import { listAccountingTasks } from '@/services/tasks'
import { daysUntil, money } from '@/lib/insurance'
import { contactName } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { AccountingContract, AccountingContractPayment } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { Modal } from '@/components/shared/Modal'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { TaskList } from '@/components/tasks/TaskList'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

/** One contract: the facts, the payment schedule with Paid, the follow-up, the renewal procedure, its open tasks. */
export default function ContractPage() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const { organization } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (isNew ? null : getContract(id)), [id])
  const tasks = useTasksQuery(async () => (organization && !isNew ? (await listAccountingTasks(organization.id, { view: 'open' })).filter((t) => t.contract_id === id) : []), [organization?.id, id])
  const policies = useSupabaseQuery(async () => (organization ? listPolicies(organization.id, true) : []), [organization?.id])
  const [editing, setEditing] = useState(isNew)
  const [paying, setPaying] = useState<AccountingContractPayment | null>(null)
  const [editPay, setEditPay] = useState<AccountingContractPayment | 'new' | null>(null)

  if (!isNew && q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!isNew && !q.data) return <Alert variant="error">Contract not found.</Alert>
  if (!organization) return null
  const c = q.data ?? null

  if (editing) {
    return (
      <ContractForm key={c ? `${c.id}:${c.updated_at}` : 'new'} organizationId={organization.id} contract={c}
        onSaved={async (savedId) => { if (isNew) navigate(`${ROUTES.accountingContracts}/${savedId}`, { replace: true }); else { setEditing(false); await q.refetch() } }}
        onCancel={() => (isNew ? navigate(ROUTES.accountingContracts) : setEditing(false))} />
    )
  }
  const days = daysUntil(c!.term_end)

  async function clearFollowUp() {
    try {
      await followUpDone(c!.id)
      toast.success('Follow-up cleared')
      await Promise.all([q.refetch(), tasks.refetch()])
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div>
      <BackLink fallback={ROUTES.accountingContracts} fallbackLabel="Contracts" />
      <PageHeader eyebrow={`${CONTRACT_KIND_LABELS[c!.kind]}${c!.other_party ? ` · ${c!.other_party}` : ''}`} title={c!.label}
        description={c!.term_start || c!.term_end ? `${c!.term_start ? new Date(`${c!.term_start}T00:00:00`).toLocaleDateString() : '?'} to ${c!.term_end ? new Date(`${c!.term_end}T00:00:00`).toLocaleDateString() : '?'}${days != null ? ` (${days < 0 ? `ended ${-days} days ago` : `${days} days left`})` : ''}` : 'No term dates yet'}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Badge tone={c!.status === 'active' ? 'success' : c!.status === 'pending' ? 'warning' : 'neutral'}>{CONTRACT_STATUS_LABELS[c!.status]}</Badge>
          <Button variant="secondary" onClick={() => setEditing(true)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button>
        </div>} />
      {c!.follow_up_on ? (
        <Alert variant="warning" className="mb-4">
          <span className="flex flex-wrap items-center gap-2">
            <span>Follow up by {new Date(`${c!.follow_up_on}T00:00:00`).toLocaleDateString()}: {c!.follow_up_note || 'check where it stands.'}</span>
            <Button size="sm" variant="secondary" onClick={() => void clearFollowUp()} leftIcon={<Check className="size-3.5" aria-hidden="true" />}>Done</Button>
          </span>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact label="Contract #">{c!.contract_number}{c!.prior_numbers.length ? <span className="block text-xs text-stone-500">Formerly {c!.prior_numbers.join(', ')}</span> : null}</Fact>
            <Fact label="Contact">{c!.contact ? <Link to={`${ROUTES.accountingContacts}/${c!.contact.id}`} className="text-brand hover:underline">{contactName(c!.contact)}</Link> : ''}</Fact>
            <Fact label="Who signs">{c!.signer}</Fact>
            <Fact label="Renewal lead time">{c!.renewal_lead_days ? `${Math.round(c!.renewal_lead_days / 30)} months before the term ends` : ''}</Fact>
            <Fact label="Season">{c!.season_open || c!.season_close ? `${c!.season_open || '?'} to ${c!.season_close || '?'}` : ''}</Fact>
            <Fact label="Procedure">{c!.procedure ? <Link to={`${ROUTES.accountingProcedures}/${c!.procedure.id}`} className="text-brand hover:underline">{c!.procedure.title}</Link> : ''}</Fact>
            <Fact label="Insurance required">{c!.insurance_required}{c!.requires_policy_ids.length ? <span className="mt-1 block text-xs text-stone-600">Policies: {c!.requires_policy_ids.map((pid) => (policies.data ?? []).find((p) => p.id === pid)?.label ?? '?').join(', ')}</span> : null}</Fact>
            <Fact label="Notices to">{c!.notices_to}</Fact>
          </dl>
          {c!.notes ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{c!.notes}</p> : null}
        </section>
        <section className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">Open tasks</h2>
          {tasks.isLoading ? <Spinner label="Loading…" className="text-brand" /> : <TaskList tasks={tasks.data ?? []} showWho={false} empty="None. Payment tasks appear 30 days before each due date." />}
        </section>
      </div>
      <section className="mt-6 rounded-2xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">Payments</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditPay('new')}>Add a payment</Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr><th className="px-4 py-2">For</th><th className="px-4 py-2">Due</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2">From</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {c!.payments.map((p) => {
              const d = daysUntil(p.due_on)
              return (
                <tr key={p.id} className={p.paid_on ? 'text-stone-500' : ''}>
                  <td className="px-4 py-2 font-medium text-stone-900">{p.label || '—'}{p.notes ? <span className="block text-xs font-normal text-stone-500">{p.notes}</span> : null}</td>
                  <td className="whitespace-nowrap px-4 py-2">{new Date(`${p.due_on}T00:00:00`).toLocaleDateString()}{!p.paid_on && d != null && d <= 45 ? <Badge tone={d < 0 ? 'danger' : 'warning'} className="ml-2">{d < 0 ? `${-d} days late` : `in ${d} days`}</Badge> : null}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">{money(p.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-2">{p.paid_on ? new Date(`${p.paid_on}T00:00:00`).toLocaleDateString() : <span className="text-stone-400">not yet</span>}</td>
                  <td className="px-4 py-2">{p.paid_from}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <span className="inline-flex gap-2">
                      {!p.paid_on ? <Button size="sm" onClick={() => setPaying(p)}>Paid</Button> : null}
                      <button type="button" onClick={() => setEditPay(p)} className="text-xs text-stone-500 hover:text-stone-900">Edit</button>
                    </span>
                  </td>
                </tr>
              )
            })}
            {!c!.payments.length ? <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-stone-500">No payments on the schedule yet.</td></tr> : null}
          </tbody>
        </table>
      </section>
      {paying ? <PaidDialog payment={paying} onClose={() => setPaying(null)} onDone={async () => { setPaying(null); await Promise.all([q.refetch(), tasks.refetch()]) }} /> : null}
      {editPay ? <PaymentDialog organizationId={organization.id} contractId={c!.id} payment={editPay === 'new' ? null : editPay} onClose={() => setEditPay(null)} onDone={async () => { setEditPay(null); await q.refetch() }} /> : null}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt><dd className="text-stone-800">{children || <span className="text-stone-400">—</span>}</dd></div>
}

function PaidDialog({ payment, onClose, onDone }: { payment: AccountingContractPayment; onClose: () => void; onDone: () => Promise<void> }) {
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState(payment.paid_from)
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    try {
      await paymentPaid(payment.id, on, from)
      toast.success('Marked paid; the task is closed')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Paid: ${payment.label || 'payment'} ${money(payment.amount)}`} submitLabel="Mark paid" busy={busy} onSubmit={submit} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Paid on" htmlFor="pd-on"><Input id="pd-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></FormField>
        <FormField label="From" htmlFor="pd-from" hint="Which account, check number."><Input id="pd-from" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}

function PaymentDialog({ organizationId, contractId, payment, onClose, onDone }: { organizationId: string; contractId: string; payment: AccountingContractPayment | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState(payment?.label ?? '')
  const [due, setDue] = useState(payment?.due_on ?? '')
  const [amount, setAmount] = useState(payment?.amount != null ? String(payment.amount) : '')
  const [paidOn, setPaidOn] = useState(payment?.paid_on ?? '')
  const [paidFrom, setPaidFrom] = useState(payment?.paid_from ?? '')
  const [notes, setNotes] = useState(payment?.notes ?? '')
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!due) { toast.error('When is it due?'); return }
    setBusy(true)
    try {
      await savePayment(organizationId, contractId, payment?.id ?? null, { label: label.trim(), due_on: due, amount: amount ? Number(amount) : null, paid_on: paidOn || null, paid_from: paidFrom, notes })
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!payment || !window.confirm('Remove this payment from the schedule?')) return
    try { await deletePayment(payment.id); await onDone() } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <Modal title={payment ? 'Payment' : 'Add a payment'} submitLabel="Save" busy={busy} onSubmit={submit} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="For" htmlFor="pm-label" hint="2027, Q1, …"><Input id="pm-label" value={label} onChange={(e) => setLabel(e.target.value)} /></FormField>
        <FormField label="Due" htmlFor="pm-due"><Input id="pm-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
        <FormField label="Amount" htmlFor="pm-amount"><Input id="pm-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
        <FormField label="Paid on" htmlFor="pm-paid"><Input id="pm-paid" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></FormField>
      </div>
      <FormField label="Paid from" htmlFor="pm-from"><Input id="pm-from" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} /></FormField>
      <FormField label="Notes" htmlFor="pm-notes"><Textarea id="pm-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      {payment ? <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"><Trash2 className="size-4" aria-hidden="true" /> Remove</button> : null}
    </Modal>
  )
}

function ContractForm({ organizationId, contract, onSaved, onCancel }: { organizationId: string; contract: ContractRow | null; onSaved: (id: string) => Promise<void>; onCancel: () => void }) {
  const contacts = useSupabaseQuery(() => listAccountingContacts(organizationId), [organizationId])
  const procedures = useSupabaseQuery(() => listProcedures(organizationId), [organizationId])
  const policies = useSupabaseQuery(() => listPolicies(organizationId, true), [organizationId])
  const [f, setF] = useState({
    label: contract?.label ?? '', kind: (contract?.kind ?? 'contract') as AccountingContract['kind'], other_party: contract?.other_party ?? '', contact_id: contract?.contact_id ?? '',
    contract_number: contract?.contract_number ?? '', prior: (contract?.prior_numbers ?? []).join(', '), term_start: contract?.term_start ?? '', term_end: contract?.term_end ?? '',
    renewal_lead_months: String(Math.round((contract?.renewal_lead_days ?? 540) / 30)), signer: contract?.signer ?? '', notices_to: contract?.notices_to ?? '', insurance_required: contract?.insurance_required ?? '',
    requires_policy_ids: contract?.requires_policy_ids ?? [], season_open: contract?.season_open ?? '', season_close: contract?.season_close ?? '', status: (contract?.status ?? 'active') as AccountingContract['status'],
    follow_up_on: contract?.follow_up_on ?? '', follow_up_note: contract?.follow_up_note ?? '', procedure_id: contract?.procedure_id ?? '', notes: contract?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.label.trim()) { setError('Give the contract a name'); return }
    setSaving(true)
    setError(null)
    try {
      const id = await saveContract(organizationId, contract?.id ?? null, {
        label: f.label.trim(), kind: f.kind, other_party: f.other_party, contact_id: f.contact_id || null, contract_number: f.contract_number, prior_numbers: f.prior.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean),
        term_start: f.term_start || null, term_end: f.term_end || null, renewal_lead_days: Math.max(0, Math.round(Number(f.renewal_lead_months) || 0) * 30), signer: f.signer, notices_to: f.notices_to,
        insurance_required: f.insurance_required, requires_policy_ids: f.requires_policy_ids, season_open: f.season_open, season_close: f.season_close, status: f.status,
        follow_up_on: f.follow_up_on || null, follow_up_note: f.follow_up_note, procedure_id: f.procedure_id || null, notes: f.notes,
      })
      toast.success('Saved')
      await onSaved(id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="pb-24">
      <BackLink fallback={ROUTES.accountingContracts} fallbackLabel="Contracts" />
      <PageHeader title={contract ? `Edit: ${contract.label}` : 'New contract'} />
      <div className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
        <FormField label="Name" htmlFor="cf-label" hint="SCE license 9.4763 – Shaver Lake Marina"><Input id="cf-label" value={f.label} onChange={(e) => set('label', e.target.value)} /></FormField>
        <FormField label="Kind" htmlFor="cf-kind"><Select id="cf-kind" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{CONTRACT_KINDS.map((k) => <option key={k} value={k}>{CONTRACT_KIND_LABELS[k]}</option>)}</Select></FormField>
        <FormField label="With" htmlFor="cf-party"><Input id="cf-party" value={f.other_party} onChange={(e) => set('other_party', e.target.value)} /></FormField>
        <FormField label="Their contact" htmlFor="cf-contact">
          <Select id="cf-contact" value={f.contact_id} onChange={(e) => set('contact_id', e.target.value)}>
            <option value="">—</option>
            {(contacts.data ?? []).filter((c) => c.status !== 'ignored').map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
          </Select>
        </FormField>
        <FormField label="Contract #" htmlFor="cf-number"><Input id="cf-number" value={f.contract_number} onChange={(e) => set('contract_number', e.target.value)} /></FormField>
        <FormField label="Former numbers" htmlFor="cf-prior" hint="Comma-separated."><Input id="cf-prior" value={f.prior} onChange={(e) => set('prior', e.target.value)} /></FormField>
        <FormField label="Term starts" htmlFor="cf-start"><Input id="cf-start" type="date" value={f.term_start} onChange={(e) => set('term_start', e.target.value)} /></FormField>
        <FormField label="Term ends" htmlFor="cf-end"><Input id="cf-end" type="date" value={f.term_end} onChange={(e) => set('term_end', e.target.value)} /></FormField>
        <FormField label="Start the renewal this many months before it ends" htmlFor="cf-lead"><Input id="cf-lead" type="number" min={0} max={60} value={f.renewal_lead_months} onChange={(e) => set('renewal_lead_months', e.target.value)} /></FormField>
        <FormField label="Who signs" htmlFor="cf-signer"><Input id="cf-signer" value={f.signer} onChange={(e) => set('signer', e.target.value)} /></FormField>
        <FormField label="Insurance they require" htmlFor="cf-ins" className="sm:col-span-2"><Textarea id="cf-ins" rows={2} value={f.insurance_required} onChange={(e) => set('insurance_required', e.target.value)} /></FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-stone-800">Which of our policies they need proof of</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {(policies.data ?? []).filter((p) => p.is_active || f.requires_policy_ids.includes(p.id)).map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-stone-800">
                <input type="checkbox" className="size-4 accent-brand" checked={f.requires_policy_ids.includes(p.id)} onChange={(e) => set('requires_policy_ids', e.target.checked ? [...f.requires_policy_ids, p.id] : f.requires_policy_ids.filter((x) => x !== p.id))} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FormField label="Notices to" htmlFor="cf-notices" className="sm:col-span-2"><Textarea id="cf-notices" rows={2} value={f.notices_to} onChange={(e) => set('notices_to', e.target.value)} /></FormField>
        <FormField label="Season opens" htmlFor="cf-open" hint="April 15, a week before Memorial Day…"><Input id="cf-open" value={f.season_open} onChange={(e) => set('season_open', e.target.value)} /></FormField>
        <FormField label="Season closes" htmlFor="cf-close"><Input id="cf-close" value={f.season_close} onChange={(e) => set('season_close', e.target.value)} /></FormField>
        <FormField label="Status" htmlFor="cf-status">
          <Select id="cf-status" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {(Object.keys(CONTRACT_STATUS_LABELS) as AccountingContract['status'][]).map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>)}
          </Select>
        </FormField>
        <FormField label="Renewal procedure" htmlFor="cf-proc">
          <Select id="cf-proc" value={f.procedure_id} onChange={(e) => set('procedure_id', e.target.value)}>
            <option value="">—</option>
            {(procedures.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </FormField>
        <FormField label="Follow up on" htmlFor="cf-fu" hint="A date to check where something stands; makes a task."><Input id="cf-fu" type="date" value={f.follow_up_on} onChange={(e) => set('follow_up_on', e.target.value)} /></FormField>
        <FormField label="Follow up about" htmlFor="cf-fun"><Input id="cf-fun" value={f.follow_up_note} onChange={(e) => set('follow_up_note', e.target.value)} /></FormField>
        <FormField label="Notes" htmlFor="cf-notes" className="sm:col-span-2"><Textarea id="cf-notes" rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      </div>
      <StickySaveBar saving={saving} onCancel={onCancel} label="Save contract" error={error} />
    </form>
  )
}
