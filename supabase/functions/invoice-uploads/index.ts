// invoice-uploads: reads what store staff submit on Invoice Uploads (Dana, Oct 20). Called by the database when an upload
// is waiting (and every minute by pg_cron while one is), header x-cron-secret. For each upload, oldest first:
//   1. read  — Claude (the scanned-paper reader): split the file into its invoices; for each its vendor, folder, number,
//              date, total and the store it is for, as printed
//   2. split — a stack becomes one PDF per invoice, saved in the uploader's folder (they see each one)
//   3. place — invoice_upload_place: the vendor by name, the store by the vendor's Invoice alias or our store names,
//              filed to the vendor's Documents once (same vendor and number on file: "Already submitted by …"), else a
//              Needs a look card in Review › Needs a hand. Bill.com sends follow from the filing (vendor_links_billcom).
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { CORS, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, readScannedPdf } from '../_shared/ai.ts'
import { freightIndex } from '../_shared/freight.ts'
import { shipperVendors } from '../_shared/mailMatch.ts'

const TIME_BUDGET_MS = 110_000
const MAX_BYTES = 30 * 1024 * 1024

interface Upload { id: string; organization_id: string; uploaded_by: string; storage_path: string; file_name: string; attempts: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)) return json({ error: 'Not allowed' }, 403)
    if (!aiEnabled()) return json({ skipped: 'Claude is not set up' })
    const db = serviceClient()
    const started = Date.now()
    const done: unknown[] = []
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data: u, error } = await db.rpc('invoice_upload_claim')
      if (error) throw new Error(error.message)
      const up = u as Upload | null
      if (!up?.id) break
      try {
        done.push({ id: up.id, ...(await readUpload(db, up)) })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await db.from('invoice_uploads').update({ status: up.attempts >= 3 ? 'failed' : 'queued', note: msg.slice(0, 500) }).eq('id', up.id)
        done.push({ id: up.id, error: msg })
      }
    }
    return json({ done })
  } catch (e) {
    return errorResponse(e)
  }
})

async function readUpload(db: ReturnType<typeof serviceClient>, up: Upload) {
  // a read that stopped after saving its invoices: place what is left, never read it twice
  const { data: had } = await db.from('invoice_upload_docs').select('id, status').eq('upload_id', up.id)
  if (had?.length) {
    for (const d of had.filter((x) => x.status === 'needs_look')) await db.rpc('invoice_upload_place', { p_doc: d.id })
    await db.from('invoice_uploads').update({ status: 'done', read_at: new Date().toISOString(), note: null }).eq('id', up.id)
    return { documents: had.length, resumed: true }
  }
  const { data: file, error } = await db.storage.from('vendor-files').download(up.storage_path)
  if (error || !file) throw new Error(`Could not open the file: ${error?.message ?? 'missing'}`)
  if (file.size > MAX_BYTES) throw new Error('Files up to 30 MB; split bigger ones')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Not a PDF')
  const reading = await readScannedPdf(db, up.organization_id, bytes, `Scanned at our store and uploaded: ${up.file_name}`.slice(0, 500))
  const docs = reading.documents
  if (!docs.length) {
    await db.from('invoice_uploads').update({ status: 'done', read_at: new Date().toISOString(), note: 'Claude found nothing to read' }).eq('id', up.id)
    return { documents: 0 }
  }
  const index = await freightIndex(db, up.organization_id)
  const src = docs.length > 1 ? await PDFDocument.load(bytes, { ignoreEncryption: true }) : null
  const pages = src?.getPageCount() ?? 0
  const folder = up.storage_path.slice(0, up.storage_path.lastIndexOf('/'))
  const placed: string[] = []
  for (const [k, d] of docs.entries()) {
    let path = up.storage_path
    if (src) {
      // one file per invoice in a stack
      const first = Math.max(1, Math.min(d.first_page, pages))
      const last = Math.max(first, Math.min(d.last_page, pages))
      const part = await PDFDocument.create()
      const copied = await part.copyPages(src, Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i))
      copied.forEach((p) => part.addPage(p))
      path = `${folder}/${up.id}-${k + 1}.pdf`
      const { error: upErr } = await db.storage.from('vendor-files').upload(path, await part.save(), { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error(`Could not save page ${first}: ${upErr.message}`)
    }
    const ids = d.vendor_name ? shipperVendors(index, d.vendor_name) : []
    const date = d.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(d.doc_date) ? d.doc_date : null
    const { data: row, error: insErr } = await db.from('invoice_upload_docs').insert({
      organization_id: up.organization_id, upload_id: up.id, first_page: d.first_page, last_page: d.last_page, storage_path: path,
      vendor_name_read: d.vendor_name, store_read: d.store_name, folder: d.folder, doc_number: d.invoice_number, doc_date: date,
      doc_total: d.total, sure: d.sure, vendor_id: ids.length === 1 ? ids[0] : null,
    }).select('id').single()
    if (insErr || !row) throw new Error(insErr?.message ?? 'Could not save what Claude read')
    const { data: res, error: placeErr } = await db.rpc('invoice_upload_place', { p_doc: row.id })
    if (placeErr) throw new Error(placeErr.message)
    placed.push(String(res))
  }
  await db.from('invoice_uploads').update({ status: 'done', read_at: new Date().toISOString(), note: null }).eq('id', up.id)
  return { documents: docs.length, placed }
}
