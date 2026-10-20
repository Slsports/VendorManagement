import { supabase } from '@/lib/supabase'
import { checkUploadSize, uploadError } from '@/lib/upload'

const BUCKET = 'vendor-files'

export interface UploadDoc {
  id: string; upload_id: string; first_page: number | null; last_page: number | null; storage_path: string
  vendor_name_read: string | null; store_read: string | null; folder: string | null; doc_number: string | null; doc_date: string | null; doc_total: number | null
  vendor_id: string | null; vendor_name: string | null; store_code: string | null; status: 'filed' | 'needs_look' | 'duplicate' | 'set_aside'
  reason: string | null; duplicate_note: string | null; billcom_sent_at: string | null; filed_at: string | null
}
export interface UploadRow {
  id: string; uploaded_by: string; uploaded_on: string; storage_path: string; file_name: string; page_count: number | null
  status: 'queued' | 'reading' | 'done' | 'failed' | 'duplicate'; note: string | null; created_at: string
  docs: UploadDoc[]
}

const UPLOAD_SELECT = 'id, uploaded_by, uploaded_on, storage_path, file_name, page_count, status, note, created_at, docs:invoice_upload_docs(id, upload_id, first_page, last_page, storage_path, vendor_name_read, store_read, folder, doc_number, doc_date, doc_total, vendor_id, vendor_name, store_code, status, reason, duplicate_note, billcom_sent_at, filed_at)'

/** My uploads, newest first (Dana, Oct 20: "they should only see what they uploaded"). */
export async function listMyUploads(profileId: string, limit = 200): Promise<UploadRow[]> {
  const { data, error } = await supabase.from('invoice_uploads').select(UPLOAD_SELECT).eq('uploaded_by', profileId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as UploadRow[]).map((u) => ({ ...u, docs: [...u.docs].sort((a, b) => (a.first_page ?? 0) - (b.first_page ?? 0)) }))
}

/** Put the finished PDF in my upload folder and send it on. Returns the note when the same file was already sent. */
export async function submitUpload(organizationId: string, profileId: string, file: File, hash: string, pages: number): Promise<{ id: string; duplicate?: string }> {
  checkUploadSize(file)
  const path = `${organizationId}/uploads/${profileId}/${crypto.randomUUID()}.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false }).catch((e: unknown) => ({ error: e }))
  if (error) throw uploadError(error, file)
  const { data, error: rpcErr } = await supabase.rpc('invoice_upload_submit', { p_path: path, p_name: file.name, p_size: file.size, p_hash: hash, p_pages: pages })
  if (rpcErr) throw rpcErr
  return data as { id: string; duplicate?: string }
}

/** One upload's invoice, for the Needs a look card. */
export async function getUploadDoc(id: string): Promise<(UploadDoc & { upload: { uploaded_on: string; uploader: { full_name: string } | null } | null }) | null> {
  const { data, error } = await supabase.from('invoice_upload_docs')
    .select('*, upload:invoice_uploads!invoice_upload_docs_upload_id_fkey(uploaded_on, uploader:profiles!invoice_uploads_uploaded_by_fkey(full_name))').eq('id', id).maybeSingle()
  if (error) throw error
  return data as unknown as (UploadDoc & { upload: { uploaded_on: string; uploader: { full_name: string } | null } | null }) | null
}

/** File it with the vendor, store and folder picked (the store becomes the vendor's Invoice alias), or set it aside. */
export async function resolveUploadDoc(id: string, input: { vendorId: string | null; store: string | null; folder: string | null; action?: 'file' | 'set_aside' }): Promise<string> {
  const { data, error } = await supabase.rpc('invoice_upload_resolve', { p_doc: id, p_vendor: input.vendorId as string, p_store: input.store as string, p_folder: input.folder as string, p_action: input.action ?? 'file' })
  if (error) throw error
  return data as string
}

/** A link to look at an uploaded file (mine, or any for the office). */
export async function uploadFileUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60)
  if (error) throw error
  return data.signedUrl
}
