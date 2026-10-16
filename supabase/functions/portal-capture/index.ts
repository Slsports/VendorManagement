// portal-capture: the "Send to VMS" bookmark (Dana, Oct 16). WWD's IT will not export the vendor directory, so Dana
// clicks a bookmark on a Worldwide portal page and the page comes here, kept as it is (portal_captures) for the reader
// that pulls every vendor. The bookmark posts plain text (no preflight) with Dana's private key; nothing else gets in.
import { serviceClient } from '../_shared/caller.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const MAX = 15_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405)
  try {
    const raw = await req.text()
    if (raw.length > MAX + 10_000) return reply({ error: 'That page is too big' }, 413)
    const b = JSON.parse(raw) as { key?: string; url?: string; title?: string; html?: string }
    if (!b.key || !/^[0-9a-f-]{36}$/i.test(b.key) || !b.html) return reply({ error: 'Not allowed' }, 403)
    const db = serviceClient()
    const { data: k } = await db.from('capture_keys').select('profile_id, organization_id').eq('key', b.key).maybeSingle()
    if (!k) return reply({ error: 'Not allowed' }, 403)
    const { data, error } = await db.from('portal_captures').insert({
      organization_id: k.organization_id, profile_id: k.profile_id, url: (b.url ?? '').slice(0, 2000) || null,
      title: (b.title ?? '').slice(0, 500) || null, html: b.html, how: 'bookmark',
    }).select('id').single()
    if (error) throw new Error(error.message)
    return reply({ ok: true, id: data.id })
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
