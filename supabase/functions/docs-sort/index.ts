// docs-sort: the bulk import's "Ask Claude" step. POST { files: [{ key, path, storage_path?, mime? }] }
// (up to 5) with the signed-in user's token; admins, managers and buyers. For each file Claude reads the
// Dropbox path and, for a PDF or picture already uploaded to the import folder, the file itself, and says
// vendor, folder and year. The vendor name is matched to VMS vendors here; a person confirms every row.
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { readDocumentPlace, readScannedPdf } from '../_shared/ai.ts'
import { freightIndex } from '../_shared/freight.ts'
import { shipperVendors } from '../_shared/mailMatch.ts'

const MAX_READ_BYTES = 8 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const me = await caller(req, db, true)
    if (!Deno.env.get('ANTHROPIC_API_KEY')) throw new HttpError(503, 'Claude is not set up for this organization')
    const { files, mode } = await req.json() as { mode?: 'scan'; files?: { key: string; path: string; storage_path?: string | null; mime?: string | null }[] }

    // Scanned paper (Dana, Oct 9): one PDF at a time, split into its documents, each with vendor and details.
    if (mode === 'scan') {
      const f = files?.[0]
      if (!f?.storage_path || !f.storage_path.startsWith(`${me.organization_id}/import/`)) throw new HttpError(400, 'Upload the scan first')
      const { data, error } = await db.storage.from('vendor-files').download(f.storage_path)
      if (error || !data) throw new Error(error?.message ?? 'File not found')
      if (data.size > 30 * 1024 * 1024) throw new HttpError(413, 'Scans up to 30 MB; split bigger ones')
      const r = await readScannedPdf(db, me.organization_id, new Uint8Array(await data.arrayBuffer()), String(f.path).slice(0, 500))
      const index = await freightIndex(db, me.organization_id)
      return json({ key: f.key, documents: r.documents.map((d) => {
        const ids = d.vendor_name ? shipperVendors(index, d.vendor_name) : []
        return { ...d, vendor_id: ids.length === 1 ? ids[0] : null }
      }) })
    }
    if (!Array.isArray(files) || !files.length || files.length > 5) throw new HttpError(400, 'Send 1 to 5 files')
    const index = await freightIndex(db, me.organization_id)
    const results = []
    for (const f of files) {
      try {
        let bytes: Uint8Array | null = null
        const readable = f.mime === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(f.mime ?? '')
        if (f.storage_path && readable) {
          if (!f.storage_path.startsWith(`${me.organization_id}/import/`)) throw new HttpError(403, 'Not an import file')
          const { data, error } = await db.storage.from('vendor-files').download(f.storage_path)
          if (error || !data) throw new Error(error?.message ?? 'File not found')
          if (data.size <= MAX_READ_BYTES) bytes = new Uint8Array(await data.arrayBuffer())
        }
        const r = await readDocumentPlace(db, me.organization_id, { path: String(f.path).slice(0, 500), mime: f.mime ?? null, bytes })
        const ids = r?.vendor_name ? shipperVendors(index, r.vendor_name) : []
        results.push({ key: f.key, vendor_name: r?.vendor_name ?? null, vendor_id: ids.length === 1 ? ids[0] : null, folder: r?.folder ?? null, year: r?.year ?? null, sure: !!r?.sure && ids.length === 1 })
      } catch (err) {
        results.push({ key: f.key, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return json({ results })
  } catch (e) {
    return errorResponse(e)
  }
})
