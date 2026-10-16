// ls-inventory-count: a checklist's counts become an Inventory Count in Lightspeed's Inventory Counts module (Dana,
// Oct 16: "we want VMS to tell LS to create a new inventory count"), so missing items and shrinkage show in LS before
// she reconciles there. VMS never reconciles. Only a signed-in person with the "Send counts to LS" tick (or an admin).
//   { count_id, name? }   → creates the count (name, shop) and one InventoryCountItem per line with a total entered
import { CORS, HttpError, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { lsAccessToken, lsPost } from '../_shared/lightspeed.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: u } = await db.auth.getUser(jwt)
    if (!u.user) throw new HttpError(401, 'Not signed in')
    const { data: me } = await db.from('profiles').select('id, organization_id, role, is_active, sends_counts, full_name').eq('id', u.user.id).single()
    if (!me?.is_active) throw new HttpError(403, 'Not an active user')
    if (!me.sends_counts && me.role !== 'admin') throw new HttpError(403, 'Only people with the "Send counts to LS" tick send counts to Lightspeed')
    const body = await req.json() as { count_id?: string; name?: string }
    if (!body.count_id) throw new HttpError(400, 'Which checklist?')
    const { data: c } = await db.from('inventory_counts').select('*').eq('id', body.count_id).maybeSingle()
    if (!c || c.organization_id !== me.organization_id) throw new HttpError(404, 'Checklist not found')
    if (c.status === 'sent') throw new HttpError(409, `Already sent to Lightspeed on ${new Date(c.sent_at).toLocaleDateString()} as "${c.ls_count_name}"`)
    const { data: lines } = await db.from('inventory_count_lines').select('item_id, total, description').eq('count_id', c.id).not('total', 'is', null)
    const counted = (lines ?? []).filter((l) => Number.isFinite(Number(l.total)) && Number(l.total) >= 0)
    if (!counted.length) throw new HttpError(400, 'No counts entered yet')

    const { data: conn } = await db.from('lightspeed_connections').select('account_id').eq('organization_id', me.organization_id).maybeSingle()
    if (!conn?.account_id) throw new HttpError(400, 'Connect Lightspeed in Settings first')
    const { token } = await lsAccessToken(db, me.organization_id)
    const name = (body.name?.trim() || c.ls_count_name || c.title).slice(0, 120)
    let made: { InventoryCount?: { inventoryCountID?: string } }
    try {
      made = await lsPost<{ InventoryCount?: { inventoryCountID?: string } }>(token, `/Account/${conn.account_id}/InventoryCount.json`, { name, shopID: c.shop_id })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/403|401|not allowed|scope|permission/i.test(msg)) throw new HttpError(403, `Lightspeed refused: ${msg}. The VMS connection may need full access: Settings → Lightspeed → Connect, and approve full access.`)
      throw e
    }
    const countId = made.InventoryCount?.inventoryCountID
    if (!countId) throw new Error('Lightspeed did not return the new count')
    // one counted quantity per item; a failure on one item is reported, the rest still go
    let sent = 0
    const failed: string[] = []
    for (const l of counted) {
      try {
        await lsPost(token, `/Account/${conn.account_id}/InventoryCountItem.json`, { inventoryCountID: countId, itemID: l.item_id, qty: String(Math.round(Number(l.total))) })
        sent++
      } catch (e) {
        failed.push(`${l.description}: ${e instanceof Error ? e.message : String(e)}`)
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    await db.from('inventory_counts').update({ status: 'sent', ls_count_id: countId, ls_count_name: name, sent_at: new Date().toISOString(), sent_by: me.id, sent_items: sent }).eq('id', c.id)
    return json({ ls_count_id: countId, name, sent, failed })
  } catch (e) {
    return errorResponse(e)
  }
})
