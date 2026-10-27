// dropbox: Dana's Dropbox read (Dana, Oct 26). The admin connects once (PKCE sign-in, the refresh token stays in
// dropbox_connections), names one folder, and VMS lists every file in it (the dry run). Claude then says what each file
// is: a vendor paper (which vendor, what kind, its numbers) or a bookkeeping paper, by VMS's own rules and never by the
// Dropbox folder name. Nothing is filed until Dana approves; leftovers stay on one grouped list. In 'inbox' mode (after
// the history is done) new scans are filed on their own and moved to a Filed subfolder.
//   { action: 'status' }                                        → what Settings shows (never a token)
//   { action: 'save_app_key', app_key }                         → the Dropbox app's key (made once in Dropbox's App Console)
//   { action: 'authorize' }                                     → the Dropbox sign-in address to send the admin to
//   { action: 'exchange', code, state }                         → finish the sign-in
//   { action: 'folders', path? }                                → subfolders, for the folder picker
//   { action: 'set_folder', folder_path, mode, move_filed }     → which folder VMS reads and how
//   { action: 'scan' }                                          → list more of the folder now (the scheduler does the same)
//   { action: 'rescan' }                                        → list the folder again from the start
//   { action: 'reading', on }                                   → start or stop Claude reading the listed files
//   { action: 'read' }                                          → read a few files now
//   { action: 'apply' }                                         → file what is approved, now
//   { action: 'preview', id }                                   → the file's bytes, to look at it inside VMS
//   { action: 'disconnect' }
//   { action: 'sync' } with the scheduler's secret              → every organization: scan, read, apply, inbox filing
//   { action: 'peek' } with the scheduler's secret              → what the folder holds at the top and how the listing pages out (for a cloud session)
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, readAccountingPapers, sortDropboxPaper, type AccountingFileCtx, type DropboxSortReading } from '../_shared/ai.ts'
import { ACCOUNTING_BUCKET, DOC, JUNK, MAX_KEEP_BYTES, MAX_READ_BYTES, PICTURE, SHEET, cleanReading, extOf, knownContext, paperFile, rowFromReading, sha256 } from '../_shared/accountingFiling.ts'
import { buildVendorIndex, mentionedVendors, type VendorIndex } from '../_shared/mailMatch.ts'
import { docxText } from '../_shared/docxText.ts'
import { readStoredBill } from '../_shared/freight.ts'

const DBX_AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize'
const DBX_TOKEN = 'https://api.dropboxapi.com/oauth2/token'
const DBX_API = 'https://api.dropboxapi.com/2'
const DBX_CONTENT = 'https://content.dropboxapi.com/2'
const REDIRECT = 'https://vms.shaverlakesports.com/integrations/dropbox/callback'
const SCOPES = 'account_info.read files.metadata.read files.content.read files.content.write'
const TIME_BUDGET_MS = 40_000
const READ_PER_RUN = 25
const APPLY_PER_RUN = 15
const VENDOR_BUCKET = 'vendor-files'
// The edge worker has little memory (every run died with WORKER_RESOURCE_LIMIT on a big file, Oct 26): a spreadsheet over
// 2 MB or any file over 5 MB is not opened; Claude sorts it by its name and folder, and it is saved as it is when approved.
const MAX_SHEET_BYTES = 2 * 1024 * 1024

interface Conn {
  organization_id: string; app_key: string | null; refresh_token: string | null; access_token: string | null; access_token_at: string | null
  account_name: string | null; account_email: string | null; folder_path: string | null; folder_path_lower: string | null; mode: 'history' | 'inbox'; move_filed: boolean
  cursor: string | null; scan_done: boolean; reading: boolean; run_lock_at: string | null; oauth_state: string | null; oauth_state_at: string | null; code_verifier: string | null
  connected_at: string | null; connected_by: string | null; last_scan_at: string | null; last_read_at: string | null; last_error: string | null
}
interface DbxEntry { '.tag': 'file' | 'folder' | 'deleted'; id?: string; name: string; path_lower?: string; path_display?: string; size?: number; content_hash?: string; client_modified?: string; server_modified?: string }
interface FileRow {
  id: string; organization_id: string; dropbox_id: string; path_lower: string; path_display: string; name: string; folder: string; size: number | null; content_hash: string | null; modified_at: string | null
  status: string; target: 'vendor' | 'line' | 'rep' | 'freight' | 'accounting' | 'skip' | null; vendor_id: string | null; line_id: string | null; rep_group_id: string | null; freight_bill_id: string | null; carrier_id: string | null; kind: string | null; doc_year: number | null; doc_number: string | null; doc_date: string | null; doc_total: number | null; po_number: string | null
  accounting: Record<string, unknown> | null; vendor_said: string | null; sure: boolean | null; note: string | null; sha256: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = serviceClient()
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; app_key?: string; code?: string; state?: string; path?: string; folder_path?: string; mode?: string; move_filed?: boolean; on?: boolean }
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    const trusted = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (trusted) {
      // a look at the folder from a cloud session (which cannot reach Dropbox itself): what is at the top, and how the recursive listing pages out
      if (body.action === 'peek') {
        const { data: cs } = await db.from('dropbox_connections').select('*').not('refresh_token', 'is', null).limit(1)
        const c = (cs ?? [])[0] as Conn | undefined
        if (!c?.folder_path_lower) throw new HttpError(400, 'No folder')
        const top = await api<{ entries: DbxEntry[]; has_more: boolean }>(db, c, 'files/list_folder', { path: c.folder_path_lower, recursive: false, limit: 2000 })
        const pages: { entries: number; files: number; folders: number; has_more: boolean }[] = []
        let cursor: string | null = null
        for (let i = 0; i < 12; i++) {
          const page: { entries: DbxEntry[]; cursor: string; has_more: boolean } = cursor
            ? await api(db, c, 'files/list_folder/continue', { cursor })
            : await api(db, c, 'files/list_folder', { path: c.folder_path_lower, recursive: true, include_deleted: false, include_non_downloadable_files: false, limit: 1000 })
          pages.push({ entries: page.entries.length, files: page.entries.filter((e) => e['.tag'] === 'file').length, folders: page.entries.filter((e) => e['.tag'] === 'folder').length, has_more: page.has_more })
          cursor = page.cursor
          if (!page.has_more) break
        }
        return json({ folder: c.folder_path, top: top.entries.map((e) => `${e['.tag']}: ${e.name}`), top_has_more: top.has_more, pages })
      }
      if (body.action !== 'sync') throw new HttpError(400, 'Unknown action')
      const { data: conns } = await db.from('dropbox_connections').select('*').not('refresh_token', 'is', null).not('folder_path', 'is', null)
      const out: unknown[] = []
      for (const c of (conns ?? []) as Conn[]) out.push(await syncOrg(db, c).catch((e) => ({ organization_id: c.organization_id, error: e instanceof Error ? e.message : String(e) })))
      return json(out)
    }

    const me = await caller(req, db)
    const org = me.organization_id
    if (me.role !== 'admin') throw new HttpError(403, 'Only the admin connects Dropbox')
    const started = Date.now()

    if (body.action === 'save_app_key') {
      const key = String(body.app_key ?? '').trim()
      if (key.length < 10 || /\s/.test(key)) throw new HttpError(400, 'Paste the App key from the Dropbox App Console')
      const { error } = await db.from('dropbox_connections').upsert({ organization_id: org, app_key: key, last_error: null, updated_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      return json(await status(db, org))
    }
    if (body.action === 'authorize') {
      const c = await conn(db, org, false)
      if (!c.app_key) throw new HttpError(400, 'Save the App key first')
      const verifier = randomString(64), state = randomString(24)
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
      await db.from('dropbox_connections').update({ oauth_state: state, oauth_state_at: new Date().toISOString(), code_verifier: verifier }).eq('organization_id', org)
      const url = `${DBX_AUTHORIZE}?${new URLSearchParams({ client_id: c.app_key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: REDIRECT, state, scope: SCOPES })}`
      return json({ url })
    }
    if (body.action === 'exchange') {
      const c = await conn(db, org, false)
      const fresh = c.oauth_state_at && Date.now() - new Date(c.oauth_state_at).getTime() < 30 * 60_000
      if (!body.state || body.state !== c.oauth_state || !fresh || !c.code_verifier || !c.app_key) throw new HttpError(400, 'This sign-in link is old. Click Connect to Dropbox again.')
      const t = await tokenRequest({ grant_type: 'authorization_code', code: String(body.code ?? ''), client_id: c.app_key, code_verifier: c.code_verifier, redirect_uri: REDIRECT })
      if (!t.refresh_token || !t.access_token) throw new Error('Dropbox sent no token')
      await db.from('dropbox_connections').update({ refresh_token: t.refresh_token, access_token: t.access_token, access_token_at: new Date().toISOString(), oauth_state: null, code_verifier: null, connected_at: new Date().toISOString(), connected_by: me.id, last_error: null, updated_at: new Date().toISOString() }).eq('organization_id', org)
      try {
        const acct = await api<{ name?: { display_name?: string }; email?: string }>(db, { ...c, refresh_token: t.refresh_token, access_token: t.access_token, access_token_at: new Date().toISOString() }, 'users/get_current_account', null)
        await db.from('dropbox_connections').update({ account_name: acct.name?.display_name ?? null, account_email: acct.email ?? null }).eq('organization_id', org)
      } catch (e) {
        await db.from('dropbox_connections').update({ last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', org)
      }
      return json(await status(db, org))
    }
    if (body.action === 'disconnect') {
      await db.from('dropbox_connections').update({ refresh_token: null, access_token: null, access_token_at: null, account_name: null, account_email: null, connected_at: null, reading: false, updated_at: new Date().toISOString() }).eq('organization_id', org)
      return json(await status(db, org))
    }
    if (body.action === 'folders') {
      const c = await conn(db, org)
      const path = String(body.path ?? '')
      const r = await api<{ entries: DbxEntry[] }>(db, c, 'files/list_folder', { path: path === '/' ? '' : path, recursive: false, include_deleted: false, limit: 500 })
      return json({ path, folders: r.entries.filter((e) => e['.tag'] === 'folder').map((e) => ({ name: e.name, path: e.path_display ?? e.path_lower ?? '' })).sort((a, b) => a.name.localeCompare(b.name)) })
    }
    if (body.action === 'set_folder') {
      const c = await conn(db, org)
      const path = String(body.folder_path ?? '').trim().replace(/\/+$/, '')
      if (!path.startsWith('/')) throw new HttpError(400, 'Pick a folder')
      const meta = await api<DbxEntry>(db, c, 'files/get_metadata', { path })
      if (meta['.tag'] !== 'folder') throw new HttpError(400, 'That is not a folder')
      const mode = body.mode === 'inbox' ? 'inbox' : 'history'
      // a different folder: the old folder's unfiled list goes (what was filed or linked stays as the record of where it came from)
      if (c.folder_path_lower && c.folder_path_lower !== (meta.path_lower ?? path.toLowerCase())) await db.from('dropbox_files').delete().eq('organization_id', org).in('status', ['new', 'skipped', 'proposed', 'leftover', 'error'])
      await db.from('dropbox_connections').update({ folder_path: meta.path_display ?? path, folder_path_lower: meta.path_lower ?? path.toLowerCase(), mode, move_filed: mode === 'inbox' && !!body.move_filed, cursor: null, scan_done: false, last_error: null, updated_at: new Date().toISOString() }).eq('organization_id', org)
      return json(await status(db, org))
    }
    if (body.action === 'rescan') {
      await db.from('dropbox_connections').update({ cursor: null, scan_done: false, updated_at: new Date().toISOString() }).eq('organization_id', org)
      const c = await conn(db, org)
      const r = await scan(db, c, started)
      return json({ ...(await status(db, org)), scan: r })
    }
    if (body.action === 'scan') {
      const c = await conn(db, org)
      const r = await scan(db, c, started)
      return json({ ...(await status(db, org)), scan: r })
    }
    if (body.action === 'reading') {
      await db.from('dropbox_connections').update({ reading: !!body.on, updated_at: new Date().toISOString() }).eq('organization_id', org)
      return json(await status(db, org))
    }
    if (body.action === 'read') {
      const c = await conn(db, org)
      const r = await readFiles(db, c, started)
      return json({ ...(await status(db, org)), read: r })
    }
    if (body.action === 'preview') {
      // the file itself, shown inside VMS (Dana, Oct 27: "I want to view them, not download them"; Dropbox's own links download)
      const c = await conn(db, org)
      const { data: f } = await db.from('dropbox_files').select('dropbox_id, name, size').eq('organization_id', org).eq('id', String((body as { id?: string }).id ?? '')).maybeSingle()
      if (!f) throw new HttpError(404, 'File not found')
      if ((f.size ?? 0) > MAX_KEEP_BYTES) throw new HttpError(413, 'This file is over 15 MB; open it in Dropbox')
      const bytes = await download(db, c, f.dropbox_id)
      // as a plain byte stream: the app's function client hands any other type back as text, which scrambles PDFs and Word files (Oct 27)
      return new Response(bytes as unknown as BodyInit, { headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `inline; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"` } })
    }
    if (body.action === 'apply') {
      const c = await conn(db, org)
      const r = await applyApproved(db, c, started)
      return json({ ...(await status(db, org)), apply: r })
    }
    return json(await status(db, org))
  } catch (e) {
    return errorResponse(e)
  }
})

// ---- connection and Dropbox calls -------------------------------------------------------------------------------------
async function conn(db: SupabaseClient, org: string, needToken = true): Promise<Conn> {
  const { data } = await db.from('dropbox_connections').select('*').eq('organization_id', org).maybeSingle()
  if (!data) throw new HttpError(400, 'Save the App key first')
  if (needToken && !data.refresh_token) throw new HttpError(400, 'Connect to Dropbox first')
  return data as Conn
}

async function status(db: SupabaseClient, org: string) {
  const { data: c } = await db.from('dropbox_connections').select('*').eq('organization_id', org).maybeSingle()
  const { data: counts } = await db.rpc('dropbox_folder_summary', { p_org: org })
  const sum = (k: string) => ((counts ?? []) as Record<string, number>[]).reduce((n, r) => n + Number(r[k] ?? 0), 0)
  return {
    set_up: !!c?.app_key, app_key: c?.app_key ? `${c.app_key.slice(0, 4)}…` : null, connected: !!c?.refresh_token, connected_at: c?.connected_at ?? null,
    account_name: c?.account_name ?? null, account_email: c?.account_email ?? null, folder_path: c?.folder_path ?? null, mode: c?.mode ?? 'history', move_filed: !!c?.move_filed,
    scan_done: !!c?.scan_done, reading: !!c?.reading, last_scan_at: c?.last_scan_at ?? null, last_read_at: c?.last_read_at ?? null, last_error: c?.last_error ?? null, redirect_uri: REDIRECT,
    files: { total: sum('total'), new: sum('new_count'), proposed: sum('proposed'), sure_proposed: sum('sure_proposed'), leftover: sum('leftover'), approved: sum('approved'), filed: sum('filed'), linked: sum('linked'), skipped: sum('skipped'), errors: sum('errors') },
  }
}

async function tokenRequest(form: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch(DBX_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`Dropbox sign-in failed (${res.status}): ${String(data.error_description ?? data.error ?? text).slice(0, 200)}`)
  return data as { access_token?: string; refresh_token?: string; expires_in?: number }
}

/** A fresh access token (Dropbox's last about 4 hours). */
async function accessToken(db: SupabaseClient, c: Conn, force = false): Promise<string> {
  const fresh = c.access_token && c.access_token_at && Date.now() - new Date(c.access_token_at).getTime() < 3.5 * 3600_000
  if (fresh && !force) return c.access_token!
  if (!c.refresh_token || !c.app_key) throw new HttpError(400, 'Connect to Dropbox first')
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.app_key })
  if (!t.access_token) throw new Error('Dropbox sent no access token')
  c.access_token = t.access_token; c.access_token_at = new Date().toISOString()
  await db.from('dropbox_connections').update({ access_token: c.access_token, access_token_at: c.access_token_at }).eq('organization_id', c.organization_id)
  return c.access_token
}

async function api<T>(db: SupabaseClient, c: Conn, path: string, body: unknown, retry = true): Promise<T> {
  const token = await accessToken(db, c)
  const res = await fetch(`${DBX_API}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === null ? {} : { 'Content-Type': 'application/json' }) }, body: body === null ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (res.status === 401 && retry) { await accessToken(db, c, true); return api<T>(db, c, path, body, false) }
  if (res.status === 429 && retry) { await new Promise((r) => setTimeout(r, 3000)); return api<T>(db, c, path, body, false) }
  if (!res.ok) throw new Error(`Dropbox ${path} failed (${res.status}): ${dbxError(text)}`)
  return JSON.parse(text) as T
}

function dbxError(text: string): string {
  try {
    const d = JSON.parse(text) as { error_summary?: string; error?: { '.tag'?: string } }
    return (d.error_summary ?? d.error?.['.tag'] ?? text).slice(0, 200)
  } catch { return text.slice(0, 200) }
}

async function download(db: SupabaseClient, c: Conn, id: string, retry = true): Promise<Uint8Array> {
  const token = await accessToken(db, c)
  const res = await fetch(`${DBX_CONTENT}/files/download`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: id }) } })
  if (res.status === 401 && retry) { await accessToken(db, c, true); return download(db, c, id, false) }
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status}): ${dbxError(await res.text())}`)
  return new Uint8Array(await res.arrayBuffer())
}

const randomString = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return base64url(b).slice(0, n) }
const base64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// ---- the dry run: list the folder ------------------------------------------------------------------------------------------
/** The subfolder a file sits in, under the folder VMS reads, as Dropbox shows it; '' at the top. */
function subfolder(c: Conn, pathDisplay: string): string {
  const root = (c.folder_path ?? '').replace(/\/+$/, '')
  const rel = pathDisplay.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? pathDisplay.slice(root.length + 1) : pathDisplay.replace(/^\//, '')
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

/** List more of the folder (a page or more per run) into dropbox_files; files already listed with the same bytes are left as they are. */
async function scan(db: SupabaseClient, c: Conn, started: number): Promise<{ listed: number; has_more: boolean }> {
  if (!c.folder_path_lower) throw new HttpError(400, 'Pick a folder first')
  let listed = 0, hasMore = true
  try {
    while (hasMore && Date.now() - started < TIME_BUDGET_MS) {
      const page = c.cursor
        ? await api<{ entries: DbxEntry[]; cursor: string; has_more: boolean }>(db, c, 'files/list_folder/continue', { cursor: c.cursor })
        : await api<{ entries: DbxEntry[]; cursor: string; has_more: boolean }>(db, c, 'files/list_folder', { path: c.folder_path_lower, recursive: true, include_deleted: false, include_non_downloadable_files: false, limit: 1000 })
      const files = page.entries.filter((e) => e['.tag'] === 'file' && e.id && e.path_lower)
      if (files.length) {
        const ids = files.map((e) => e.id!)
        const { data: have } = await db.from('dropbox_files').select('dropbox_id, content_hash, status').eq('organization_id', c.organization_id).in('dropbox_id', ids)
        const known = new Map((have ?? []).map((h) => [h.dropbox_id, h]))
        const rows = files.flatMap((e) => {
          const k = known.get(e.id!)
          const filed = k && ['filed', 'linked', 'approved'].includes(k.status)
          if (k && (k.content_hash === (e.content_hash ?? null) || filed)) return []       // same bytes, or already dealt with
          const pd = e.path_display ?? e.path_lower!
          const skip = preSkip(e.name, e.size ?? 0)
          return [{
            organization_id: c.organization_id, dropbox_id: e.id!, path_lower: e.path_lower!, path_display: pd, name: e.name, folder: subfolder(c, pd), size: e.size ?? null, content_hash: e.content_hash ?? null,
            modified_at: e.client_modified ?? e.server_modified ?? null, status: skip ? 'skipped' : 'new', skip_reason: skip, target: null, vendor_id: null, kind: null, accounting: null, sure: null, note: null, error: null, sha256: null, read_at: null, updated_at: new Date().toISOString(),
          }]
        })
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await db.from('dropbox_files').upsert(rows.slice(i, i + 200), { onConflict: 'organization_id,dropbox_id' })
          if (error) throw new Error(error.message)
        }
        listed += rows.length
      }
      // in inbox mode a file deleted or moved out of the folder is forgotten unless VMS already filed it
      for (const e of page.entries) if (e['.tag'] === 'deleted' && e.path_lower) await db.from('dropbox_files').delete().eq('organization_id', c.organization_id).eq('path_lower', e.path_lower).in('status', ['new', 'skipped', 'proposed', 'leftover', 'error'])
      c.cursor = page.cursor; hasMore = page.has_more
      await db.from('dropbox_connections').update({ cursor: c.cursor, scan_done: !hasMore, last_scan_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('organization_id', c.organization_id)
    }
  } catch (e) {
    await db.from('dropbox_connections').update({ last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('organization_id', c.organization_id)
    throw e
  }
  return { listed, has_more: hasMore }
}

/** Why a file is not even read: not a document, or too big to keep. Null when Claude should look. */
function preSkip(name: string, size: number): string | null {
  if (size > MAX_KEEP_BYTES) return 'too big to keep (over 15 MB)'
  if (size === 0) return 'empty file'
  if (JUNK.test(name) || /\.(ds_store|ini|lnk|url|exe|dmg|app|mov|mp4|mp3|wav|pptx?|key|numbers|pages)$/i.test(name) || name.startsWith('.') || name.startsWith('~$')) return 'not a document'
  if (/\.doc$/i.test(name)) return 'old Word .doc file: save it as .docx or PDF to read it'
  if (!PICTURE.test(name) && !SHEET.test(name) && !DOC.test(name)) return 'not a document'
  return null
}

// ---- reading: what each file is and where it would go ---------------------------------------------------------------------
const KIND_OF: Record<DropboxSortReading['doc_type'], string> = {
  invoice: 'invoice', statement: 'invoice', payment: 'payment', credit: 'credit', confirmation: 'confirmation', packing_slip: 'packing_slip', order: 'order', price_list: 'price_list', catalog: 'catalog', order_form: 'order_form', specials: 'specials', proof: 'proof', report: 'sales_report', tax_form: 'other', other: 'other',
}

async function vendorIndex(db: SupabaseClient, org: string): Promise<{ index: VendorIndex; names: string[]; byName: Map<string, string>; wwd: Set<string>; repKeys: Set<string>; repGroups: { id: string; name: string; keys: string[] }[] }> {
  const { data } = await db.from('vendors').select('id, name, aliases').eq('organization_id', org).eq('is_active', true).is('merged_into_id', null).order('name').limit(5000)
  const vendors = (data ?? []) as { id: string; name: string; aliases: string[] | null }[]
  const wwd = new Set(vendors.filter((v) => /^worldwide( distributors)?$/i.test(v.name.trim())).map((v) => v.id))
  // rep groups and rep agencies are never the vendor (an email to Donna is not Esco Trading's paper, Oct 26)
  const { data: reps } = await db.from('rep_groups').select('id, name').eq('organization_id', org).eq('is_active', true).limit(500)
  const repGroups = (reps ?? []).map((r) => ({ id: r.id, name: r.name, keys: r.name.split(/\s*[/,&]\s*/).map(squeeze).filter((k: string) => k.length >= 4) }))
  const repKeys = new Set(repGroups.flatMap((r) => r.keys))
  return { index: buildVendorIndex(vendors.map((v) => ({ id: v.id, name: v.name, aliases: v.aliases ?? [] }))), names: vendors.map((v) => v.name), byName: new Map(vendors.map((v) => [v.name.toLowerCase(), v.id])), wwd, repKeys, repGroups }
}

/** Read a few listed files: each becomes linked (already on file), proposed (Claude is sure where it goes), leftover (unsure) or skipped. */
async function readFiles(db: SupabaseClient, c: Conn, started: number): Promise<{ read: number; proposed: number; leftover: number; linked: number; skipped: number; errors: number }> {
  if (!aiEnabled()) throw new HttpError(503, 'Claude is not set up')
  const org = c.organization_id
  const out = { read: 0, proposed: 0, leftover: 0, linked: 0, skipped: 0, errors: 0 }
  // a file the worker died on (claimed, never finished) goes to Dana's list after ten minutes rather than staying an error
  await db.from('dropbox_files').update({ status: 'leftover', target: 'skip', sure: false, error: null, note: 'VMS could not open this file (the reader stopped on it). Open it yourself: if it matters, save it as PDF and drop it on the vendor\'s Documents.', updated_at: new Date().toISOString() })
    .eq('organization_id', org).eq('status', 'error').like('error', 'The reader stopped%').lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString())
  const { data: queue } = await db.from('dropbox_files').select('*').eq('organization_id', org).eq('status', 'new').order('modified_at', { ascending: false, nullsFirst: false }).limit(READ_PER_RUN)
  if (!queue?.length) return out
  const vendors = await vendorIndex(db, org)
  let known: Awaited<ReturnType<typeof knownContext>> | null = null
  for (const f of queue as FileRow[]) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const stamp = { read_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null as string | null }
    // claimed first (only if still new, so two runs never read the same file): if the worker dies on this file, the row says so instead of being tried every minute
    const { data: claimed } = await db.from('dropbox_files').update({ status: 'error', error: 'The reader stopped on this file (it may be too big to open); it is tried again later', updated_at: stamp.updated_at }).eq('id', f.id).eq('status', 'new').select('id')
    if (!claimed?.length) continue
    try {
      // a stub of a file (68-byte "PDFs" from a sync that never finished) is nothing to read
      if ((f.size ?? 0) < 300) { await db.from('dropbox_files').update({ ...stamp, status: 'skipped', target: 'skip', skip_reason: 'empty or unfinished file (under 300 bytes)' }).eq('id', f.id); out.skipped++; continue }
      const mime = mimeOf(f.name)
      // the same name and size already under a vendor (Dana, Oct 14: never a second copy): link, never read
      const { data: sameVen } = await db.from('vendor_links').select('id, vendor_id').eq('organization_id', org).ilike('file_name', f.name.replace(/[%_\\]/g, (ch) => `\\${ch}`)).eq('file_size', f.size ?? -1).not('storage_path', 'is', null).limit(1)
      if (sameVen?.[0]) { await db.from('dropbox_files').update({ ...stamp, status: 'linked', error: null, vendor_link_id: sameVen[0].id, vendor_id: sameVen[0].vendor_id, target: 'vendor', note: 'Already in the vendor\'s Documents' }).eq('id', f.id); out.linked++; continue }
      // the same file in two Dropbox folders (Dropbox's own content hash): one copy is enough
      if (f.content_hash) {
        const { data: twin } = await db.from('dropbox_files').select('id, path_display, status').eq('organization_id', org).eq('content_hash', f.content_hash).neq('id', f.id).in('status', ['proposed', 'approved', 'filed', 'linked', 'leftover']).limit(1)
        if (twin?.[0]) { await db.from('dropbox_files').update({ ...stamp, status: 'linked', target: 'skip', note: `The same file as ${twin[0].path_display}; that copy is the one filed` }).eq('id', f.id); out.linked++; continue }
      }
      const tooBig = (f.size ?? 0) > MAX_READ_BYTES || (SHEET.test(f.name) && (f.size ?? 0) > MAX_SHEET_BYTES)
      const bytes = tooBig ? new Uint8Array() : await download(db, c, f.dropbox_id)
      const sha = tooBig ? null : await sha256(bytes)
      if (sha) {
        const { data: sameAcc } = await db.from('accounting_documents').select('id').eq('organization_id', org).eq('sha256', sha).maybeSingle()
        if (sameAcc) { await db.from('dropbox_files').update({ ...stamp, status: 'linked', error: null, sha256: sha, accounting_document_id: sameAcc.id, target: 'accounting', note: 'Already in Accounting Documents' }).eq('id', f.id); out.linked++; continue }
      }
      // a .docx goes in as its words (Claude reads PDFs, pictures and text); one with no words is nothing to file
      const docx = !tooBig && /\.docx$/i.test(f.name) ? await docxText(bytes) : null
      if (!tooBig && /\.docx$/i.test(f.name) && !docx) { await db.from('dropbox_files').update({ ...stamp, status: 'skipped', error: null, sha256: sha, target: 'skip', skip_reason: 'Word file with no readable text' }).eq('id', f.id); out.skipped++; continue }
      const file = docx ? { name: f.name, mime, bytes: new Uint8Array(), text: docx } : tooBig ? { name: f.name, mime, bytes: new Uint8Array() } : await paperFile(f.name, mime, bytes)
      const bigNote = tooBig ? 'Too big to open here: sorted by its name and folder only.' : ''
      const answer = await sortDropboxPaper(db, org, vendors.names, file, { folder: f.folder, path: f.path_display })
      const sorted: typeof answer = answer.about === 'report' ? { ...answer, about: 'vendor', doc_type: 'report' } : answer
      out.read++
      if (sorted.about === 'skip') {
        await db.from('dropbox_files').update({ ...stamp, status: 'skipped', sha256: sha, target: 'skip', skip_reason: (sorted.skip_reason || 'not a paper to keep').slice(0, 120), note: [bigNote, sorted.note].filter(Boolean).join(' ').slice(0, 400) }).eq('id', f.id); out.skipped++; continue
      }
      const year = yearOf(sorted.doc_date) ?? yearOf(f.modified_at) ?? new Date().getFullYear()
      const paper = { sha256: sha, vendor_said: (sorted.vendor ?? '').slice(0, 120) || null, kind: KIND_OF[sorted.doc_type] ?? 'other', doc_year: year, doc_number: sorted.doc_number?.slice(0, 60) ?? null, doc_date: dateOf(sorted.doc_date), doc_total: sorted.total, po_number: sorted.po_number?.slice(0, 60) ?? null }
      if (sorted.about === 'freight') {
        // a carrier's bill: fill the bill in VMS waiting for this PDF (same invoice number); else a new bill for that
        // carrier, read like a dropped PDF so its shipments land on their vendors (Dana, Oct 27); unknown carrier: Dana decides
        const bill = await waitingFreightBill(db, org, sorted.doc_number)
        const carrier = bill ? null : await matchCarrier(db, org, sorted.vendor)
        const note = [bigNote, bill ? `Freight bill: fills the ${bill.carrier} bill ${bill.invoice_number} waiting for its PDF.` : carrier ? `Freight bill from ${carrier.name}: becomes a new bill on the Freight page, read for which vendor shipped.` : `Freight bill from ${sorted.vendor ?? 'a carrier'}: that carrier is not in VMS yet (Freight › Carriers).`, sorted.note].filter(Boolean).join(' ').slice(0, 400)
        const ok = !!bill || !!carrier
        await db.from('dropbox_files').update({ ...stamp, ...paper, target: 'freight', freight_bill_id: bill?.id ?? null, carrier_id: carrier?.id ?? null, sure: ok && (!!bill || sorted.sure), status: ok ? 'proposed' : 'leftover', note }).eq('id', f.id)
        if (ok) out.proposed++; else out.leftover++
        continue
      }
      if (sorted.about === 'vendor' && isRep(vendors, sorted.vendor)) {
        // a paper about the rep (show info, a buyer letter, a line list): under the rep group (Dana, Oct 27)
        const rep = matchRepGroup(vendors, sorted.vendor)
        const kind = ['invoice', 'confirmation', 'order', 'packing_slip', 'credit', 'payment', 'proof'].includes(KIND_OF[sorted.doc_type] ?? '') ? 'other' : (KIND_OF[sorted.doc_type] ?? 'other')
        await db.from('dropbox_files').update({ ...stamp, ...paper, target: 'rep', vendor_id: null, rep_group_id: rep?.id ?? null, kind, sure: !!rep && sorted.sure, status: rep ? 'proposed' : 'leftover', note: [bigNote, rep ? `About the rep: goes under the rep group ${rep.name}.` : `About a rep (${sorted.vendor}) VMS has no rep group for: pick one, or the vendor it concerns.`, sorted.note].filter(Boolean).join(' ').slice(0, 400) }).eq('id', f.id)
        if (rep) out.proposed++; else out.leftover++
        continue
      }
      if (sorted.about === 'vendor') {
        const vendorId = matchVendor(vendors, sorted, f)
        if (vendorId && vendors.wwd.has(vendorId)) {
          // Worldwide's own paperwork (payment sheets, exports, portal guides) is handled on the Payments page, never filed under a vendor (Dana, Oct 19)
          await db.from('dropbox_files').update({ ...stamp, ...paper, target: 'vendor', vendor_id: vendorId, sure: false, status: 'leftover', note: `Worldwide's own paperwork: handled on the Payments page, not filed under a vendor. ${sorted.note}`.slice(0, 400) }).eq('id', f.id)
          out.leftover++; continue
        }
        const line = vendorId ? null : await matchLine(db, org, sorted.vendor)
        const target = vendorId ? 'vendor' : line ? 'line' : 'vendor'
        const base = { ...stamp, ...paper, target, vendor_id: vendorId, line_id: line?.id ?? null, sure: sorted.sure && !tooBig && !!(vendorId || line) }
        const note = [bigNote, sorted.doc_type === 'statement' ? 'A statement: goes to Invoices.' : '', sorted.doc_type === 'tax_form' ? 'The vendor\'s tax form: goes to Other.' : '', line ? `"${line.name}" is a line (a catalog name), not a vendor yet: goes under the line.` : '', !vendorId && !line ? `Vendor not found in VMS: "${sorted.vendor ?? '?'}".` : '', sorted.note].filter(Boolean).join(' ').slice(0, 400)
        if (!vendorId && !line) { await db.from('dropbox_files').update({ ...base, status: 'leftover', note }).eq('id', f.id); out.leftover++ } else { await db.from('dropbox_files').update({ ...base, status: 'proposed', note }).eq('id', f.id); out.proposed++ }
        continue
      }
      // a service company that is a vendor in VMS (Terminix, Verizon …): its papers live under the vendor (Dana, Oct 26: one place)
      const serviceVendor = sorted.vendor ? matchVendor(vendors, { ...sorted, vendor_match: null }, f) : null
      if (serviceVendor && !vendors.wwd.has(serviceVendor)) {
        const kind = sorted.doc_type === 'other' ? 'invoice' : (KIND_OF[sorted.doc_type] ?? 'invoice')
        await db.from('dropbox_files').update({ ...stamp, ...paper, target: 'vendor', vendor_id: serviceVendor, kind, sure: sorted.sure, status: 'proposed', note: [bigNote, 'A service company that is a vendor in VMS: goes under the vendor.', sorted.note].filter(Boolean).join(' ').slice(0, 400) }).eq('id', f.id)
        out.proposed++; continue
      }
      // a bookkeeping paper: the accounting reader gives the folder and the name pieces
      known ??= await knownContext(db, org)
      const ctx: AccountingFileCtx = { from: null, from_name: null, direction: 'upload', subject: f.name, received_on: (f.modified_at ?? new Date().toISOString()).slice(0, 10), email_text: null, contact: null, hint: `From Dropbox folder ${f.folder || '(top)'}`, ...known }
      const [raw] = await readAccountingPapers(db, org, ctx, [file])
      if (!raw) throw new Error('Claude gave no answer for this file')
      const r = cleanReading({ ...raw, keep: true }, known, Number(ctx.received_on.slice(0, 4)))
      const sure = r.sure && !!r.party && !tooBig
      await db.from('dropbox_files').update({ ...stamp, sha256: sha, target: 'accounting', accounting: r as unknown as Record<string, unknown>, doc_year: r.doc_year, doc_number: r.number || null, doc_date: dateOf(r.doc_date), doc_total: r.amount, sure, status: sure ? 'proposed' : 'leftover', note: [bigNote, sorted.note, r.note].filter(Boolean).join(' ').slice(0, 400) }).eq('id', f.id)
      if (sure) out.proposed++; else out.leftover++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // a file Claude cannot open (a locked or odd PDF): Dana's list, not an error to retry
      if (/invalid_request_error|could not process|PDF specified was not valid|cannot be empty|Could not parse/i.test(msg)) {
        await db.from('dropbox_files').update({ read_at: stamp.read_at, updated_at: stamp.updated_at, status: 'leftover', target: 'skip', sure: false, error: null, note: 'VMS could not open this file (Claude could not read it). Open it yourself: if it matters, save it as a plain PDF and drop it on the vendor\'s Documents.' }).eq('id', f.id)
        out.leftover++; continue
      }
      await db.from('dropbox_files').update({ read_at: stamp.read_at, updated_at: stamp.updated_at, status: 'error', error: msg.slice(0, 300) }).eq('id', f.id)
      out.errors++
    }
  }
  await db.from('dropbox_connections').update({ last_read_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('organization_id', org)
  return out
}

/** The printed name is a rep group or rep agency (Dandylines, Diverse Marketing, a rep's name), not a vendor. */
function isRep(v: Awaited<ReturnType<typeof vendorIndex>>, said: string | null): boolean {
  const key = squeeze(said ?? '')
  if (!key) return false
  if (/dandylines|diversemarketing|diversemktg|repgroup|salesrep/.test(key)) return true
  for (const r of v.repKeys) if (key === r || key.startsWith(r) || r.startsWith(key)) return true
  return false
}

/** The rep group a rep's paper belongs to, by any part of its name (Dandylines, Diverse Marketing). */
function matchRepGroup(v: Awaited<ReturnType<typeof vendorIndex>>, said: string | null): { id: string; name: string } | null {
  const key = squeeze(said ?? '')
  if (key.length < 4) return null
  const hits = v.repGroups.filter((r) => r.keys.some((k) => key === k || key.startsWith(k) || k.startsWith(key) || key.includes(k)))
  return hits.length === 1 ? { id: hits[0]!.id, name: hits[0]!.name } : null
}

/** The one vendor the paper is about: Claude's pick from the known list, else the names VMS knows found in what it printed. */
function matchVendor(v: Awaited<ReturnType<typeof vendorIndex>>, sorted: DropboxSortReading, f: FileRow): string | null {
  const picked = sorted.vendor_match ? v.byName.get(sorted.vendor_match.trim().toLowerCase()) ?? null : null
  if (picked) return picked
  const said = (sorted.vendor ?? '').trim()
  if (!said) return null
  const hits = mentionedVendors(v.index, { strong: said, body: `${f.name} ${f.folder}` })
  if (hits.length === 1) return hits[0]!
  if (hits.length) return null
  // "Mountain Milk" for MOUNTAIN MILK & CREAM: the printed name is the start of exactly one vendor's name (or the other way round)
  const key = squeeze(said)
  if (key.length < 5) return null
  const starts = [...v.byName.entries()].filter(([name]) => { const k = squeeze(name); return k.startsWith(key) || key.startsWith(k) }).map(([, id]) => id)
  return new Set(starts).size === 1 ? starts[0]! : null
}

/** The one line (catalog name in vendor_directory) with this name, Inc/LLC and punctuation aside; null when none or several. */
async function matchLine(db: SupabaseClient, org: string, said: string | null): Promise<{ id: string; name: string } | null> {
  const key = squeeze(said ?? '')
  if (key.length < 3) return null
  const first = (said ?? '').trim().split(/\s+/)[0]!.replace(/[^A-Za-z0-9]/g, '')
  if (first.length < 2) return null
  const { data } = await db.from('vendor_directory').select('id, name').eq('organization_id', org).ilike('name', `%${first}%`).limit(80)
  // the same name listed twice ("Top Trenz" and "Top Trenz Inc") is one line: the shortest name wins
  const hits = (data ?? []).filter((l) => squeeze(l.name) === key).sort((a, b) => a.name.length - b.name.length)
  return hits[0] ?? null
}
const squeeze = (name: string) => name.toLowerCase().replace(/\b(inc|llc|ltd|co|corp|company|press|group)\b\.?/g, '').replace(/[^a-z0-9]+/g, '')

/** A freight bill in VMS still waiting for its PDF, by the invoice number printed on the paper. */
async function waitingFreightBill(db: SupabaseClient, org: string, invoice: string | null): Promise<{ id: string; invoice_number: string; carrier: string } | null> {
  const n = (invoice ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (n.length < 4) return null
  const { data } = await db.from('freight_bills').select('id, invoice_number, carriers(name)').eq('organization_id', org).eq('status', 'needs_pdf').not('invoice_number', 'is', null).limit(500)
  const hit = (data ?? []).find((b) => (b.invoice_number ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === n)
  return hit ? { id: hit.id, invoice_number: hit.invoice_number!, carrier: (hit.carriers as unknown as { name: string } | null)?.name ?? 'carrier' } : null
}

/** The carrier a bill is from, by the name printed (UPS, FedEx, PartnerShip …) against the carriers VMS knows and their aliases. */
async function matchCarrier(db: SupabaseClient, org: string, said: string | null): Promise<{ id: string; name: string } | null> {
  const key = squeeze(said ?? '')
  if (key.length < 2) return null
  const { data } = await db.from('carriers').select('id, name, aliases').eq('organization_id', org).eq('is_active', true).limit(200)
  const names = (c: { name: string; aliases: string[] | null }) => [c.name, ...(c.aliases ?? [])].map(squeeze)
  // "UPS" is UPS, not UPS DIRECT: an exact name wins; otherwise the one carrier whose name starts the printed one (or the other way round)
  const exact = (data ?? []).filter((c) => names(c).includes(key))
  if (exact.length === 1) return { id: exact[0]!.id, name: exact[0]!.name }
  const hits = (data ?? []).filter((c) => names(c).some((k) => k.length >= 3 && (key.startsWith(k) || k.startsWith(key))))
  return hits.length === 1 ? { id: hits[0]!.id, name: hits[0]!.name } : null
}

const yearOf = (d: string | null | undefined) => { const y = Number((d ?? '').slice(0, 4)); return y >= 1990 && y <= 2100 ? y : null }
const dateOf = (d: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? d! : null)
function mimeOf(name: string): string {
  const ext = extOf(name, null)
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

// ---- filing what Dana approved ------------------------------------------------------------------------------------------------
/** File the approved files: the bytes into VMS, the row under the vendor or in Accounting; in inbox mode, the Dropbox file moves to Filed. */
async function applyApproved(db: SupabaseClient, c: Conn, started: number): Promise<{ filed: number; errors: number }> {
  const org = c.organization_id
  const out = { filed: 0, errors: 0 }
  const { data: queue } = await db.from('dropbox_files').select('*').eq('organization_id', org).eq('status', 'approved').order('decided_at').limit(APPLY_PER_RUN)
  for (const f of (queue ?? []) as FileRow[]) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    try {
      const bytes = await download(db, c, f.dropbox_id)
      const mime = mimeOf(f.name)
      const safeName = f.name.replace(/[^A-Za-z0-9._-]+/g, '_')
      if ((f.target === 'vendor' && f.vendor_id) || (f.target === 'line' && f.line_id) || (f.target === 'rep' && f.rep_group_id)) {
        const owner = f.target === 'vendor' ? f.vendor_id! : f.target === 'line' ? `line-${f.line_id!}` : `rep-${f.rep_group_id!}`
        const path = `${org}/${owner}/${crypto.randomUUID()}-${safeName}`
        const { error: upErr } = await db.storage.from(VENDOR_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
        if (upErr) throw new Error(`Saving ${f.name}: ${upErr.message}`)
        const { data: link, error } = await db.from('vendor_links').insert({
          organization_id: org, vendor_id: f.target === 'vendor' ? f.vendor_id : null, line_id: f.target === 'line' ? f.line_id : null, rep_group_id: f.target === 'rep' ? f.rep_group_id : null, kind: f.kind ?? 'other', label: f.name.replace(/\.[a-z0-9]{2,5}$/i, ''), storage_path: path, file_name: f.name, file_size: bytes.length, mime_type: mime,
          received_at: f.doc_date ?? (f.modified_at ?? new Date().toISOString()).slice(0, 10), doc_year: f.doc_year, doc_number: f.doc_number, doc_date: f.doc_date, doc_total: f.doc_total,
          source: 'dropbox', dropbox_path: f.path_display, notes: `From Dropbox: ${f.path_display}${f.po_number ? ` · PO ${f.po_number}` : ''}`.slice(0, 300),
        }).select('id').single()
        if (error) { await db.storage.from(VENDOR_BUCKET).remove([path]); throw new Error(error.message) }
        await db.from('dropbox_files').update({ status: 'filed', vendor_link_id: link.id, filed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', f.id)
      } else if (f.target === 'freight' && (f.freight_bill_id || f.carrier_id)) {
        // the PDF a freight bill was waiting for goes onto that bill; otherwise a new bill for the carrier; then it is
        // read the way a dropped PDF is (its shipments onto the vendors that shipped them, a copy of a known bill dropped)
        const path = `${org}/freight/${crypto.randomUUID()}-${safeName}`
        const { error: upErr } = await db.storage.from(VENDOR_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
        if (upErr) throw new Error(`Saving ${f.name}: ${upErr.message}`)
        let billId = f.freight_bill_id
        if (billId) {
          const { data: bill } = await db.from('freight_bills').select('id, storage_path').eq('id', billId).maybeSingle()
          if (!bill) throw new Error('The freight bill is gone')
          if (bill.storage_path) throw new Error('The freight bill already has a PDF')
          const { error } = await db.from('freight_bills').update({ storage_path: path, file_name: f.name, status: 'reading', read_note: null }).eq('id', billId)
          if (error) throw new Error(error.message)
        } else {
          const { data: made, error } = await db.from('freight_bills').insert({ organization_id: org, carrier_id: f.carrier_id, invoice_number: f.doc_number, invoice_date: f.doc_date, total: f.doc_total, storage_path: path, file_name: f.name, status: 'reading' }).select('id').single()
          if (error) { await db.storage.from(VENDOR_BUCKET).remove([path]); throw new Error(error.message) }
          billId = made.id
        }
        const theBill: string = billId!
        await db.from('dropbox_files').update({ status: 'filed', freight_bill_id: theBill, filed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', f.id)
        const r = await readStoredBill(db, theBill).catch((e) => ({ ok: false, note: e instanceof Error ? e.message : String(e) }))
        if (!r.ok) await db.from('dropbox_files').update({ note: `Filed on the freight bill; reading it said: ${r.note ?? 'not read'}`.slice(0, 400) }).eq('id', f.id)
      } else if (f.target === 'accounting' && f.accounting) {
        const r = f.accounting as unknown as Parameters<typeof rowFromReading>[0]
        const ext = extOf(f.name, mime)
        const path = `${org}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await db.storage.from(ACCOUNTING_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
        if (upErr) throw new Error(`Saving ${f.name}: ${upErr.message}`)
        const { data: doc, error } = await db.from('accounting_documents').insert({
          organization_id: org, ...rowFromReading(r, (f.modified_at ?? new Date().toISOString()).slice(0, 10), ext), storage_path: path, mime_type: mime, size: bytes.length, sha256: f.sha256 ?? await sha256(bytes), original_name: f.name,
          source: 'dropbox', dropbox_path: f.path_display, email_id: null, attachment_id: null, contact_id: null, uploaded_by: null,
        }).select('id').single()
        if (error) { await db.storage.from(ACCOUNTING_BUCKET).remove([path]); throw new Error(error.message) }
        await db.from('dropbox_files').update({ status: 'filed', accounting_document_id: doc.id, filed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', f.id)
      } else {
        throw new Error('Nowhere to file it: no vendor or accounting reading')
      }
      out.filed++
      if (c.mode === 'inbox' && c.move_filed) await moveToFiled(db, c, f).catch((e) => console.error(`move ${f.path_display}:`, e instanceof Error ? e.message : e))
    } catch (e) {
      await db.from('dropbox_files').update({ status: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', f.id)
      out.errors++
    }
  }
  return out
}

/** Inbox mode: a filed scan moves to <folder>/Filed/<name> so Dana sees what is done. */
async function moveToFiled(db: SupabaseClient, c: Conn, f: FileRow) {
  const to = `${c.folder_path}/Filed/${f.name}`
  await api(db, c, 'files/move_v2', { from_path: f.dropbox_id, to_path: to, autorename: true, allow_shared_folder: true, allow_ownership_transfer: false })
}

// ---- the scheduler: every 2 minutes, every organization ------------------------------------------------------------------------------
async function syncOrg(db: SupabaseClient, c: Conn) {
  const started = Date.now()
  const r: Record<string, unknown> = { organization_id: c.organization_id, mode: c.mode }
  // one run at a time: a slice that runs long must not overlap the next minute's run (two workers, one memory limit)
  const { data: lock } = await db.from('dropbox_connections').update({ run_lock_at: new Date().toISOString() }).eq('organization_id', c.organization_id)
    .or(`run_lock_at.is.null,run_lock_at.lt.${new Date(Date.now() - 55_000).toISOString()}`).select('organization_id')
  if (!lock?.length) return { ...r, skipped: 'another run is going' }
  // inbox mode re-lists on every run (the cursor carries on from last time); history mode lists until it is done
  if (c.mode === 'inbox' || !c.scan_done) r.scan = await scan(db, c, started)
  // what Dana approved is filed before more is read: reading uses the whole time budget, and approvals sat unfiled (Oct 27)
  r.apply = await applyApproved(db, c, started)
  if (c.mode === 'inbox' || c.reading) r.read = await readFiles(db, c, started)
  if (c.mode === 'inbox') {
    // new scans: what Claude is sure about is filed on its own; the rest asks Dana with a task that opens this page
    await db.from('dropbox_files').update({ status: 'approved', decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('organization_id', c.organization_id).eq('status', 'proposed').eq('sure', true)
    const { data: left } = await db.from('dropbox_files').select('id, name').eq('organization_id', c.organization_id).eq('status', 'leftover').is('decided_at', null).limit(20)
    for (const f of left ?? []) {
      await db.from('tasks').insert({ organization_id: c.organization_id, title: `Where does this scan go: ${f.name}`.slice(0, 200), notes: 'VMS could not place it by itself. Open Settings › Dropbox to pick the vendor or folder, or skip it.', due_date: new Date().toISOString().slice(0, 10), remind_at: new Date().toISOString(), assigned_to: c.connected_by, created_by: c.connected_by, auto_key: `dropbox:${f.id}`, area: 'general' })
      await db.from('dropbox_files').update({ decided_at: new Date().toISOString() }).eq('id', f.id)
    }
  }
  r.apply_after = await applyApproved(db, c, started)
  return r
}
