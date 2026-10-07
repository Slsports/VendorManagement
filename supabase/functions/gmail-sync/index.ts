// gmail-sync: copy orders@ into VMS (docs/gmail-connection.md). Runs every few minutes from pg_cron
// (header x-cron-secret) and on "Sync now" (a signed-in admin, manager or buyer). Each run: new mail
// since the last run (Gmail history), then another slice of the 12-month backfill until it is done.
// Bodies are stored as plain text; matching and thread status happen in SQL (mail_process).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { Gmail, GmailError, googleAccessToken } from '../_shared/gmail.ts'
import { clueText, parseMessage, type Address, type GmailMessage, type ParsedMessage } from '../_shared/mailParse.ts'
import { buildVendorIndex, domainVendors, mentionedVendors, type VendorIndex } from '../_shared/mailMatch.ts'

// Small slices: an Edge Function run has little CPU time and memory, so each run takes about 100
// messages and the scheduler comes back every minute until the 12 months are in.
const TIME_BUDGET_MS = 20_000
const PAGE = 25
const PARALLEL = 5
const MAX_PER_RUN = 100
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'protonmail.com', 'proton.me'])

interface Account {
  organization_id: string; mailbox: string; internal_domains: string[]; history_id: string | null; backfill_after: string | null
  backfill_page_token: string | null; backfill_done: boolean; sync_started_at: string | null; messages_synced: number
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({})
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Who may run it: the scheduler, or a signed-in editor pressing Sync now.
  let onlyOrg: string | null = null
  const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
  if (!trusted) {
    const { data: u } = await db.auth.getUser(jwt)
    if (!u.user) return json({ error: 'Not signed in' }, 401)
    const { data: p } = await db.from('profiles').select('organization_id, role, is_active').eq('id', u.user.id).single()
    if (!p?.is_active || !['admin', 'manager', 'buyer'].includes(p.role)) return json({ error: 'Not allowed' }, 403)
    onlyOrg = p.organization_id
  }

  let q = db.from('mail_accounts').select('*')
  if (onlyOrg) q = q.eq('organization_id', onlyOrg)
  const { data: accounts, error } = await q
  if (error) return json({ error: error.message }, 500)
  const results = []
  for (const acct of (accounts ?? []) as Account[]) results.push(await syncAccount(db, acct))
  return json({ results })
})

async function syncAccount(db: SupabaseClient, acct: Account) {
  const started = Date.now()
  const org = acct.organization_id
  // One run at a time per mailbox; a run older than five minutes is assumed dead.
  if (acct.sync_started_at && Date.now() - new Date(acct.sync_started_at).getTime() < 5 * 60_000) return { org, skipped: 'already running' }
  await db.from('mail_accounts').update({ sync_started_at: new Date().toISOString() }).eq('organization_id', org)
  let stored = 0
  try {
    const gmail = new Gmail(await googleAccessToken(acct.mailbox))
    const labelNames = new Map((await gmail.labels()).labels.map((l) => [l.id, l.name]))
    const ctx = await loadContext(db, acct, labelNames)

    // Start the history cursor before the backfill so nothing that arrives meanwhile is missed.
    let historyId = acct.history_id
    if (!historyId) {
      historyId = (await gmail.profile()).historyId
      await db.from('mail_accounts').update({ history_id: historyId }).eq('organization_id', org)
    } else {
      const fresh: string[] = []
      const relabel = new Set<string>()
      let pageToken: string | undefined
      try {
        do {
          const h = await gmail.history(historyId, pageToken)
          for (const item of h.history ?? []) {
            for (const a of item.messagesAdded ?? []) fresh.push(a.message.id)
            for (const a of [...(item.labelsAdded ?? []), ...(item.labelsRemoved ?? [])]) relabel.add(a.message.id)
          }
          pageToken = h.nextPageToken
          historyId = h.historyId
        } while (pageToken)
      } catch (e) {
        // An expired cursor (404): pick up the last two days instead, then carry on from now.
        if (!(e instanceof GmailError && e.status === 404)) throw e
        const recent = await gmail.list('newer_than:2d -in:chats', undefined, 500)
        fresh.push(...(recent.messages ?? []).map((m) => m.id))
        historyId = (await gmail.profile()).historyId
      }
      stored += await storeMessages(db, gmail, ctx, fresh, false)
      await updateLabels(db, gmail, ctx, [...relabel].filter((id) => !fresh.includes(id)))
      await db.from('mail_accounts').update({ history_id: historyId }).eq('organization_id', org)
    }

    // Backfill slices while there is time left in this run.
    let pageToken = acct.backfill_page_token ?? undefined
    let done = acct.backfill_done
    while (!done && Date.now() - started < TIME_BUDGET_MS && stored < MAX_PER_RUN) {
      const after = (acct.backfill_after ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)).replace(/-/g, '/')
      const page = await gmail.list(`after:${after} -in:chats`, pageToken, PAGE)
      stored += await storeMessages(db, gmail, ctx, (page.messages ?? []).map((m) => m.id), true)
      pageToken = page.nextPageToken
      done = !pageToken
      await db.from('mail_accounts').update({ backfill_page_token: pageToken ?? null, backfill_done: done }).eq('organization_id', org)
    }

    await db.from('mail_accounts').update({
      last_sync_at: new Date().toISOString(), last_error: null, sync_started_at: null, messages_synced: acct.messages_synced + stored,
    }).eq('organization_id', org)
    return { org, stored, backfill_done: done, ms: Date.now() - started }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from('mail_accounts').update({ last_error: message.slice(0, 1000), last_error_at: new Date().toISOString(), sync_started_at: null, messages_synced: acct.messages_synced + stored }).eq('organization_id', org)
    return { org, stored, error: message }
  }
}

interface Context { org: string; mailbox: string; internal: Set<string>; staff: Set<string>; index: VendorIndex; labelNames: Map<string, string> }

async function loadContext(db: SupabaseClient, acct: Account, labelNames: Map<string, string>): Promise<Context> {
  const vendors: { id: string; name: string; aliases: string[] }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('vendors').select('id, name, aliases').eq('organization_id', acct.organization_id).eq('is_active', true).range(from, from + 999)
    if (error) throw new Error(error.message)
    vendors.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const { data: org } = await db.from('organizations').select('name').eq('id', acct.organization_id).single()
  // Staff write from personal addresses too (billing.slsports@gmail.com): those are us, never a sender.
  const { data: people } = await db.from('profiles').select('email').eq('organization_id', acct.organization_id)
  const staff = new Set((people ?? []).map((p) => (p.email as string).toLowerCase()))
  // Our own names appear in every email (signatures, addresses); they are never a vendor clue.
  const ours = ['Shaver Lake', org?.name ?? ''].filter(Boolean)
  return { org: acct.organization_id, mailbox: acct.mailbox.toLowerCase(), internal: new Set(acct.internal_domains.map((d) => d.toLowerCase())), staff, index: buildVendorIndex(vendors, ours), labelNames }
}

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? ''

/** in = from outside; out = from us to someone outside; internal = only us. The other party is who the mail is with. */
function classify(ctx: Context, p: ParsedMessage): { direction: 'in' | 'out' | 'internal'; party: Address | null } {
  const ours = (a: Address) => a.email === ctx.mailbox || ctx.staff.has(a.email) || ctx.internal.has(domainOf(a.email))
  const fromUs = !p.from || ours(p.from) || p.label_ids.includes('SENT')
  if (!fromUs) return { direction: 'in', party: p.from }
  const outside = [...p.to, ...p.cc].find((a) => !ours(a))
  return outside ? { direction: 'out', party: outside } : { direction: 'internal', party: null }
}

async function fetchAll(gmail: Gmail, ids: string[], format: 'full' | 'minimal'): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += PARALLEL) {
    const batch = await Promise.all(ids.slice(i, i + PARALLEL).map((id) => gmail.message(id, format).catch((e) => {
      if (e instanceof GmailError && e.status === 404) return null // deleted since it was listed
      throw e
    })))
    out.push(...batch.filter((m): m is Record<string, unknown> => m !== null))
  }
  return out
}

async function storeMessages(db: SupabaseClient, gmail: Gmail, ctx: Context, ids: string[], backfill: boolean): Promise<number> {
  const unique = [...new Set(ids)]
  if (!unique.length) return 0
  const { data: have } = await db.from('emails').select('gmail_id').eq('organization_id', ctx.org).in('gmail_id', unique)
  const known = new Set((have ?? []).map((r) => r.gmail_id))
  const todo = unique.filter((id) => !known.has(id))
  if (!todo.length) return 0
  const parsed = (await fetchAll(gmail, todo, 'full')).map((m) => parseMessage(m as unknown as GmailMessage))
  // Gmail drafts and chats are not mail.
  const msgs = parsed.filter((p) => !p.label_ids.includes('DRAFT') && !p.label_ids.includes('CHAT'))
  if (!msgs.length) return 0

  // Senders: the other party's domain, or the whole address for free mail.
  const rows = msgs.map((p) => {
    const { direction, party } = classify(ctx, p)
    const domain = party ? domainOf(party.email) : ''
    const free = FREEMAIL.has(domain)
    return { p, direction, party, senderKey: party ? (free ? party.email : domain) : null, isDomain: !free }
  })
  const senderRows = new Map<string, { organization_id: string; sender_key: string; is_domain: boolean; display_name: string | null; domain_vendor_ids: string[] }>()
  for (const r of rows) {
    if (!r.senderKey || senderRows.has(r.senderKey)) continue
    senderRows.set(r.senderKey, {
      organization_id: ctx.org, sender_key: r.senderKey, is_domain: r.isDomain, display_name: r.party?.name ?? null,
      domain_vendor_ids: r.isDomain ? domainVendors(ctx.index, r.senderKey) : [],
    })
  }
  const senderIds = new Map<string, string>()
  if (senderRows.size) {
    const keys = [...senderRows.keys()]
    await check(db.from('email_senders').upsert([...senderRows.values()], { onConflict: 'organization_id,sender_key', ignoreDuplicates: true }))
    const { data } = await db.from('email_senders').select('id, sender_key').eq('organization_id', ctx.org).in('sender_key', keys)
    for (const s of data ?? []) senderIds.set(s.sender_key, s.id)
  }

  const threadKeys = [...new Set(msgs.map((p) => p.gmail_thread_id))]
  await check(db.from('email_threads').upsert(threadKeys.map((t) => ({ organization_id: ctx.org, gmail_thread_id: t })), { onConflict: 'organization_id,gmail_thread_id', ignoreDuplicates: true }))
  const threadIds = new Map<string, string>()
  for (let i = 0; i < threadKeys.length; i += 200) {
    const { data } = await db.from('email_threads').select('id, gmail_thread_id').eq('organization_id', ctx.org).in('gmail_thread_id', threadKeys.slice(i, i + 200))
    for (const t of data ?? []) threadIds.set(t.gmail_thread_id, t.id)
  }

  const emailRows = rows.map(({ p, direction, senderKey }) => ({
    organization_id: ctx.org,
    gmail_id: p.gmail_id,
    thread_id: threadIds.get(p.gmail_thread_id)!,
    message_id_header: p.message_id_header,
    in_reply_to: p.in_reply_to,
    direction,
    from_email: p.from?.email ?? null,
    from_name: p.from?.name ?? null,
    to_emails: p.to.map((a) => a.email),
    cc_emails: p.cc.map((a) => a.email),
    subject: p.subject,
    snippet: p.snippet,
    body_text: p.body_text,
    received_at: p.received_at,
    labels: p.label_ids.map((id) => ctx.labelNames.get(id) ?? id),
    has_attachments: p.attachments.length > 0,
    sender_id: senderKey ? senderIds.get(senderKey) ?? null : null,
    mentioned_vendor_ids: mentionedVendors(ctx.index, clueText(p)),
  }))
  const { data: inserted, error } = await db.from('emails').upsert(emailRows, { onConflict: 'organization_id,gmail_id', ignoreDuplicates: true }).select('id, gmail_id')
  if (error) throw new Error(`Saving mail: ${error.message}`)
  const idOf = new Map((inserted ?? []).map((r) => [r.gmail_id, r.id]))

  const attachments = rows.flatMap(({ p }) => idOf.has(p.gmail_id) ? p.attachments.map((a) => ({ ...a, organization_id: ctx.org, email_id: idOf.get(p.gmail_id)! })) : [])
  if (attachments.length) await check(db.from('email_attachments').insert(attachments))

  const newIds = [...idOf.values()]
  if (newIds.length) await check(db.rpc('mail_process', { p_org: ctx.org, p_email_ids: newIds, p_backfill: backfill }))
  return newIds.length
}

/** Labels changed in Gmail (Assigned/<name>, stars): keep ours in step. */
async function updateLabels(db: SupabaseClient, gmail: Gmail, ctx: Context, ids: string[]) {
  if (!ids.length) return
  for (const m of await fetchAll(gmail, ids.slice(0, 200), 'minimal')) {
    const labels = ((m.labelIds as string[] | undefined) ?? []).map((id) => ctx.labelNames.get(id) ?? id)
    await db.from('emails').update({ labels }).eq('organization_id', ctx.org).eq('gmail_id', m.id as string)
  }
}

async function check(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) throw new Error(error.message)
}
