import { supabase } from '@/lib/supabase'
import type { MatchVendor } from '@/lib/bulkImport'
import type { VendorLink } from '@/types'

const BUCKET = 'vendor-files'
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_')

/** Every vendor with its aliases, for matching Dropbox folder names. Inactive ones too (old files). */
export async function listVendorsForMatching(organizationId: string): Promise<MatchVendor[]> {
  const out: MatchVendor[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('vendors').select('id, name, aliases, is_active').eq('organization_id', organizationId).order('name').range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as MatchVendor[]))
    if (!data || data.length < 1000) break
  }
  return out
}

/** "<vendor>|<file name>|<size>" for every stored document, to skip files already in VMS. */
export async function listExistingDocKeys(organizationId: string): Promise<Set<string>> {
  const keys = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('vendor_links').select('vendor_id, file_name, file_size').eq('organization_id', organizationId).not('storage_path', 'is', null).range(from, from + 999)
    if (error) throw error
    for (const d of data ?? []) if (d.vendor_id && d.file_name) keys.add(docKey(d.vendor_id, d.file_name, d.file_size))
    if (!data || data.length < 1000) break
  }
  return keys
}

export const docKey = (vendorId: string, fileName: string, size: number | null) => `${vendorId}|${fileName.toLowerCase()}|${size ?? ''}`

/** Upload a file to the organization's import folder (before Claude reads it, or when filing). */
export async function stageImportFile(organizationId: string, file: File): Promise<string> {
  const path = `${organizationId}/import/${crypto.randomUUID()}-${safeName(file.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw error
  return path
}

export async function removeStagedFiles(paths: string[]): Promise<void> {
  if (!paths.length) return
  await supabase.storage.from(BUCKET).remove(paths)
}

export interface ClaudePlace { key: string; vendor_name?: string | null; vendor_id?: string | null; folder?: string | null; year?: number | null; sure?: boolean; error?: string }

/** Claude reads up to five files (path, and the file itself for PDFs and pictures already staged). */
export async function askClaudeWhere(files: { key: string; path: string; storage_path: string | null; mime: string | null }[]): Promise<ClaudePlace[]> {
  const { data, error } = await supabase.functions.invoke('docs-sort', { body: { files } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(body?.error ?? (error instanceof Error ? error.message : String(error)))
  }
  return (data as { results: ClaudePlace[] }).results
}

export interface ScanDocument { first_page: number; last_page: number; vendor_name: string | null; vendor_id: string | null; folder: string; invoice_number: string | null; doc_date: string | null; total: number | null; sure: boolean }

/** A scanned PDF (already staged): Claude splits it into its documents and reads each. */
export async function askClaudeScan(file: { key: string; path: string; storage_path: string }): Promise<ScanDocument[]> {
  const { data, error } = await supabase.functions.invoke('docs-sort', { body: { mode: 'scan', files: [file] } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(body?.error ?? (error instanceof Error ? error.message : String(error)))
  }
  return (data as { documents: ScanDocument[] }).documents
}

/** File one imported document into a vendor's folder and year, with what Claude read from a scan. */
export async function fileImportedDocument(input: {
  organizationId: string; vendorId: string; kind: VendorLink['kind']; year: number; originalPath: string; storagePath: string; file: File; userId: string | null
  details?: { number: string | null; date: string | null; total: number | null }
}): Promise<void> {
  const d = input.details
  const label = d?.number ? `${input.kind === 'credit' ? 'Credit' : input.kind === 'packing_slip' ? 'Packing slip' : 'Invoice'} ${d.number}` : input.file.name.replace(/\.[a-z0-9]{2,5}$/i, '')
  const { error } = await supabase.from('vendor_links').insert({
    doc_number: d?.number ?? null, doc_date: d?.date ?? null, doc_total: d?.total ?? null,
    organization_id: input.organizationId, vendor_id: input.vendorId, kind: input.kind, label,
    storage_path: input.storagePath, file_name: input.file.name, file_size: input.file.size, mime_type: input.file.type || null,
    received_at: d?.date ?? new Date(input.file.lastModified).toISOString().slice(0, 10), doc_year: input.year, source: 'import',
    notes: `Imported from ${input.originalPath}`.slice(0, 1000), created_by: input.userId,
  })
  if (error) throw error
}
