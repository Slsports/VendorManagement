// freight-read: read a freight bill's PDF with Claude after a person added it (PartnerShip bills come without
// the PDF; Trevor downloads it from their site and drops it on the bill), or read one again.
// POST { bill_id } with the signed-in user's token. Admins, managers and buyers.
import { CORS, caller, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { readStoredBill } from '../_shared/freight.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
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
