// freight-read: read a freight bill's PDF with Claude after a person added it (PartnerShip bills come without
// the PDF; Trevor downloads it from their site and drops it on the bill), or read one again.
// POST { bill_id } with the signed-in user's token. Admins, managers and buyers. With the cron secret (header
// x-cron-secret): { bill_ids: [...] } reads those bills again (a back-check after the reader learns something new).
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { readStoredBill } from '../_shared/freight.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const cronSecret = Deno.env.get('MAIL_CRON_SECRET')
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      const { bill_ids } = await req.json() as { bill_ids?: string[] }
      const out: unknown[] = []
      for (const id of (bill_ids ?? []).slice(0, 20)) out.push({ id, ...(await readStoredBill(db, id)) })
      return json({ read: out })
    }
    const me = await caller(req, db, true)
    if (!Deno.env.get('ANTHROPIC_API_KEY')) throw new HttpError(503, 'Claude is not set up for this organization')
    const { bill_id } = await req.json() as { bill_id?: string }
    if (!bill_id) throw new HttpError(400, 'bill_id is required')
    const { data: bill } = await db.from('freight_bills').select('id, organization_id').eq('id', bill_id).single()
    if (!bill || bill.organization_id !== me.organization_id) throw new HttpError(404, 'Freight bill not found')
    const r = await readStoredBill(db, bill_id)
    return json(r, r.ok ? 200 : 422)
  } catch (e) {
    return errorResponse(e)
  }
})
