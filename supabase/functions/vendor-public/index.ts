// vendor-public: the pages vendors open from our emails, no login (Dana, Oct 13). Each link carries a random token that
// only finds its own send; nothing else in VMS is reachable from here.
//   receipt — "I received the routing instructions": marks it received, returns the letter to download
import { CORS, errorResponse, HttpError, json, serviceClient } from '../_shared/caller.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const db = serviceClient()
    const body = (await req.json().catch(() => ({}))) as { action?: string; token?: string }
    if (!body.token || !UUID.test(body.token)) throw new HttpError(404, 'This link is not valid.')
    if (body.action === 'receipt') {
      const { data, error } = await db.rpc('routing_receipt', { p_token: body.token })
      if (error) throw new Error(error.message)
      const r = (data ?? [])[0] as { vendor_name: string; version: number; storage_path: string; file_name: string; received_at: string | null } | undefined
      if (!r) throw new HttpError(404, 'This link is not valid.')
      const { data: signed } = await db.storage.from('vendor-files').createSignedUrl(r.storage_path, 60 * 60 * 24 * 7, { download: r.file_name })
      return json({ vendor: r.vendor_name, version: r.version, received_at: r.received_at, file_name: r.file_name, url: signed?.signedUrl ?? null })
    }
    throw new HttpError(400, 'Unknown request')
  } catch (e) {
    return errorResponse(e)
  }
})
