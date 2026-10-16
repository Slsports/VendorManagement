// One Claude client for every function, and a cost log that misses nothing (Dana, Oct 16: VMS logged $9.52 for a day
// Anthropic billed about $15; freight readings were never logged, nor answers that could not be used). Every billed
// answer is recorded by its Claude id as it arrives ("not_logged"); logUsage then names what it was for. A run that
// dies mid-answer still cannot be logged.
import Anthropic from 'npm:@anthropic-ai/sdk'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { serviceClient } from './caller.ts'
import { costOf, usageFromSse, type CallUsage, type RawUsage } from './usageSse.ts'

let db: SupabaseClient | null = null
let org: string | null = null

/** Record a billed answer once; logUsage's row (with its purpose) wins whichever lands first. */
async function record(u: CallUsage | null) {
  if (!u?.id || !u.usage) return
  db ??= serviceClient()
  org ??= (await db.from('organizations').select('id').order('created_at').limit(1).maybeSingle()).data?.id ?? null
  if (!org) return
  await db.from('ai_usage').upsert(row(org, 'not_logged', u.model, u.usage, 1, u.id), { onConflict: 'request_id', ignoreDuplicates: true })
}

function row(organization: string, purpose: string, model: string, u: RawUsage, items: number, id: string | null) {
  return {
    organization_id: organization, purpose, model, items, request_id: id,
    input_tokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output_tokens: u.output_tokens, cost_usd: Number(costOf(model, u).toFixed(5)),
  }
}

/** fetch for the Claude client: passes everything through and records what each successful answer used. */
const usageFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!res.ok || !/\/v1\/messages(\?|$)/.test(url)) return res
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('text/event-stream') && res.body) {
      const [mine, theirs] = res.body.tee()
      void new Response(theirs).text().then((t) => record(usageFromSse(t))).catch(() => {})
      return new Response(mine, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
    if (type.includes('application/json')) {
      const j = await res.clone().json() as { id?: string; model?: string; usage?: RawUsage }
      if (j.id && j.model && j.usage) await record({ id: j.id, model: j.model, usage: j.usage }).catch(() => {})
    }
  } catch {
    // the log never stands in the way of the answer
  }
  return res
}

const clients = new Map<number, Anthropic>()
export function claudeClient(timeout = 90_000): Anthropic {
  if (!clients.has(timeout)) clients.set(timeout, new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), maxRetries: 3, timeout, fetch: usageFetch }))
  return clients.get(timeout)!
}

/** What a call was for: names the row the client recorded (or adds it, when the client could not). */
export async function logUsage(client: SupabaseClient, organization: string, purpose: string, model: string, msg: { id?: string | null; usage: Anthropic.Usage }, items: number) {
  await client.from('ai_usage').upsert(row(organization, purpose, model, msg.usage as RawUsage, items, msg.id ?? null), { onConflict: 'request_id' })
}
