import { useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useAuth } from '@/hooks/useAuth'
import { billcomStatus, disconnectBillcom, listBillcomForwards, resendBillcomForward, saveBillcom, syncBillcomNow, testBillcom, type BillcomStatus } from '@/services/billcom'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Alert, Badge, Button, FormField, Input, Spinner } from '@/components/ui'

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Settings → Bill.com (Dana, Oct 19): light only. Paste the developer key, the organization ID and a sync token made for
 * VMS; VMS reads the unpaid bills every 15 minutes (pay-by tasks 7 days ahead) and forwards the invoices of vendors
 * whose switch is on to Bill.com's inbox. Nothing is entered or paid by VMS.
 */
export default function BillcomSettings() {
  const q = useSupabaseQuery(() => billcomStatus(), [])
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Could not load'}</Alert>
  return <Billcom s={q.data} refetch={q.refetch} />
}

function Billcom({ s, refetch }: { s: BillcomStatus; refetch: () => Promise<unknown> }) {
  const [devKey, setDevKey] = useState('')
  const [orgId, setOrgId] = useState(s.org_bill_id ?? '')
  const [user, setUser] = useState(s.username ?? '')
  const [pass, setPass] = useState('')
  const [base, setBase] = useState(s.base_url)
  const [inbox, setInbox] = useState(s.inbox_address)
  const [editing, setEditing] = useState(!s.set_up)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key)
    try {
      await fn()
      if (done) toast.success(done)
      await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
      await refetch()
    } finally {
      setBusy(null)
    }
  }
  const section = 'rounded-2xl border border-stone-200 bg-white p-5'
  return (
    <div className="space-y-4">
      <section className={section}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-stone-900">Bill.com</h2>
          {s.connected ? <Badge tone="success">Connected</Badge> : s.set_up ? <Badge tone="warning">Not connected yet</Badge> : <Badge tone="neutral">Not set up</Badge>}
        </div>
        <p className="mt-1 text-sm text-stone-600">VMS reads the unpaid bills from Bill.com every 15 minutes and makes a pay-by task 7 days ahead of each due date. Invoices from vendors with <strong>Send invoices to Bill.com</strong> switched on go to Bill.com's inbox. VMS never enters or pays anything.</p>
        {s.connected ? (
          <div className="mt-3 space-y-1 text-sm text-stone-800">
            <p className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />Organization {s.org_bill_id} as {s.username}</p>
            <p>{s.last_sync_at ? `Bills last read ${when(s.last_sync_at)}: ${s.bills_seen ?? 0} seen, ${s.unpaid} unpaid` : 'Bills not read yet.'}</p>
            <p className="text-stone-600">Connected {s.connected_at ? when(s.connected_at) : ''}{s.connected_by ? ` by ${s.connected_by}` : ''} · invoices go to {s.inbox_address}</p>
            {s.sample?.bill_keys?.length ? <p className="text-xs text-stone-500">Bill.com's bill fields: {s.sample.bill_keys.join(', ')}{s.sample.invoice_keys?.length ? ` · invoice: ${s.sample.invoice_keys.join(', ')}` : ''}</p> : null}
          </div>
        ) : null}
        {s.last_error ? <Alert variant="error" className="mt-3">{s.last_error}</Alert> : null}
        {s.connected ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={busy === 'test'} disabled={!!busy} onClick={() => void run('test', testBillcom, 'Checked')} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Check the connection</Button>
            <Button variant="secondary" size="sm" loading={busy === 'sync'} disabled={!!busy} onClick={() => void run('sync', syncBillcomNow, 'Bills read')}>Read the bills now</Button>
            <Button variant="ghost" size="sm" loading={busy === 'disconnect'} disabled={!!busy} onClick={() => { if (window.confirm('Disconnect VMS from Bill.com? The developer key stays saved; the token is forgotten.')) void run('disconnect', disconnectBillcom, 'Disconnected') }}>Disconnect</Button>
          </div>
        ) : null}
      </section>

      <section className={section}>
        <h3 className="font-semibold text-stone-900">The key and token from Bill.com</h3>
        {s.set_up && !editing ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone-700">
            <span>Developer key {s.dev_key}, organization {s.org_bill_id}, token "{s.username}" are saved (the key and token stay hidden).</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Replace them</Button>
          </div>
        ) : (
          <>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-stone-600">
              <li>In Bill.com: <strong>Settings</strong> › <strong>Sync &amp; Integrations</strong> › <strong>Manage Developer Keys</strong>: make a new key named VMS (not the QuickBooks one). Copy the key.</li>
              <li>Same page, <strong>Tokens</strong>: make a new sync token for VMS. Copy its name and its value; the name is the "Token name" below and the value is the "Token".</li>
              <li>The organization ID starts with 008: Bill.com <strong>Settings</strong> › <strong>Organization</strong> (or on the developer keys page).</li>
            </ol>
            <form className="mt-3 grid gap-3 sm:grid-cols-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run('save', async () => { await saveBillcom({ dev_key: devKey, org_bill_id: orgId, username: user, password: pass, base_url: base, inbox_address: inbox }); setDevKey(''); setPass(''); setEditing(false) }, 'Saved and connected') }}>
              <FormField label="Developer key" htmlFor="bc-key"><Input id="bc-key" type="password" value={devKey} onChange={(e) => setDevKey(e.target.value)} autoComplete="new-password" spellCheck={false} /></FormField>
              <FormField label="Organization ID (starts with 008)" htmlFor="bc-org"><Input id="bc-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} autoComplete="off" spellCheck={false} /></FormField>
              <FormField label="Token name" htmlFor="bc-user"><Input id="bc-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} /></FormField>
              <FormField label="Token" htmlFor="bc-pass"><Input id="bc-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" spellCheck={false} /></FormField>
              <FormField label="Bill.com inbox address" htmlFor="bc-inbox" hint="Where invoices are sent."><Input id="bc-inbox" value={inbox} onChange={(e) => setInbox(e.target.value)} spellCheck={false} /></FormField>
              <FormField label="API address" htmlFor="bc-base" hint="Leave as it is unless Bill.com's developer page says otherwise."><Input id="bc-base" value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} /></FormField>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" loading={busy === 'save'} disabled={!devKey.trim() || !orgId.trim() || !user.trim() || !pass.trim()}>Save and connect</Button>
                {s.set_up ? <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button> : null}
              </div>
            </form>
          </>
        )}
      </section>

      <Forwards />
    </div>
  )
}

/** What went to Bill.com's inbox lately, and a Send again for anything that failed. */
function Forwards() {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listBillcomForwards(organization.id) : []), [organization?.id])
  const [busy, setBusy] = useState<string | null>(null)
  const rows = q.data ?? []
  async function again(id: string) {
    setBusy(id)
    try {
      const r = await resendBillcomForward(id)
      if (r.status === 'sent') toast.success('Sent to Bill.com'); else toast.error(r.error ?? r.status)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="font-semibold text-stone-900">Sent to Bill.com's inbox</h3>
      <p className="mt-1 text-sm text-stone-600">Each vendor's switch is on its page under <strong>Edit</strong>: <strong>Send invoices to Bill.com</strong>. See the <Link to={`${ROUTES.vendors}?billcom=1`} className="text-brand hover:underline">vendors switched on</Link>.</p>
      {rows.length === 0 ? <p className="mt-2 text-sm text-stone-500">Nothing sent yet.</p> : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {rows.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-stone-900">{f.vendor?.name ?? 'Vendor'}</span>
                {f.email ? <> · <Link to={`${ROUTES.mail}/${f.email.thread_id}`} className="text-brand hover:underline">{f.email.subject || '(no subject)'}</Link></> : null}
                <span className="block text-xs text-stone-500">{f.status === 'sent' && f.sent_at ? `Sent ${when(f.sent_at)} to ${f.sent_to}` : f.status === 'queued' ? 'Sending…' : f.status === 'skipped' ? `Not sent: ${f.error}` : `Failed: ${f.error}`}</span>
              </span>
              {f.status === 'failed' || f.status === 'skipped' ? <Button size="sm" variant="secondary" loading={busy === f.id} onClick={() => void again(f.id)}>Send again</Button> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
