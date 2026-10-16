import { describe, expect, it } from 'vitest'
import { costOf, usageFromSse } from './usageSse'

describe('what a Claude answer cost (Oct 16)', () => {
  it('reads the id and final usage from a streamed answer', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-5-5","usage":{"input_tokens":1000,"output_tokens":1,"cache_read_input_tokens":0}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":500}}',
    ].join('\n')
    expect(usageFromSse(sse)).toEqual({ id: 'msg_1', model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 } })
    expect(usageFromSse('data: not json')).toBeNull()
  })
  it('prices Sonnet, Haiku and cached tokens', () => {
    expect(costOf('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(3)
    expect(costOf('claude-haiku-5-5', { input_tokens: 10_000, output_tokens: 1000 })).toBeCloseTo(0.0015)
    expect(costOf('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(0.1)
    expect(costOf('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2)
  })
})
