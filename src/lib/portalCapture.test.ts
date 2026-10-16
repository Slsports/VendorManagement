import { describe, expect, it } from 'vitest'
import { captureBookmarklet } from './portalCapture'

describe('the Send to VMS bookmark (Oct 16)', () => {
  it('posts the page as plain text to portal-capture with the key', () => {
    const b = captureBookmarklet('https://x.supabase.co/functions/v1', '11111111-2222-3333-4444-555555555555')
    expect(b.startsWith('javascript:')).toBe(true)
    const code = decodeURIComponent(b.slice('javascript:'.length))
    expect(code).toContain('"https://x.supabase.co/functions/v1/portal-capture"')
    expect(code).toContain("'Content-Type':'text/plain'")
    expect(code).toContain('"11111111-2222-3333-4444-555555555555"')
    expect(() => new Function(code)).not.toThrow()
  })
})
