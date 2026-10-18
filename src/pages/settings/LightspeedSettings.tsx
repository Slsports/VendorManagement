import { useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink, PackageSearch, RefreshCw } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { disconnectLightspeed, lightspeedSignInUrl, lightspeedStatus, lsItemScanStatus, saveLightspeedClient, scanLsItems, testLightspeed, type LightspeedStatus } from '@/services/lightspeed'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Settings → Lightspeed (Dana, Oct 13). Step 1: paste the Client ID and Client Secret of the API client registered at
 * Lightspeed (they are kept hidden and never shown again). Step 2: Connect to Lightspeed (sign in to LS and approve).
 * VMS then reads from LS; nothing in LS changes until each batch is approved.
 */
export default function LightspeedSettings() {
  const q = useSupabaseQuery(() => lightspeedStatus(), [])
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error || !q.data) return <Alert variant="error">{q.error ?? 'Could not load'}</Alert>
  return <Lightspeed s={q.data} refetch={q.refetch} />
}

function Lightspeed({ s, refetch }: { s: LightspeedStatus; refetch: () => Promise<unknown> }) {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [editing, setEditing] = useState(!s.secret_saved)
  const [access, setAccess] = useState<'read' | 'full'>(s.read_only === false ? 'full' : 'read')
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key)
    try {
      await fn()
      if (done) toast.success(done)
      await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function connect() {
    setBusy('connect')
    try {
      window.location.assign(await lightspeedSignInUrl(access))
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(null)
    }
  }

  const section = 'rounded-2xl border border-stone-200 bg-white p-5'
  return (
    <div className="space-y-4">
      <section className={section}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-stone-900">Lightspeed</h2>
          {s.connected ? <Badge tone="success">Connected</Badge> : s.secret_saved ? <Badge tone="warning">Not connected yet</Badge> : <Badge tone="neutral">Not set up</Badge>}
        </div>
        <p className="mt-1 text-sm text-stone-600">VMS reads items, Vendor IDs, stock and sales from Lightspeed. Nothing in Lightspeed changes until a batch is approved.</p>
        {s.connected ? (
          <div className="mt-3 space-y-1 text-sm text-stone-800">
            <p className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />{s.account_name ?? 'Lightspeed account'}{s.account_id ? ` (account ${s.account_id})` : ''}</p>
            {s.item_count !== null ? <p>{s.item_count.toLocaleString()} items in Lightspeed</p> : null}
            <p className="text-stone-600">Connected {s.connected_at ? when(s.connected_at) : ''}{s.connected_by ? ` by ${s.connected_by}` : ''} · {s.read_only === false ? 'full access' : 'read only'}</p>
            {s.checked_at ? <p className="text-xs text-stone-500">Last checked {when(s.checked_at)}</p> : null}
          </div>
        ) : null}
        {s.last_error ? <Alert variant="error" className="mt-3">{s.last_error}</Alert> : null}
      </section>

      {s.connected ? <ItemsByVendor /> : null}

      <section className={section}>
        <h3 className="font-semibold text-stone-900">1. The API key from Lightspeed</h3>
        {s.secret_saved && !editing ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone-700">
            <span>Client ID {s.client_id} and its Secret are saved (hidden).</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Replace them</Button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-stone-600">Register the API client at <a href="https://cloud.lightspeedapp.com/oauth/register.php" target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">cloud.lightspeedapp.com/oauth/register.php<ExternalLink className="ml-0.5 inline size-3.5" aria-hidden="true" /></a> with this redirect address:</p>
            <p className="mt-1 break-all rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800">{s.redirect_uri}</p>
            <p className="mt-2 text-sm text-stone-600">Then paste the Client ID and Client Secret here. VMS keeps them hidden; nobody can see them again here.</p>
            <form className="mt-3 grid gap-3 sm:grid-cols-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run('save', async () => { await saveLightspeedClient(clientId, secret); setClientId(''); setSecret(''); setEditing(false) }, 'Saved') }}>
              <FormField label="Client ID" htmlFor="ls-id"><Input id="ls-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} /></FormField>
              <FormField label="Client Secret" htmlFor="ls-secret"><Input id="ls-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} /></FormField>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" loading={busy === 'save'} disabled={!clientId.trim() || !secret.trim()}>Save</Button>
                {s.secret_saved ? <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button> : null}
              </div>
            </form>
          </>
        )}
      </section>

      <section className={section}>
        <h3 className="font-semibold text-stone-900">2. Connect</h3>
        <p className="mt-1 text-sm text-stone-600">Sign in to Lightspeed and click <strong>Authorize</strong>. You come back here when it's done.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <FormField label="Access" htmlFor="ls-access">
            <Select id="ls-access" value={access} onChange={(e) => setAccess(e.target.value as 'read' | 'full')} className="h-10 text-sm">
              <option value="read">Read only</option>
              <option value="full">Full (VMS can write markers, notes and POs)</option>
            </Select>
          </FormField>
          <Button loading={busy === 'connect'} disabled={!s.secret_saved || !!busy} onClick={() => void connect()}>{s.connected ? 'Connect again' : 'Connect to Lightspeed'}</Button>
          {s.connected ? <Button variant="secondary" loading={busy === 'test'} disabled={!!busy} onClick={() => void run('test', testLightspeed, 'Checked')} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Check the connection</Button> : null}
          {s.connected ? <Button variant="ghost" loading={busy === 'disconnect'} disabled={!!busy} onClick={() => { if (window.confirm('Disconnect VMS from Lightspeed? The API key stays saved.')) void run('disconnect', disconnectLightspeed, 'Disconnected') }}>Disconnect</Button> : null}
        </div>
        {!s.secret_saved ? <p className="mt-2 text-xs text-stone-500">Save the API key first.</p> : null}
      </section>
    </div>
  )
}

/**
 * Items per vendor (Dana, Oct 16): VMS reads every LS item, active and archived, and counts them per vendor. Each vendor
 * is then Active in LS (has active items), Inactive in LS (only archived items) or has no items. It reads about a
 * hundred items a second, so the whole list takes a few minutes; it reads again on its own every week.
 */
function ItemsByVendor() {
  const q = useSupabaseQuery(() => lsItemScanStatus(), [])
  const [busy, setBusy] = useState(false)
  const s = q.data
  const running = !!s?.started_at && !s.finished_at
  async function start() {
    setBusy(true)
    try {
      const r = await scanLsItems()
      toast.success(r.busy ? 'Already reading' : r.finished_at ? 'Done' : `Reading: ${(r.items ?? 0).toLocaleString()} items so far. It carries on by itself.`)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="font-semibold text-stone-900">Items per vendor</h3>
      <p className="mt-1 text-sm text-stone-600">VMS counts each vendor's active and archived items in Lightspeed. On the <Link to={ROUTES.vendors} className="text-brand hover:underline">Vendors</Link> list, filter or sort by <strong>LS items</strong>: Active, Inactive (only archived items) or No items. It reads again every week by itself.</p>
      {s?.started_at ? (
        <p className="mt-2 text-sm text-stone-800">
          {running ? `Reading now: ${(s.items ?? 0).toLocaleString()} items so far (started ${when(s.started_at)}). Check back in a few minutes.`
            : `Last read ${when(s.finished_at!)}: ${(s.items ?? 0).toLocaleString()} items, ${(s.archived ?? 0).toLocaleString()} of them archived${s.no_vendor ? `, ${s.no_vendor.toLocaleString()} with no vendor in LS` : ''}.`}
        </p>
      ) : <p className="mt-2 text-sm text-stone-500">Not read yet.</p>}
      {s?.last_error ? <Alert variant="error" className="mt-2">{s.last_error}</Alert> : null}
      <Button size="sm" variant="secondary" className="mt-3" loading={busy} disabled={running} onClick={() => void start()} leftIcon={<PackageSearch className="size-4" aria-hidden="true" />}>{running ? 'Reading…' : 'Read LS items now'}</Button>
    </section>
  )
}
