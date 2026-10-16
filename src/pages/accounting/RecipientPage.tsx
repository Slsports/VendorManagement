import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Send, UserCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getRecipient, latestSentEmailId, listPolicies, recordSend, saveRecipient, type PolicyRow } from '@/services/insurance'
import { listMailboxes } from '@/services/mail'
import { latestTerm } from '@/lib/insurance'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { AccountingPolicyRecipient } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { Modal } from '@/components/shared/Modal'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { ComposeDialog } from '@/components/mail/ComposeDialog'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

/** Someone who must get proof of insurance (Dana, Oct 16): who, which policies, when, what was sent, and Send now. */
export default function RecipientPage() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = useSupabaseQuery(async () => (isNew ? null : getRecipient(id)), [id])
  const policies = useSupabaseQuery(async () => (organization ? listPolicies(organization.id, true) : []), [organization?.id])
  const boxes = useSupabaseQuery(async () => (organization ? listMailboxes(organization.id) : []), [organization?.id])
  const box = (boxes.data ?? []).find((b) => b.kind === 'accounting') ?? null
  const [editing, setEditing] = useState(isNew)
  const [sending, setSending] = useState<PolicyRow | null>(null)
  const [agentSent, setAgentSent] = useState<PolicyRow | null>(null)
  const wantedSend = params.get('send')

  if (!isNew && q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!isNew && !q.data) return <Alert variant="error">Not found.</Alert>
  if (!organization) return null
  const r = q.data?.recipient ?? null
  const sends = q.data?.sends ?? []
  const needs = (policies.data ?? []).filter((p) => r?.policy_ids.includes(p.id))

  if (editing) {
    return (
      <RecipientForm key={r ? `${r.id}:${r.updated_at}` : 'new'} organizationId={organization.id} recipient={r} policies={policies.data ?? []}
        onSaved={async (savedId) => { if (isNew) navigate(`${ROUTES.accountingInsurance}/who/${savedId}`, { replace: true }); else { setEditing(false); await q.refetch() } }}
        onCancel={() => (isNew ? navigate(`${ROUTES.accountingInsurance}?tab=who`) : setEditing(false))} />
    )
  }

  const title = r!.company || r!.person || r!.email
  const emailFor = (p: PolicyRow) => {
    const term = latestTerm(p.terms)
    const docId = p.terms.find((t) => t.document_id)?.document_id ?? null
    return {
      to: [r!.email],
      subject: `Shaver Lake Sports – ${p.label}${term ? ` ${term.term_label}` : ''} policy`,
      body: `Hello${r!.person ? ` ${r!.person.split(' ')[0]}` : ''},\n\nAttached is our current ${p.label.toLowerCase()} policy${term ? ` for ${term.term_label}` : ''} (${p.carrier}${p.policy_number ? `, policy ${p.policy_number}` : ''}) for your file.\n\nPlease let me know if you need anything else.\n\nThank you,\nDana Powell\nShaver Lake Sports Inc.`,
      mailbox_id: box?.id ?? null,
      note: docId ? 'The policy on file is attached.' : 'No policy paper is on file for this year yet: attach it from your computer, or file it on the policy first.',
      vendor_link_ids: docId ? [docId] : [],
    }
  }

  return (
    <div>
      <BackLink fallback={`${ROUTES.accountingInsurance}?tab=who`} fallbackLabel="Who needs proof" />
      <PageHeader title={title} description={[r!.person && r!.company ? r!.person : null, r!.email, r!.why].filter(Boolean).join(' · ')}
        actions={<div className="flex flex-wrap gap-2">
          <Badge tone={r!.status === 'confirmed' ? 'success' : r!.status === 'proposed' ? 'warning' : 'neutral'}>{r!.status === 'proposed' ? 'To confirm' : r!.status === 'confirmed' ? 'Confirmed' : 'Ignored'}</Badge>
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        </div>} />
      {r!.asked_at ? <Alert variant="warning" className="mb-4">They asked for proof on {new Date(r!.asked_at).toLocaleDateString()}{r!.asked_email_id ? <> · <Link to={`${ROUTES.mail}?box=${box?.id ?? ''}&q=`} className="underline">see the mail</Link></> : null}. Sending clears this.</Alert> : null}
      {r!.status === 'proposed' ? <Alert variant="info" className="mb-4">VMS found this person asking for proof in the mail. Edit to say which policies they need and confirm.</Alert> : null}
      <section className="rounded-2xl border border-stone-200 bg-white">
        <div className="px-4 py-3"><h2 className="text-sm font-semibold text-stone-900">Policies they need</h2>
          <p className="text-xs text-stone-500">{r!.when_kind === 'date' && r!.due_month ? `Due every year by ${r!.due_month}/${r!.due_day ?? 1}.` : 'Every time the policy renews.'}</p></div>
        {needs.length === 0 ? <p className="px-4 pb-4 text-sm text-stone-500">No policies picked yet. Edit to choose them.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Policy</th><th className="px-4 py-2">Latest year on file</th><th className="px-4 py-2">Last sent to them</th><th className="px-4 py-2"></th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {needs.map((p) => {
                const term = latestTerm(p.terms)
                const last = sends.find((s) => s.policy_id === p.id)
                const behind = term && (!last || (last.term_label ?? '') < term.term_label)
                return (
                  <tr key={p.id} className={wantedSend === p.id ? 'bg-brand-soft' : ''}>
                    <td className="px-4 py-2"><Link to={`${ROUTES.accountingInsurance}/${p.id}`} className="font-medium text-stone-900 hover:text-brand">{p.label}</Link><span className="block text-xs text-stone-500">{p.carrier}</span></td>
                    <td className="px-4 py-2 text-stone-700">{term ? `${term.term_label}${term.received_at ? ' · paper received' : ''}` : '—'}</td>
                    <td className="px-4 py-2 text-stone-700">{last ? `${last.term_label ?? ''} on ${new Date(`${last.sent_on}T00:00:00`).toLocaleDateString()}${last.sent_by === 'agent' ? ' by Hub' : ''}` : <span className="text-stone-400">never</span>}{behind ? <Badge tone="warning" className="ml-2">behind</Badge> : null}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <span className="inline-flex gap-1">
                        <Button size="sm" onClick={() => setSending(p)} leftIcon={<Send className="size-3.5" aria-hidden="true" />}>Send now</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAgentSent(p)} leftIcon={<UserCheck className="size-3.5" aria-hidden="true" />}>Hub sent it</Button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="mt-6 rounded-2xl border border-stone-200 bg-white">
        <h2 className="px-4 py-3 text-sm font-semibold text-stone-900">What was sent</h2>
        {sends.length === 0 ? <p className="px-4 pb-4 text-sm text-stone-500">Nothing logged yet.</p> : (
          <ul className="divide-y divide-stone-100 text-sm">
            {sends.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2">
                <span className="text-stone-700">{new Date(`${s.sent_on}T00:00:00`).toLocaleDateString()}</span>
                <span className="font-medium text-stone-900">{(policies.data ?? []).find((p) => p.id === s.policy_id)?.label ?? 'policy'}{s.term_label ? ` ${s.term_label}` : ''}</span>
                <span className="text-stone-500">{s.sent_by === 'agent' ? 'sent by Hub' : 'sent by us'}</span>
                {s.note ? <span className="text-stone-500">{s.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {r!.notes ? <p className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{r!.notes}</p> : null}
      {sending ? (
        <ComposeDialog draft={emailFor(sending)} onClose={() => setSending(null)} onSent={(threadId) => {
          const term = latestTerm(sending.terms)
          void (async () => {
            const emailId = await latestSentEmailId(threadId).catch(() => null)
            await recordSend(r!.id, { policyId: sending.id, term: term?.term_label ?? null, sentBy: 'us', emailId })
            toast.success('Sent and logged')
            setSending(null)
            await q.refetch()
          })().catch((err) => toast.error(errorMessage(err)))
        }} />
      ) : null}
      {agentSent ? <AgentSentDialog recipient={r!} policy={agentSent} onClose={() => setAgentSent(null)} onDone={async () => { setAgentSent(null); await q.refetch() }} /> : null}
    </div>
  )
}

function AgentSentDialog({ recipient, policy, onClose, onDone }: { recipient: AccountingPolicyRecipient; policy: PolicyRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [term, setTerm] = useState(latestTerm(policy.terms)?.term_label ?? '')
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    try {
      await recordSend(recipient.id, { policyId: policy.id, term: term || null, sentBy: 'agent', sentOn: on, note: 'Sent by Hub International' })
      toast.success('Logged')
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Hub sent ${policy.label} to ${recipient.company || recipient.person || recipient.email}`} submitLabel="Log it" busy={busy} onSubmit={submit} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Sent on" htmlFor="as-on"><Input id="as-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></FormField>
        <FormField label="Policy year" htmlFor="as-term"><Input id="as-term" value={term} onChange={(e) => setTerm(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}

function RecipientForm({ organizationId, recipient, policies, onSaved, onCancel }: { organizationId: string; recipient: AccountingPolicyRecipient | null; policies: PolicyRow[]; onSaved: (id: string) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({
    company: recipient?.company ?? '', person: recipient?.person ?? '', email: recipient?.email ?? '', why: recipient?.why ?? '', when_kind: recipient?.when_kind ?? 'renewal',
    due_month: recipient?.due_month ? String(recipient.due_month) : '', due_day: recipient?.due_day ? String(recipient.due_day) : '', notes: recipient?.notes ?? '',
    status: recipient?.status === 'proposed' ? 'confirmed' : (recipient?.status ?? 'confirmed'), policy_ids: recipient?.policy_ids ?? [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.email.trim()) { setError('Enter the email to send to'); return }
    setSaving(true)
    setError(null)
    try {
      const id = await saveRecipient(organizationId, recipient?.id ?? null, {
        company: f.company.trim(), person: f.person.trim(), email: f.email, why: f.why.trim(), when_kind: f.when_kind as 'renewal' | 'date',
        due_month: f.when_kind === 'date' && f.due_month ? Number(f.due_month) : null, due_day: f.when_kind === 'date' && f.due_day ? Number(f.due_day) : null,
        notes: f.notes, status: f.status as AccountingPolicyRecipient['status'], policy_ids: f.policy_ids,
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
      <BackLink fallback={`${ROUTES.accountingInsurance}?tab=who`} fallbackLabel="Who needs proof" />
      <PageHeader title={recipient ? 'Edit who needs proof' : 'Someone who needs proof of insurance'} description="The lender, a landlord, a contract partner: who they are, where to send it, which policies, how often." />
      <div className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
        <FormField label="Company" htmlFor="rf-company"><Input id="rf-company" value={f.company} onChange={(e) => set('company', e.target.value)} /></FormField>
        <FormField label="Person" htmlFor="rf-person"><Input id="rf-person" value={f.person} onChange={(e) => set('person', e.target.value)} /></FormField>
        <FormField label="Send to (email)" htmlFor="rf-email"><Input id="rf-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></FormField>
        <FormField label="Why they need it" htmlFor="rf-why" hint="Commercial loan, lease, contract…"><Input id="rf-why" value={f.why} onChange={(e) => set('why', e.target.value)} /></FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-stone-800">Which policies</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {policies.filter((p) => p.is_active || f.policy_ids.includes(p.id)).map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-stone-800">
                <input type="checkbox" className="size-4 accent-brand" checked={f.policy_ids.includes(p.id)} onChange={(e) => set('policy_ids', e.target.checked ? [...f.policy_ids, p.id] : f.policy_ids.filter((x) => x !== p.id))} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FormField label="When" htmlFor="rf-when">
          <Select id="rf-when" value={f.when_kind} onChange={(e) => set('when_kind', e.target.value)}>
            <option value="renewal">Every time the policy renews</option>
            <option value="date">By a date every year</option>
          </Select>
        </FormField>
        {f.when_kind === 'date' ? (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Month" htmlFor="rf-month"><Input id="rf-month" type="number" min={1} max={12} value={f.due_month} onChange={(e) => set('due_month', e.target.value)} /></FormField>
            <FormField label="Day" htmlFor="rf-day"><Input id="rf-day" type="number" min={1} max={31} value={f.due_day} onChange={(e) => set('due_day', e.target.value)} /></FormField>
          </div>
        ) : null}
        <FormField label="Status" htmlFor="rf-status">
          <Select id="rf-status" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="confirmed">Confirmed: gets a send task when the policy comes in</option>
            <option value="proposed">To confirm</option>
            <option value="ignored">Ignored</option>
          </Select>
        </FormField>
        <FormField label="Notes" htmlFor="rf-notes" className="sm:col-span-2"><Textarea id="rf-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      </div>
      <StickySaveBar saving={saving} onCancel={onCancel} label="Save" error={error} />
    </form>
  )
}
