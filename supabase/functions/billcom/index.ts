// billcom: Bill.com, light (Dana, Oct 19). No auto-entry, no auto-payment, no vendor sync.
//   { action: 'status' }                                   → what Settings shows (never the key or token)
//   { action: 'save', dev_key, org_bill_id, username, password, base_url?, inbox_address? } → keep them, sign in once to prove them
//   { action: 'test' }                                     → sign in and read one page of bills
//   { action: 'sync_now' }                                 → read the bills now (the scheduler does it every 15 minutes)
//   { action: 'disconnect' }                               → forget the token (the key stays)
//   { action: 'sync' } with the scheduler's secret         → every organization
// Fields per Bill.com's "Get list of bills" page (Dana, Oct 19): results[], nextPage, id, vendorId, vendorName, amount,
// dueAmount, dueDate, invoice{invoiceNumber, invoiceDate}, paymentStatus PAID/UNPAID/PARTIALLY_PAID/SCHEDULED/IN_PROCESS,
// recordStatus ACTIVE/…, archived.
// Sign-in: POST {base}/v3/login with username, password, organizationId, devKey → sessionId; later calls carry devKey and
// sessionId headers (Bill.com's v3 API). With a sync token the token name is the username and the token is the password.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { readBillcomPaper, type BillcomPaper } from '../_shared/billcomPapers.ts'

interface Conn {
  organization_id: string; base_url: string; dev_key: string | null; org_bill_id: string | null; username: string | null; password: string | null
  inbox_address: string; session_id: string | null; session_at: string | null; connected_at: string | null; connected_by: string | null
  last_sync_at: string | null; last_error: string | null; bills_seen: number | null; sample: Record<string, unknown> | null
}
type Bill = Record<string, unknown>

const SESSION_MINUTES = 25        // Bill.com drops an idle session after 35 minutes
const PAGES = 10                  // up to 1,000 bills a read, newest due dates first
const OLD_DAYS = 120              // stop once the due dates are this far back

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; dev_key?: string; org_bill_id?: string; username?: string; password?: string; base_url?: string; inbox_address?: string }
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (trusted) {
      if (body.action !== 'sync') throw new HttpError(400, 'Unknown action')
      const { data: conns } = await db.from('billcom_connections').select('*').not('password', 'is', null)
      const out: unknown[] = []
      for (const c of (conns ?? []) as Conn[]) out.push(await syncOrg(db, c).catch((e) => ({ organization_id: c.organization_id, error: e instanceof Error ? e.message : String(e) })))
      return json(out)
    }

    const me = await caller(req, db)
    const org = me.organization_id
    if (me.role !== 'admin') throw new HttpError(403, 'Only the admin connects Bill.com')

    if (body.action === 'save') {
      const devKey = String(body.dev_key ?? '').trim(), orgId = String(body.org_bill_id ?? '').trim(), user = String(body.username ?? '').trim(), pass = String(body.password ?? '').trim()
      if (devKey.length < 8 || !orgId || !user || !pass) throw new HttpError(400, 'Fill in the developer key, the organization ID, the token name and the token')
      const base = String(body.base_url ?? '').trim().replace(/\/+$/, '') || 'https://gateway.prod.bill.com/connect'
      if (!/^https:\/\/[^\s/]+bill\.com\/connect$/.test(base)) throw new HttpError(400, 'The API address should look like https://gateway.prod.bill.com/connect')
      const inbox = String(body.inbox_address ?? '').trim().toLowerCase() || 'shaverlakesports1@bill.com'
      if (!/^[^@\s]+@bill\.com$/.test(inbox)) throw new HttpError(400, 'The inbox address should end in @bill.com')
      const { error } = await db.from('billcom_connections').upsert({
        organization_id: org, base_url: base, dev_key: devKey, org_bill_id: orgId, username: user, password: pass, inbox_address: inbox,
        session_id: null, session_at: null, connected_at: null, last_error: null, updated_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      await test(db, org, me.id)
      return json(await status(db, org))
    }
    if (body.action === 'test') { await test(db, org, me.id); return json(await status(db, org)) }
    if (body.action === 'sync_now') {
      const c = await conn(db, org)
      const r = await syncOrg(db, c)
      return json({ ...(await status(db, org)), sync: r })
    }
    if (body.action === 'disconnect') {
      await db.from('billcom_connections').update({ username: null, password: null, session_id: null, session_at: null, connected_at: null, updated_at: new Date().toISOString() }).eq('organization_id', org)
      return json(await status(db, org))
    }
    return json(await status(db, org))
  } catch (e) {
    return errorResponse(e)
  }
})

async function conn(db: SupabaseClient, org: string): Promise<Conn> {
  const { data } = await db.from('billcom_connections').select('*').eq('organization_id', org).maybeSingle()
  if (!data?.dev_key || !data.username || !data.password) throw new HttpError(400, 'Save the developer key, organization ID and token first')
  return data as Conn
}

/** Sign in (or reuse a fresh session). */
async function session(db: SupabaseClient, c: Conn, force = false): Promise<string> {
  const fresh = c.session_id && c.session_at && Date.now() - new Date(c.session_at).getTime() < SESSION_MINUTES * 60_000
  if (fresh && !force) return c.session_id!
  const res = await fetch(`${c.base_url}/v3/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: c.username, password: c.password, organizationId: c.org_bill_id, devKey: c.dev_key }),
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`Bill.com sign-in failed (${res.status}): ${describe(data, text)}`)
  const sid = str(data.sessionId)
  if (!sid) throw new Error(`Bill.com signed in but sent no sessionId: ${text.slice(0, 200)}`)
  await db.from('billcom_connections').update({ session_id: sid, session_at: new Date().toISOString() }).eq('organization_id', c.organization_id)
  c.session_id = sid; c.session_at = new Date().toISOString()
  return sid
}

async function api<T>(db: SupabaseClient, c: Conn, path: string, retry = true): Promise<T> {
  const sid = await session(db, c)
  const res = await fetch(`${c.base_url}${path}`, { headers: { devKey: c.dev_key!, sessionId: sid, 'Content-Type': 'application/json' } })
  const text = await res.text()
  let data: unknown = null
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (res.status === 401 && retry) { await session(db, c, true); return api<T>(db, c, path, false) }
  if (!res.ok) throw new Error(`Bill.com ${path.split('?')[0]} failed (${res.status}): ${describe(data as Record<string, unknown>, text)}`)
  return data as T
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() && !isNaN(Number(v)) ? Number(v) : null)
const describe = (data: Record<string, unknown> | null, text: string) => {
  const m = data && (str(data.message) ?? str(data.error_message) ?? str(data.errorMessage) ?? str((data.error as Record<string, unknown> | undefined)?.message))
  return m ?? text.slice(0, 200)
}
/** A list answer: results, or whatever array the page carries. */
function listOf(page: unknown): { rows: Bill[]; next: string | null; keys: string[] } {
  if (Array.isArray(page)) return { rows: page as Bill[], next: null, keys: ['(array)'] }
  const p = (page ?? {}) as Record<string, unknown>
  const arr = (Array.isArray(p.results) ? p.results : Array.isArray(p.data) ? p.data : Array.isArray(p.items) ? p.items : []) as Bill[]
  return { rows: arr, next: str(p.nextPage), keys: Object.keys(p) }
}
const invoiceOf = (b: Bill) => (b.invoice && typeof b.invoice === 'object' ? (b.invoice as Record<string, unknown>) : {})

/** Prove the key and token: sign in and read one page of bills. */
async function test(db: SupabaseClient, org: string, by: string | null) {
  const c = await conn(db, org)
  try {
    await session(db, c, true)
    const page = await api<unknown>(db, c, '/v3/bills?max=5&sort=dueDate:desc')
    const { rows, keys } = listOf(page)
    await db.from('billcom_connections').update({
      connected_at: new Date().toISOString(), connected_by: by, last_error: null,
      sample: { list_keys: keys, bill_keys: rows[0] ? Object.keys(rows[0]) : [], invoice_keys: rows[0] ? Object.keys(invoiceOf(rows[0])) : [] },
    }).eq('organization_id', org)
  } catch (e) {
    await db.from('billcom_connections').update({ connected_at: null, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', org)
    throw e
  }
}

/** Read the bills, newest due dates first, and keep the pay-by tasks right. */
async function syncOrg(db: SupabaseClient, c: Conn) {
  const org = c.organization_id
  const started = new Date().toISOString()
  try {
    const seen = new Map<string, Bill>()
    let page: string | null = null
    const cutoff = new Date(Date.now() - OLD_DAYS * 86_400_000).toISOString().slice(0, 10)
    let sort = 'dueDate:desc'
    for (let i = 0; i < PAGES; i++) {
      // Bill.com refuses sort (or filters) together with a page cursor; the cursor carries the first page's sort (Oct 22)
      const q = new URLSearchParams({ max: '100' })
      if (page) q.set('page', page); else q.set('sort', sort)
      let answer: unknown
      try {
        answer = await api<unknown>(db, c, `/v3/bills?${q}`)
      } catch (e) {
        if (i === 0 && sort === 'dueDate:desc' && /\(400\)/.test(String(e))) { sort = 'createdTime:desc'; q.set('sort', sort); answer = await api<unknown>(db, c, `/v3/bills?${q}`) } else throw e
      }
      const { rows, next } = listOf(answer)
      let old = false
      for (const b of rows) {
        const id = str(b.id)
        if (!id) continue
        seen.set(id, b)
        const due = str(b.dueDate)
        if (due && due < cutoff) old = true
      }
      if (!next || (old && sort === 'dueDate:desc') || rows.length === 0) break
      page = next
    }
    const now = new Date().toISOString()
    const rowsOut = [...seen.entries()].map(([id, b]) => {
      const inv = invoiceOf(b)
      const vendorId = str(b.vendorId)
      return {
        organization_id: org, bill_id: id, vendor_bill_id: vendorId, vendor_name: str(b.vendorName),
        invoice_number: str(inv.invoiceNumber) ?? str(b.invoiceNumber), invoice_date: str(inv.invoiceDate) ?? str(b.invoiceDate),
        due_date: str(b.dueDate), amount: num(b.amount), due_amount: num(b.dueAmount),
        payment_status: str(b.paymentStatus), archived: b.archived === true || (str(b.recordStatus) !== null && str(b.recordStatus) !== 'ACTIVE'),
        raw: b, synced_at: now, gone_at: null,
      }
    })
    for (let i = 0; i < rowsOut.length; i += 200) {
      const { error } = await db.from('billcom_bills').upsert(rowsOut.slice(i, i + 200), { onConflict: 'organization_id,bill_id' })
      if (error) throw new Error(error.message)
    }
    // bills in the window that Bill.com no longer lists are gone (deleted or archived out of the list)
    await db.from('billcom_bills').update({ gone_at: now }).eq('organization_id', org).is('gone_at', null).lt('synced_at', started).gte('due_date', cutoff)
    const papers = await readPapers(db, org)
    const { data: tasks } = await db.rpc('billcom_bill_tasks', { p_org: org })
    await db.from('billcom_connections').update({ last_sync_at: now, last_error: null, bills_seen: rowsOut.length }).eq('organization_id', org)
    return { organization_id: org, bills: rowsOut.length, papers_read: papers, tasks: tasks ?? 0 }
  } catch (e) {
    await db.from('billcom_connections').update({ last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', org)
    throw e
  }
}

/**
 * Invoices and credits of vendors checked against Bill.com (Dana, Oct 27, Emery Jensen): Claude reads each one's number,
 * PO, total and how it is billed at the top (Stihl or EJD). A few each run; billcom_bill_tasks then matches them.
 */
async function readPapers(db: SupabaseClient, org: string): Promise<number> {
  const { data } = await db.rpc('billcom_papers_queue', { p_org: org, p_limit: 12 })
  let n = 0
  for (const p of (data ?? []) as BillcomPaper[]) {
    const r = await readBillcomPaper(db, org, p).catch(() => null)
    const { error } = await db.rpc('billcom_paper_read', { p_link: p.id, p_number: r?.doc_number ?? null, p_po: r?.po_number ?? null, p_total: r?.total ?? null, p_billed_as: r?.billed_as ?? null })
    if (error) throw new Error(error.message)
    n++
  }
  return n
}

async function status(db: SupabaseClient, org: string) {
  const { data: c } = await db.from('billcom_connections').select('*').eq('organization_id', org).maybeSingle()
  let by: string | null = null
  if (c?.connected_by) by = (await db.from('profiles').select('full_name').eq('id', c.connected_by).maybeSingle()).data?.full_name ?? null
  const { count: unpaid } = await db.from('billcom_bills').select('bill_id', { count: 'exact', head: true }).eq('organization_id', org).is('gone_at', null).neq('payment_status', 'PAID')
  return {
    set_up: !!(c?.dev_key && c.username && c.password), dev_key: c?.dev_key ? `…${c.dev_key.slice(-4)}` : null, org_bill_id: c?.org_bill_id ?? null,
    username: c?.username ?? null, inbox_address: c?.inbox_address ?? 'shaverlakesports1@bill.com', base_url: c?.base_url ?? 'https://gateway.prod.bill.com/connect',
    connected: !!c?.connected_at, connected_at: c?.connected_at ?? null, connected_by: by,
    last_sync_at: c?.last_sync_at ?? null, last_error: c?.last_error ?? null, bills_seen: c?.bills_seen ?? null, unpaid: unpaid ?? 0, sample: c?.sample ?? null,
  }
}
