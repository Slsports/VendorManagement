import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LS_STANDARD } from './lsStandard'

describe('LS category standard in the functions', () => {
  it('matches docs/lightspeed-category-standard.md (run node scripts/sync-ls-standard.mjs)', () => {
    expect(LS_STANDARD).toBe(readFileSync('docs/lightspeed-category-standard.md', 'utf8'))
  })
})
