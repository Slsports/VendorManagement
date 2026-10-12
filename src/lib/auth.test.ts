import { describe, expect, it } from 'vitest'
import { oauthError } from './auth'

describe('oauthError', () => {
  it('is null when the URL carries no error', () => {
    expect(oauthError({ hash: '#access_token=abc&type=bearer', search: '' })).toBeNull()
    expect(oauthError({ hash: '', search: '?from=/orders' })).toBeNull()
  })
  it('explains the staff list when sign-ups are refused', () => {
    const msg = oauthError({ hash: '#error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance', search: '' })
    expect(msg).toMatch(/not on the staff list/)
    expect(msg).toMatch(/Settings → Users/)
  })
  it('passes other reasons through, from hash or query', () => {
    expect(oauthError({ hash: '', search: '?error=server_error&error_description=Something+odd' })).toBe('Something odd')
    expect(oauthError({ hash: '#error=server_error', search: '' })).toMatch(/did not finish/)
  })
})
