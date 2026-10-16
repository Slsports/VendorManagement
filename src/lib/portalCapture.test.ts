import { describe, expect, it } from 'vitest'
import { captureBookmarklet, readAllBookmarklet } from './portalCapture'

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

describe('Read all vendors (Oct 16)', () => {
  it('asks the portal for its list and each vendor, then sends batches to VMS', () => {
    const code = decodeURIComponent(readAllBookmarklet('https://x.supabase.co/functions/v1', 'k-1').slice('javascript:'.length))
    expect(code).toContain('method=getVendorData')
    expect(code).toContain("'method=selectVendor&vendorNumber='")
    expect(code).toContain("send('wwd_vendors',batch)")
    expect(() => new Function(code)).not.toThrow()
    const m = 'x p0/IZ7_0A=CZ6_0A=NJportletActionAJAXURL=/ y'.match(/p0\/[^"'\s<>]*NJportletActionAJAXURL=\//)
    expect(m?.[0]).toBe('p0/IZ7_0A=CZ6_0A=NJportletActionAJAXURL=/')
  })
})
