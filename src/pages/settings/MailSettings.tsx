import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getAiUsageThisMonth, getMailStatus, listSignatures, reclassifyAllMail, saveSignature, saveSignatureTemplate, setFollowUpDays, syncMailNow, type PersonSignature } from '@/services/mail'
import { fillSignature, LOGO_URL } from '@/lib/signature'
import { FoldSection } from '@/components/shared/FoldSection'
import { errorMessage } from '@/lib/utils'
import { FreightWatchers } from '@/components/freight/FreightWatchers'
import { MailboxesStatus } from '@/components/mail/MailboxesStatus'
import { Alert, Button, FormField, Input, Spinner, Textarea } from '@/components/ui'

/** The orders@ connection: is it syncing, how far the 12-month backfill has got, and the follow-up setting. */
export default function MailSettings() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? getMailStatus(organization.id) : null), [organization?.id])
  const [syncing, setSyncing] = useState(false)
  const [days, setDays] = useState<string | null>(null)
  const [resorting, setResorting] = useState(false)

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading mail status…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  const m = q.data
  if (!m) return <Alert variant="info">No mailbox is connected for this organization yet.</Alert>
  const pct = m.emails ? Math.round((m.matched / m.emails) * 100) : 0

  async function sync() {
    setSyncing(true)
    try {
      await syncMailNow()
      toast.success('Mail synced')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSyncing(false)
    }
  }

  async function resort() {
    setResorting(true)
    try {
      const n = await reclassifyAllMail(organization!.id)
      toast.success(n ? `${n.toLocaleString()} email${n === 1 ? '' : 's'} changed view` : 'Everything was already sorted')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setResorting(false)
    }
  }

  async function saveDays() {
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1 || n > 60) return toast.error('Use a whole number of days from 1 to 60')
    try {
      await setFollowUpDays(organization!.id, n)
      toast.success(`Follow-up after ${n} day${n === 1 ? '' : 's'}`)
      setDays(null)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Mailbox</h2>
            <p className="mt-1 text-lg font-semibold text-stone-900">{m.mailbox}</p>
            <p className="text-sm text-stone-600">
              {m.last_sync_at ? `Last checked ${formatDistanceToNow(new Date(m.last_sync_at), { addSuffix: true })}` : 'Not checked yet'} · checks every minute
            </p>
          </div>
          <Button variant="secondary" loading={syncing} onClick={() => void sync()} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Sync now</Button>
        </div>
        {m.last_error ? <Alert variant="error" className="mt-3">Last problem{m.last_error_at ? ` (${formatDistanceToNow(new Date(m.last_error_at), { addSuffix: true })})` : ''}: {m.last_error}</Alert> : null}
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          <div><dt className="text-xs font-medium text-stone-500">Emails in VMS</dt><dd className="text-xl font-semibold text-stone-900">{m.emails.toLocaleString()}</dd></div>
          <div><dt className="text-xs font-medium text-stone-500">Filed to a vendor</dt><dd className="text-xl font-semibold text-stone-900">{pct}%</dd></div>
          <div><dt className="text-xs font-medium text-stone-500">Senders to identify</dt><dd className="text-xl font-semibold text-stone-900">{m.senders_waiting}</dd></div>
          <div><dt className="text-xs font-medium text-stone-500">First load</dt><dd className="text-sm font-medium text-stone-900">{m.backfill_done ? 'Done' : `Loading the 12 months since ${m.backfill_after ? new Date(`${m.backfill_after}T12:00:00`).toLocaleDateString() : 'last year'}`}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-stone-500">Senders to identify wait in the review queue under "Who is this mail from?". One answer files all their mail, now and later.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
          <Button size="sm" variant="secondary" loading={resorting} onClick={() => void resort()}>Re-sort all mail</Button>
          <p className="text-xs text-stone-500">Sorts every email into Primary or Promotions again with what VMS knows now. Conversations you moved by hand stay where you put them.</p>
        </div>
      </section>

      <ClaudeUsage organizationId={organization!.id} />

      <MailboxesStatus />
      <FreightWatchers organizationId={organization!.id} />
      <Signatures organizationId={organization!.id} />

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Follow-up</h2>
        <p className="mt-1 text-sm text-stone-600">When you email a vendor from VMS and they have not answered after this many days, the thread comes back to your dashboard as "No answer yet".</p>
        <div className="mt-3 flex items-end gap-2">
          <FormField label="Days to wait" htmlFor="follow-up-days" className="w-32">
            <Input id="follow-up-days" type="number" min={1} max={60} value={days ?? String(m.follow_up_days)} onChange={(e) => setDays(e.target.value)} />
          </FormField>
          {days !== null && days !== String(m.follow_up_days) ? <Button onClick={() => void saveDays()}>Save</Button> : null}
        </div>
      </section>
    </div>
  )
}

/**
 * Signatures (Dana, Oct 13): one template with the logo for everyone, filled in with each person's name, title and direct
 * phone. Someone may keep their own version instead. Every email shows the signature in the compose window to change.
 */
function Signatures({ organizationId }: { organizationId: string }) {
  const { organization, refreshProfile } = useAuth()
  const q = useSupabaseQuery(() => listSignatures(organizationId), [organizationId])
  const [template, setTemplate] = useState<string | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const current = organization?.signature_template ?? ''
  const shown = template ?? current

  async function saveTemplate() {
    setSavingTemplate(true)
    try {
      await saveSignatureTemplate(organizationId, shown)
      toast.success('Signature template saved')
      setTemplate(null)
      await refreshProfile()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingTemplate(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Signatures</h2>
      <p className="mt-1 text-sm text-stone-600">Every email sent through VMS ends with the logo and this signature. {'{name}'}, {'{title}'} and {'{direct}'} fill in for each person; anyone can change the signature on a single email before sending.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <FormField label="Template for everyone" htmlFor="sig-template">
            <Textarea id="sig-template" rows={8} value={shown} onChange={(e) => setTemplate(e.target.value)} className="font-mono text-xs" />
          </FormField>
          {template !== null && template !== current ? <Button size="sm" className="mt-2" loading={savingTemplate} onClick={() => void saveTemplate()}>Save template</Button> : null}
        </div>
        <SignaturePreview text={fillSignature(shown, { name: 'Dana Powell', title: 'Manager', direct: null, own: null })} label="Looks like" />
      </div>
      {q.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading…</p> : q.error ? <Alert variant="error" className="mt-3">{q.error}</Alert> : (
        <div className="mt-6 space-y-3">
          {(q.data ?? []).map((p) => <PersonSignatureRow key={p.id} person={p} template={current} onSaved={() => void q.refetch()} />)}
        </div>
      )}
    </section>
  )
}

function SignaturePreview({ text, label }: { text: string; label: string }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-stone-700">{label}</p>
      <div className="rounded-lg border border-stone-200 p-3 text-xs leading-relaxed text-stone-700">
        <img src={LOGO_URL.replace(/^https:\/\/[^/]+/, '')} alt="Shaver Lake Sports" width={240} height={31} className="mb-2 h-auto max-w-[240px]" />
        <p className="whitespace-pre-line">{text}</p>
      </div>
    </div>
  )
}

function PersonSignatureRow({ person: p, template, onSaved }: { person: PersonSignature; template: string; onSaved: () => void }) {
  const start = { signature_name: p.signature_name ?? '', job_title: p.job_title ?? '', direct_phone: p.direct_phone ?? '', email_signature: p.email_signature ?? '' }
  const [v, setV] = useState(start)
  const [own, setOwn] = useState(!!p.email_signature)
  const [saving, setSaving] = useState(false)
  const changed = JSON.stringify({ ...v, email_signature: own ? v.email_signature : '' }) !== JSON.stringify(start)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const filled = fillSignature(template, { name: v.signature_name || p.full_name, title: v.job_title, direct: v.direct_phone, own: own ? v.email_signature : null })

  async function save() {
    setSaving(true)
    try {
      await saveSignature(p.id, { ...v, email_signature: own ? v.email_signature : '' })
      toast.success(`Signature saved for ${p.full_name || p.email}`)
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FoldSection title={p.full_name || p.email} summary={[v.job_title, own ? 'own version' : null].filter(Boolean).join(' · ') || null}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Name" htmlFor={`sig-name-${p.id}`}><Input id={`sig-name-${p.id}`} value={v.signature_name} onChange={set('signature_name')} placeholder={p.full_name} /></FormField>
            <FormField label="Title" htmlFor={`sig-title-${p.id}`}><Input id={`sig-title-${p.id}`} value={v.job_title} onChange={set('job_title')} placeholder="Buyer" /></FormField>
            <FormField label="Direct phone" htmlFor={`sig-direct-${p.id}`}><Input id={`sig-direct-${p.id}`} value={v.direct_phone} onChange={set('direct_phone')} /></FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={own} onChange={(e) => { setOwn(e.target.checked); if (e.target.checked && !v.email_signature) setV((x) => ({ ...x, email_signature: filled })) }} className="size-4 rounded border-stone-300" />
            Use their own version instead of the template
          </label>
          {own ? <Textarea aria-label={`Own signature for ${p.full_name}`} rows={6} value={v.email_signature} onChange={set('email_signature')} /> : null}
          {changed ? <Button size="sm" loading={saving} onClick={() => void save()}>Save</Button> : null}
        </div>
        <SignaturePreview text={filled} label="Their signature" />
      </div>
    </FoldSection>
  )
}

const PURPOSE_LABELS: Record<string, string> = { mail_sort: 'Sorting unclear emails', sender_guess: 'Reading unknown senders', not_logged: 'Other Claude calls (answers that could not be used)' }

/** What Claude has cost this month, next to the $25 monthly limit set in the Claude Console. */
function ClaudeUsage({ organizationId }: { organizationId: string }) {
  const q = useSupabaseQuery(() => getAiUsageThisMonth(organizationId), [organizationId])
  const u = q.data
  const money = (n: number) => (n < 0.01 && n > 0 ? 'under 1¢' : `$${n.toFixed(2)}`)
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Claude this month</h2>
      {q.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading…</p> : q.error ? <Alert variant="error" className="mt-3">{q.error}</Alert> : !u || u.calls === 0 ? (
        <p className="mt-2 text-sm text-stone-600">No Claude use yet this month.</p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-stone-900">{money(u.cost)}</p>
          <p className="text-sm text-stone-600">{u.items.toLocaleString()} emails and senders read in {u.calls.toLocaleString()} calls. Monthly limit $25 (set in the Claude Console).</p>
          <ul className="mt-3 space-y-1 text-sm text-stone-700">
            {Object.entries(u.byPurpose).map(([k, v]) => <li key={k}>{PURPOSE_LABELS[k] ?? k}: {v.items.toLocaleString()} · {money(v.cost)}</li>)}
          </ul>
        </>
      )}
    </section>
  )
}
