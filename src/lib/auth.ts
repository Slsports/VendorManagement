/**
 * Supabase sends a refused OAuth sign-in back to the redirect URL with the reason in the hash (or query):
 * error, error_code, error_description. Sign-ups are off on the project, so an unknown Google account
 * comes back as "Signups not allowed for this instance": only people on the staff list get in.
 */
export function oauthError(loc: { hash: string; search: string }): string | null {
  const params = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.search)
  const description = params.get('error_description')
  if (!params.get('error') && !description) return null
  if (/signups? not allowed|user not found/i.test(description ?? '')) {
    return 'That Google account is not on the staff list. Ask Dana to add this email under Settings → Users, then try again.'
  }
  return description?.trim() || 'Google sign-in did not finish. Please try again.'
}
