import { supabase } from '@/lib/supabase'
import { checkUploadSize, readForUpload, uploadError } from '@/lib/upload'
import type { AccountingCategory, AccountingDocument } from '@/types'
import type { TablesUpdate } from '@/types/database'

// Accounting documents (Dana, Oct 16): every paper that comes to billing@, filed by Claude into Category / Party / Year
// under a name by the convention, plus files dropped on the Documents page. The bytes live in the accounting-files
// bucket; the folder and the name live on the row, so a move or rename never copies a file.

const BUCKET = 'accounting-files'

export interface DocumentFolder { category: AccountingCategory; party: string; doc_year: number; n: number; review_n: number }

export async function listDocumentFolders(organizationId: string): Promise<DocumentFolder[]> {
  const { data, error } = await supabase.rpc('accounting_document_folders', { p_org: organizationId })
  if (error) throw error
  return (data ?? []) as DocumentFolder[]
}

export interface DocumentFilters { category?: string; party?: string; year?: number; status?: 'review'; q?: string }

export async function listDocuments(organizationId: string, f: DocumentFilters, limit = 500): Promise<AccountingDocument[]> {
  let q = supabase.from('accounting_documents').select('*').eq('organization_id', organizationId).neq('status', 'new')
  if (f.category) q = q.eq('category', f.category as AccountingCategory)
  if (f.party) q = q.eq('party', f.party)
  if (f.year) q = q.eq('doc_year', f.year)
  if (f.status) q = q.eq('status', f.status)
  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)
    q = q.or(`file_name.ilike.%${term}%,party.ilike.%${term}%,number.ilike.%${term}%,what.ilike.%${term}%,original_name.ilike.%${term}%`)
  }
  const { data, error } = await q.order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}

export async function listDocumentsFor(where: { policy_id?: string; contract_id?: string; email_id?: string; ids?: string[] }): Promise<AccountingDocument[]> {
  let q = supabase.from('accounting_documents').select('*').neq('status', 'new')
  if (where.policy_id) q = q.eq('policy_id', where.policy_id)
  else if (where.contract_id) q = q.eq('contract_id', where.contract_id)
  else if (where.email_id) q = q.eq('email_id', where.email_id)
  else if (where.ids) { if (!where.ids.length) return []; q = q.in('id', where.ids) }
  const { data, error } = await q.order('doc_date', { ascending: false, nullsFirst: false }).limit(200)
  if (error) throw error
  return data ?? []
}

export async function countDocuments(organizationId: string): Promise<{ filed: number; review: number }> {
  const [a, b] = await Promise.all([
    supabase.from('accounting_documents').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'filed'),
    supabase.from('accounting_documents').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'review'),
  ])
  if (a.error) throw a.error
  if (b.error) throw b.error
  return { filed: a.count ?? 0, review: b.count ?? 0 }
}

/** How many emails in the accounting mailbox still wait for the filing step (it runs every minute, newest first). */
export async function countUnfiledEmails(mailboxId: string): Promise<number> {
  const { count, error } = await supabase.from('emails').select('id', { count: 'exact', head: true }).eq('mailbox_id', mailboxId).eq('has_attachments', true).is('accounting_filed_at', null)
  if (error) throw error
  return count ?? 0
}

export async function updateDocument(id: string, patch: TablesUpdate<'accounting_documents'>): Promise<AccountingDocument> {
  const { data, error } = await supabase.from('accounting_documents').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

/** The row and the file go together; the email it came from keeps its attachment. */
export async function deleteDocument(doc: Pick<AccountingDocument, 'id' | 'storage_path'>): Promise<void> {
  const { error } = await supabase.from('accounting_documents').delete().eq('id', doc.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([doc.storage_path])
}

export async function downloadDocument(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw error
  return data
}

export async function documentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

async function sha256Hex(blob: Blob): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type DropResult = { status: 'filed'; document: AccountingDocument } | { status: 'already'; document: AccountingDocument }

/**
 * The drop box: the file goes into the bucket, a "new" row is made, and the filing function reads it and names it.
 * The same bytes already on file are reported, never saved twice (Dana, Oct 14).
 */
export async function dropDocument(organizationId: string, userId: string, file: File, hint: string | null, onStep?: (step: 'uploading' | 'reading') => void): Promise<DropResult> {
  checkUploadSize(file)
  onStep?.('uploading')
  const blob = await readForUpload(file)
  const sha = await sha256Hex(blob)
  const { data: same } = await supabase.from('accounting_documents').select('*').eq('organization_id', organizationId).eq('sha256', sha).maybeSingle()
  if (same) return { status: 'already', document: same }
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(file.name)?.[1] ?? 'bin').toLowerCase()
  const path = `${organizationId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: file.type || 'application/octet-stream', upsert: false }).catch((e: unknown) => ({ error: e }))
  if (upErr) throw uploadError(upErr, file)
  const { data: row, error } = await supabase.from('accounting_documents').insert({
    organization_id: organizationId, doc_year: new Date().getFullYear(), file_name: file.name, original_name: file.name, storage_path: path, mime_type: file.type || null, size: file.size, sha256: sha,
    source: 'upload', uploaded_by: userId, status: 'new',
  }).select('id').single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  onStep?.('reading')
  const { data, error: fnErr } = await supabase.functions.invoke('accounting-file', { body: { document_id: row.id, hint } })
  if (fnErr) throw new Error(await functionError(fnErr))
  if (data?.error) throw new Error(data.error)
  return { status: 'filed', document: data as AccountingDocument }
}

export interface FilingRun { mailbox: string; emails: number; filed: number; skipped: number; linked: number; errors: number; left: number }

/** A slice of the queue now ("File now"); the scheduler does the same every minute. */
export async function runFiling(): Promise<FilingRun[]> {
  const { data, error } = await supabase.functions.invoke('accounting-file', { body: {} })
  if (error) throw new Error(await functionError(error))
  if (data?.error) throw new Error(data.error)
  return (data ?? []) as FilingRun[]
}

export interface FilingResult { filed: number; skipped: number; linked: number; errors: number; results: { attachment_id: string; document_id?: string; skip?: string; error?: string }[] }

/** This email's attachments now (the conversation page). */
export async function fileEmailNow(emailId: string): Promise<FilingResult> {
  const { data, error } = await supabase.functions.invoke('accounting-file', { body: { email_id: emailId } })
  if (error) throw new Error(await functionError(error))
  if (data?.error) throw new Error(data.error)
  return data as FilingResult
}

/** One attachment, filed even when the filing step left it in the email ("File in Accounting"). */
export async function fileAttachmentNow(attachmentId: string): Promise<FilingResult> {
  const { data, error } = await supabase.functions.invoke('accounting-file', { body: { attachment_id: attachmentId, force: true } })
  if (error) throw new Error(await functionError(error))
  if (data?.error) throw new Error(data.error)
  return data as FilingResult
}

async function functionError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try { const b = await ctx.json(); if (b?.error) return String(b.error) } catch { /* no body */ }
  }
  return err instanceof Error ? err.message : String(err)
}
