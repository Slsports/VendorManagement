import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CalendarCheck, FileCheck, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTasksQuery } from '@/hooks/useTasksQuery'
import { deleteTerm, getPolicy, policyReceived, policyRenewed, savePolicy, saveTerm, type PolicyRow } from '@/services/insurance'
import { listAccountingContacts } from '@/services/accounting'
import { listAccountingTasks } from '@/services/tasks'
import { COVERAGE_LABELS, COVERAGE_TYPES, coverageLabel, daysUntil, money, termFor } from '@/lib/insurance'
import { contactName } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { AccountingPolicyTerm, CoverageType } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { Modal } from '@/components/shared/Modal'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { TaskList } from '@/components/tasks/TaskList'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

/** One policy: the facts, every year's premium and payment, Renewed and Policy received, its open tasks. */
export default function PolicyPage() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const { organization } = useAuth()
  const navigate = useNavigate()
  const q = useSupabaseQuery(async () => (isNew ? null : getPolicy(id)), [id])
  const tasks = useTasksQuery(async () => (organization && !isNew ? (await listAccountingTasks(organization.id, { view: 'open' })).filter((t) => t.policy_id === id) : []), [organization?.id, id])
  const [editing, setEditing] = useState(isNew)
  const [renewing, setRenewing] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [editTerm, setEditTerm] = useState<AccountingPolicyTerm | 'new' | null>(null)

  if (!isNew && q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!isNew && !q.data) return <Alert variant="error">Policy not found.</Alert>
  if (!organization) return null
  const p = q.data ?? null

  if (editing) {
    return (
      <PolicyForm key={p ? `${p.id}:${p.updated_at}` : 'new'} organizationId={organization.id} policy={p}
        onSaved={async (savedId) => { if (isNew) navigate(`${ROUTES.accountingInsurance}/${savedId}`, { replace: true }); else { setEditing(false); await q.refetch() } }}
        onCancel={() => (isNew ? navigate(ROUTES.accountingInsurance) : setEditing(false))} />
    )
  }
  const days = daysUntil(p!.renewal_date)
  const nextTerm = termFor(p!.renewal_date)

  return (
    <div>
      <BackLink fallback={ROUTES.accountingInsurance} fallbackLabel="Insurance" />
      <PageHeader eyebrow={`${coverageLabel(p!.coverage_type)} · ${p!.carrier}`} title={p!.label}
        description={p!.renewal_date ? `Renews ${new Date(`${p!.renewal_date}T00:00:00`).toLocaleDateString()}${days != null ? ` (${days < 0 ? `${-days} days ago` : days === 0 ? 'today' : `in ${days} days`})` : ''}` : 'No renewal date set'}
        actions={<div className="flex flex-wrap gap-2">
          <Button onClick={() => setRenewing(true)} leftIcon={<CalendarCheck className="size-4" aria-hidden="true" />}>Renewed</Button>
          <Button variant="secondary" onClick={() => setReceiving(true)} leftIcon={<FileCheck className="size-4" aria-hidden="true" />}>Policy received</Button>
          <Button variant="secondary" onClick={() => setEditing(true)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button>
        </div>} />
      {!p!.is_active ? <Alert variant="info" className="mb-4">Retired policy: no renewal tasks are made for it.</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact label="Property">{p!.property}</Fact>
            <Fact label="Covers">{p!.coverage_description}</Fact>
            <Fact label="Policy #">{p!.policy_number}{p!.prior_policy_numbers.length ? <span className="block text-xs text-stone-500">Prior: {p!.prior_policy_numbers.join(', ')}</span> : null}</Fact>
            <Fact label="Limits">{p!.coverage_limits}</Fact>
            <Fact label="Named insured">{p!.named_insured}</Fact>
            <Fact label="Building owner">{p!.building_owner}</Fact>
            <Fact label="Paid by">{p!.paid_by}{p!.autopay ? <Badge tone="info" className="ml-2">Autopay</Badge> : null}</Fact>
            <Fact label="Billed with">{p!.billed_with}</Fact>
            <Fact label="Agent">{p!.agent ? <Link to={`${ROUTES.accountingContacts}/${p!.agent.id}`} className="text-brand hover:underline">{contactName(p!.agent)}</Link> : ''}</Fact>
          </dl>
          {p!.notes ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{p!.notes}</p> : null}
        </section>
        <section className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">Open tasks</h2>
          {tasks.isLoading ? <Spinner label="Loading…" className="text-brand" /> : <TaskList tasks={tasks.data ?? []} showWho={false} empty="None. A renewal task appears 30 days before the date." />}
        </section>
      </div>
      <section className="mt-6 rounded-2xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">Policy years</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditTerm('new')}>Add a year</Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr><th className="px-4 py-2">Year</th><th className="px-4 py-2 text-right">Premium</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2">From</th><th className="px-4 py-2">Paper</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {p!.terms.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 font-medium text-stone-900">{t.term_label}</td>
                <td className="px-4 py-2 text-right text-stone-800">{money(t.premium)}</td>
                <td className="px-4 py-2 text-stone-700">{t.paid_on ? new Date(`${t.paid_on}T00:00:00`).toLocaleDateString() : <span className="text-stone-400">not yet</span>}</td>
                <td className="px-4 py-2 text-stone-700">{t.paid_from}</td>
                <td className="px-4 py-2 text-stone-700">{t.received_at ? `received ${new Date(t.received_at).toLocaleDateString()}` : <span className="text-stone-400">—</span>}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => setEditTerm(t)} className="text-xs text-stone-500 hover:text-stone-900">Edit</button>
                </td>
              </tr>
            ))}
            {!p!.terms.length ? <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-stone-500">No years recorded yet.</td></tr> : null}
          </tbody>
        </table>
      </section>
      {renewing ? <RenewedDialog policy={p!} defaultTerm={nextTerm} onClose={() => setRenewing(false)} onDone={async () => { setRenewing(false); await q.refetch(); await tasks.refetch() }} /> : null}
      {receiving ? <ReceivedDialog policy={p!} defaultTerm={p!.terms[0]?.term_label ?? termFor(p!.renewal_date ? `${Number(p!.renewal_date.slice(0, 4)) - 1}` : null)} onClose={() => setReceiving(false)} onDone={async () => { setReceiving(false); await q.refetch(); await tasks.refetch() }} /> : null}
      {editTerm ? <TermDialog organizationId={organization.id} policyId={p!.id} term={editTerm === 'new' ? null : editTerm} onClose={() => setEditTerm(null)} onDone={async () => { setEditTerm(null); await q.refetch() }} /> : null}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt><dd className="text-stone-800">{children || <span className="text-stone-400">—</span>}</dd></div>
}

function RenewedDialog({ policy, defaultTerm, onClose, onDone }: { policy: PolicyRow; defaultTerm: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [term, setTerm] = useState(defaultTerm)
  const [premium, setPremium] = useState('')
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [paidFrom, setPaidFrom] = useState(policy.paid_by)
  const [newRenewal, setNewRenewal] = useState(policy.renewal_date ? `${Number(policy.renewal_date.slice(0, 4)) + 1}${policy.renewal_date.slice(4)}` : '')
  const [newNumber, setNewNumber] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    try {
      await policyRenewed(policy.id, { term: term.trim(), premium: premium ? Number(premium) : null, paidOn: paidOn || null, paidFrom, newRenewal: newRenewal || null, newNumber: newNumber.trim() || null })
      toast.success('Renewal recorded; the renewal date moved on and the task is closed')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Renewed: ${policy.label}`} submitLabel="Record the renewal" busy={busy} onSubmit={submit} onClose={onClose}>
      <FormField label="Policy year" htmlFor="rn-term"><Input id="rn-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="2027-28" /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Premium" htmlFor="rn-premium"><Input id="rn-premium" type="number" step="0.01" value={premium} onChange={(e) => setPremium(e.target.value)} /></FormField>
        <FormField label="Paid on" htmlFor="rn-paid"><Input id="rn-paid" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></FormField>
      </div>
      <FormField label="Paid from" htmlFor="rn-from" hint="SLS or P&S, and which account."><Input id="rn-from" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Next renewal" htmlFor="rn-next"><Input id="rn-next" type="date" value={newRenewal} onChange={(e) => setNewRenewal(e.target.value)} /></FormField>
        <FormField label="New policy # (if it changed)" htmlFor="rn-number"><Input id="rn-number" value={newNumber} onChange={(e) => setNewNumber(e.target.value)} /></FormField>
      </div>
      {policy.autopay ? <Alert variant="info">On autopay: confirm the payment went through, do not pay again.</Alert> : null}
    </Modal>
  )
}

function ReceivedDialog({ policy, defaultTerm, onClose, onDone }: { policy: PolicyRow; defaultTerm: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [term, setTerm] = useState(defaultTerm)
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    try {
      const n = await policyReceived(policy.id, term.trim())
      toast.success(n ? `${n} send task${n === 1 ? '' : 's'} made for the people who need it` : 'Recorded. Nobody on the list needs this policy, or they already got this year.')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Policy received: ${policy.label}`} submitLabel="Make the send tasks" busy={busy} onSubmit={submit} onClose={onClose}>
      <p className="text-sm text-stone-700">The new policy paper is in. Everyone on <Link to={`${ROUTES.accountingInsurance}?tab=who`} className="text-brand hover:underline">Who needs proof</Link> who needs this policy gets a task to send it, due in a week.</p>
      <FormField label="Policy year" htmlFor="rc-term"><Input id="rc-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="2026-27" /></FormField>
    </Modal>
  )
}

function TermDialog({ organizationId, policyId, term, onClose, onDone }: { organizationId: string; policyId: string; term: AccountingPolicyTerm | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState(term?.term_label ?? '')
  const [premium, setPremium] = useState(term?.premium != null ? String(term.premium) : '')
  const [paidOn, setPaidOn] = useState(term?.paid_on ?? '')
  const [paidFrom, setPaidFrom] = useState(term?.paid_from ?? '')
  const [notes, setNotes] = useState(term?.notes ?? '')
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!label.trim()) { toast.error('Which year?'); return }
    setBusy(true)
    try {
      await saveTerm(organizationId, policyId, term?.id ?? null, { term_label: label.trim(), premium: premium ? Number(premium) : null, paid_on: paidOn || null, paid_from: paidFrom, notes })
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!term || !window.confirm(`Remove ${term.term_label}?`)) return
    try { await deleteTerm(term.id); await onDone() } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <Modal title={term ? `Policy year ${term.term_label}` : 'Add a policy year'} submitLabel="Save" busy={busy} onSubmit={submit} onClose={onClose}>
      <FormField label="Year" htmlFor="tm-label"><Input id="tm-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2026-27" /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Premium" htmlFor="tm-premium"><Input id="tm-premium" type="number" step="0.01" value={premium} onChange={(e) => setPremium(e.target.value)} /></FormField>
        <FormField label="Paid on" htmlFor="tm-paid"><Input id="tm-paid" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></FormField>
      </div>
      <FormField label="Paid from" htmlFor="tm-from"><Input id="tm-from" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} /></FormField>
      <FormField label="Notes" htmlFor="tm-notes"><Textarea id="tm-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      {term ? <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"><Trash2 className="size-4" aria-hidden="true" /> Remove this year</button> : null}
    </Modal>
  )
}

function PolicyForm({ organizationId, policy, onSaved, onCancel }: { organizationId: string; policy: PolicyRow | null; onSaved: (id: string) => Promise<void>; onCancel: () => void }) {
  const contacts = useSupabaseQuery(() => listAccountingContacts(organizationId), [organizationId])
  const [f, setF] = useState({
    label: policy?.label ?? '', property: policy?.property ?? '', coverage_description: policy?.coverage_description ?? '', coverage_type: (policy?.coverage_type ?? 'other') as CoverageType,
    carrier: policy?.carrier ?? '', agent_contact_id: policy?.agent_contact_id ?? '', policy_number: policy?.policy_number ?? '', prior: (policy?.prior_policy_numbers ?? []).join(', '),
    named_insured: policy?.named_insured ?? '', building_owner: policy?.building_owner ?? '', paid_by: policy?.paid_by ?? '', coverage_limits: policy?.coverage_limits ?? '',
    renewal_date: policy?.renewal_date ?? '', autopay: policy?.autopay ?? false, billed_with: policy?.billed_with ?? '', notes: policy?.notes ?? '', is_active: policy?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.label.trim()) { setError('Give the policy a name'); return }
    setSaving(true)
    setError(null)
    try {
      const id = await savePolicy(organizationId, policy?.id ?? null, {
        label: f.label.trim(), property: f.property, coverage_description: f.coverage_description, coverage_type: f.coverage_type, carrier: f.carrier, agent_contact_id: f.agent_contact_id || null,
        policy_number: f.policy_number, prior_policy_numbers: f.prior.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean), named_insured: f.named_insured, building_owner: f.building_owner,
        paid_by: f.paid_by, coverage_limits: f.coverage_limits, renewal_date: f.renewal_date || null, autopay: f.autopay, billed_with: f.billed_with, notes: f.notes, is_active: f.is_active,
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
      <BackLink fallback={ROUTES.accountingInsurance} fallbackLabel="Insurance" />
      <PageHeader title={policy ? `Edit: ${policy.label}` : 'New policy'} />
      <div className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
        <FormField label="Name" htmlFor="pf-label" hint="How you talk about it: Red House fire, SLS DIC for Sports Store."><Input id="pf-label" value={f.label} onChange={(e) => set('label', e.target.value)} /></FormField>
        <FormField label="Property" htmlFor="pf-property"><Input id="pf-property" value={f.property} onChange={(e) => set('property', e.target.value)} /></FormField>
        <FormField label="What it covers" htmlFor="pf-desc"><Input id="pf-desc" value={f.coverage_description} onChange={(e) => set('coverage_description', e.target.value)} /></FormField>
        <FormField label="Type" htmlFor="pf-type">
          <Select id="pf-type" value={f.coverage_type} onChange={(e) => set('coverage_type', e.target.value)}>{COVERAGE_TYPES.map((t) => <option key={t} value={t}>{COVERAGE_LABELS[t]}</option>)}</Select>
        </FormField>
        <FormField label="Carrier" htmlFor="pf-carrier"><Input id="pf-carrier" value={f.carrier} onChange={(e) => set('carrier', e.target.value)} /></FormField>
        <FormField label="Agent" htmlFor="pf-agent">
          <Select id="pf-agent" value={f.agent_contact_id} onChange={(e) => set('agent_contact_id', e.target.value)}>
            <option value="">—</option>
            {(contacts.data ?? []).filter((c) => c.status !== 'ignored').map((c) => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
          </Select>
        </FormField>
        <FormField label="Policy #" htmlFor="pf-number"><Input id="pf-number" value={f.policy_number} onChange={(e) => set('policy_number', e.target.value)} /></FormField>
        <FormField label="Prior policy #s" htmlFor="pf-prior" hint="Comma-separated. A lapse gives Cal Fair policies a new number."><Input id="pf-prior" value={f.prior} onChange={(e) => set('prior', e.target.value)} /></FormField>
        <FormField label="Named insured" htmlFor="pf-insured"><Input id="pf-insured" value={f.named_insured} onChange={(e) => set('named_insured', e.target.value)} /></FormField>
        <FormField label="Building owner" htmlFor="pf-owner"><Input id="pf-owner" value={f.building_owner} onChange={(e) => set('building_owner', e.target.value)} /></FormField>
        <FormField label="Paid by" htmlFor="pf-paidby"><Input id="pf-paidby" value={f.paid_by} onChange={(e) => set('paid_by', e.target.value)} /></FormField>
        <FormField label="Coverage limits" htmlFor="pf-limits"><Input id="pf-limits" value={f.coverage_limits} onChange={(e) => set('coverage_limits', e.target.value)} /></FormField>
        <FormField label="Renewal date" htmlFor="pf-renewal"><Input id="pf-renewal" type="date" value={f.renewal_date} onChange={(e) => set('renewal_date', e.target.value)} /></FormField>
        <FormField label="Billed with" htmlFor="pf-billed" hint="Another policy on the same bill, if any."><Input id="pf-billed" value={f.billed_with} onChange={(e) => set('billed_with', e.target.value)} /></FormField>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={f.autopay} onChange={(e) => set('autopay', e.target.checked)} /> On autopay</label>
          <label className="flex items-center gap-2 text-sm text-stone-800"><input type="checkbox" className="size-4 accent-brand" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (makes renewal tasks)</label>
        </div>
        <FormField label="Notes" htmlFor="pf-notes" className="sm:col-span-2"><Textarea id="pf-notes" rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      </div>
      <StickySaveBar saving={saving} onCancel={onCancel} label="Save policy" error={error} />
    </form>
  )
}
