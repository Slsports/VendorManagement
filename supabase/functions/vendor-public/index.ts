// vendor-public: the pages vendors open from our emails, no login (Dana, Oct 13). Each link carries a random token that
// only finds its own send; nothing else in VMS is reachable from here.
//   receipt — "I received the routing instructions": marks it received, returns the letter to download
//   form    — the contact confirmation form's data (marks it opened)
//   submit  — the form sent back: "Looks good" or the changes; they land in VMS and the person is Confirmed; their
//             routing-letter answer (yes: received; no: the letter is prepared for them)
import { CORS, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'
import { aiEnabled, readFreightProgram } from '../_shared/ai.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const db = serviceClient()
    const body = (await req.json().catch(() => ({}))) as { action?: string; token?: string; payload?: Record<string, unknown>; looks_good?: boolean }
    if (!body.token || !UUID.test(body.token)) throw new HttpError(404, 'This link is not valid.')
    if (body.action === 'receipt') {
      const { data, error } = await db.rpc('routing_receipt', { p_token: body.token })
      if (error) throw new Error(error.message)
      const r = (data ?? [])[0] as { vendor_name: string; version: number; storage_path: string; file_name: string; received_at: string | null } | undefined
      if (!r) throw new HttpError(404, 'This link is not valid.')
      const { data: signed } = await db.storage.from('vendor-files').createSignedUrl(r.storage_path, 60 * 60 * 24 * 7, { download: r.file_name })
      return json({ vendor: r.vendor_name, version: r.version, received_at: r.received_at, file_name: r.file_name, url: signed?.signedUrl ?? null })
    }
    if (body.action === 'form') {
      const { data, error } = await db.rpc('vendor_confirm_get', { p_token: body.token })
      if (error) throw new Error(error.message)
      if (!data) throw new HttpError(404, 'This link is not valid.')
      return json(data)
    }
    if (body.action === 'submit') {
      const payload = body.payload ?? {}
      if (JSON.stringify(payload).length > 50_000) throw new HttpError(400, 'Too much text')
      const { data, error } = await db.rpc('vendor_confirm_submit', { p_token: body.token, p_payload: payload, p_looks_good: !!body.looks_good })
      if (error) throw new Error(error.message)
      if (!data) throw new HttpError(404, 'This link is not valid.')
      const done = data as { vendor: string; vendor_id: string; freight_programs: string | null }
      // "Did you receive our routing instructions?" Yes marks it received; No prepares the letter for them (Dana, Oct 13)
      const routing = payload.routing_received
      if (routing === 'yes' || routing === 'no') {
        const { error: rErr } = await db.rpc('vendor_confirm_routing', { p_token: body.token, p_answer: routing })
        if (rErr) console.error('routing answer', rErr.message)
      }
      // their freight programs fill the vendor's free-shipping settings when VMS has none yet
      if (!body.looks_good && done.freight_programs?.trim() && aiEnabled()) {
        try {
          const { data: v } = await db.from('vendors').select('organization_id, free_shipping_policy, free_shipping_threshold').eq('id', done.vendor_id).single()
          if (v && !v.free_shipping_policy) {
            const r = await readFreightProgram(db, v.organization_id, done.freight_programs)
            if (r && r.policy !== 'unknown') await db.from('vendors').update({ free_shipping_policy: r.policy, free_shipping_threshold: v.free_shipping_threshold ?? r.free_over }).eq('id', done.vendor_id)
          }
        } catch (e) {
          console.error('freight program', e instanceof Error ? e.message : e)
        }
      }
      return json({ vendor: done.vendor })
    }
    throw new HttpError(400, 'Unknown request')
  } catch (e) {
    return errorResponse(e)
  }
})
