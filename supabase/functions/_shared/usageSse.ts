// What a Claude answer cost, read from the raw reply (Oct 16: VMS logged $9.52 for a day Anthropic billed about $15).
// Pure, so it can be tested; claudeClient.ts records it for every billed call.

export interface RawUsage { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }
export interface CallUsage { id: string; model: string; usage: RawUsage }

/** Per million tokens: input, output (Anthropic's list prices, Oct 2026). Haiku 5.5 costs more past 100K prompt tokens. */
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
}

/** Dollars for one answer: cache writes at 1.25×, cache reads at 0.1× the input price. */
export function costOf(model: string, u: RawUsage): number {
  const prompt = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  let [pin, pout] = PRICES[model] ?? [0, 0]
  if (model === 'claude-haiku-5-5' && prompt > 100_000) [pin, pout] = [0.50, 2.50]
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1
  return (input * pin + u.output_tokens * pout) / 1_000_000
}

/** The id, model and final usage of a streamed answer (message_start, then message_delta with the totals). */
export function usageFromSse(text: string): CallUsage | null {
  let out: CallUsage | null = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    let ev: { type?: string; message?: { id: string; model: string; usage: RawUsage }; usage?: Partial<RawUsage> }
    try { ev = JSON.parse(line.slice(5)) } catch { continue }
    if (ev.type === 'message_start' && ev.message) out = { id: ev.message.id, model: ev.message.model, usage: { ...ev.message.usage } }
    else if (ev.type === 'message_delta' && ev.usage && out) {
      for (const [k, val] of Object.entries(ev.usage)) if (val !== null && val !== undefined) (out.usage as unknown as Record<string, unknown>)[k] = val
    }
  }
  return out
}
