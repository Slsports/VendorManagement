import { describe, expect, it } from 'vitest'
import { firstKeyFallsBack } from './claudeKeys'

describe('two Claude keys', () => {
  it('hands the request to the main key when the first is out of credit, refused or busy', () => {
    expect(firstKeyFallsBack(400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}')).toBe('out')
    expect(firstKeyFallsBack(401, '')).toBe('out')
    expect(firstKeyFallsBack(429, '')).toBe('busy')
    expect(firstKeyFallsBack(529, '')).toBe('busy')
  })
  it('keeps a real mistake in the request as an error, not a key problem', () => {
    expect(firstKeyFallsBack(400, '{"error":{"message":"max_tokens: Field required"}}')).toBeNull()
    expect(firstKeyFallsBack(500, '')).toBeNull()
  })
})
